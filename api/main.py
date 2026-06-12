"""
StratOS Cognitive Digital Twin — Backend API
============================================================
FastAPI bridge between the Next.js frontend and the LangGraph multi-agent workflows.

Run from the project root:
    uvicorn api.main:app --reload --port 8000

Architecture
------------
  POST /api/agents/{agent}/run  → queues a background job, returns {job_id}
  GET  /api/jobs/{job_id}       → polls job status + result
  GET  /api/health              → liveness probe
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import secrets
import sys
import threading
import time
import urllib.parse
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import psycopg2
import psycopg2.extras
import requests as _requests
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel

# ── Resolve project root and load the unified .env ───────────────────────────
ROOT_DIR: Path = Path(__file__).parent.parent.resolve()
load_dotenv(ROOT_DIR / ".env")

AGENTS_DIR: Path = ROOT_DIR / "Agents"
GAP_ANALYSIS_AGENT_PATH: Path = AGENTS_DIR / "Gap analysis" / "gap_analysis_agent.py"
DATA_DIR: Path = ROOT_DIR / "Data"
SOCIAL_AGENT_DIR: Path = ROOT_DIR / "Social Media Scraping Agent"
MEETINGS_AGENT_PATH: Path = AGENTS_DIR / "meetings" / "agent.py"

# ── Wire Workforce Agent's relative-import package onto sys.path ─────────────
_MONITORING_DIR = str(AGENTS_DIR / "monitoring")
if _MONITORING_DIR not in sys.path:
    sys.path.insert(0, _MONITORING_DIR)

# ── In-memory stores ─────────────────────────────────────────────────────────
_jobs: dict[str, dict[str, Any]] = {}
_meetings: dict[str, dict[str, Any]] = {}
_webhook_log: list[dict[str, Any]] = []   # last N Fathom deliveries
_WEBHOOK_LOG_MAX = 20

# OAuth: ephemeral state tokens + stored Google tokens (single-user)
_oauth_states: dict[str, float] = {}  # state → created_at timestamp
_google_tokens: dict[str, Any] = {}   # "primary" → {access_token, refresh_token, email, expires_at}

# ── Supabase persistence ──────────────────────────────────────────────────────

_db_conn: Any = None


def _get_db_conn():
    global _db_conn
    dsn = os.getenv("DB_CONNECTION_STRING", "")
    if not dsn:
        return None
    try:
        if _db_conn is None or _db_conn.closed:
            _db_conn = psycopg2.connect(dsn)
            _db_conn.autocommit = True
        # lightweight ping to detect stale pooler connections
        _db_conn.cursor().execute("SELECT 1")
        return _db_conn
    except Exception:
        try:
            _db_conn = psycopg2.connect(dsn)
            _db_conn.autocommit = True
            return _db_conn
        except Exception as exc:
            print(f"[db] Cannot connect: {exc}")
            _db_conn = None
            return None


def _db_init() -> None:
    """Create tables if missing, then hydrate the in-memory caches from the DB."""
    conn = _get_db_conn()
    if not conn:
        print("[db] No DB_CONNECTION_STRING — data will not persist across restarts")
        return
    try:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS stratos_meetings (
                    id         TEXT PRIMARY KEY,
                    data       JSONB NOT NULL,
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS stratos_auth (
                    key        TEXT PRIMARY KEY,
                    data       JSONB NOT NULL,
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )
            """)

        # Load meetings
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT id, data FROM stratos_meetings ORDER BY (data->>'date') DESC")
            for row in cur.fetchall():
                _meetings[row["id"]] = row["data"]
        print(f"[db] Loaded {len(_meetings)} meeting(s) from Supabase")

        # Load Google tokens
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT key, data FROM stratos_auth WHERE key = 'google_primary'")
            row = cur.fetchone()
        if row:
            _google_tokens["primary"] = row["data"]
            email = row["data"].get("email", "")
            print(f"[db] Restored Google session for {email}")

    except Exception as exc:
        print(f"[db] Init error: {exc}")


def _db_delete(meeting_id: str) -> None:
    """Remove a meeting from Supabase."""
    conn = _get_db_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM stratos_meetings WHERE id = %s", (meeting_id,))
    except Exception as exc:
        print(f"[db] Delete error: {exc}")


def _db_upsert(meeting: dict) -> None:
    """Persist (or update) a single meeting to Supabase."""
    conn = _get_db_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO stratos_meetings (id, data, updated_at)
                VALUES (%s, %s, NOW())
                ON CONFLICT (id) DO UPDATE
                    SET data = EXCLUDED.data, updated_at = NOW()
                """,
                (meeting["id"], json.dumps(meeting)),
            )
    except Exception as exc:
        print(f"[db] Upsert error: {exc}")


def _db_save_tokens(tokens: dict) -> None:
    """Persist Google OAuth tokens to Supabase."""
    conn = _get_db_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO stratos_auth (key, data, updated_at)
                VALUES ('google_primary', %s, NOW())
                ON CONFLICT (key) DO UPDATE
                    SET data = EXCLUDED.data, updated_at = NOW()
                """,
                (json.dumps(tokens),),
            )
    except Exception as exc:
        print(f"[db] Token save error: {exc}")

_GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/api/auth/google/callback")
_GOOGLE_AUTH_SCOPES = " ".join([
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/meetings.space.readonly",
    "openid",
    "email",
])

_PRIORITY_MAP = {"CRITICAL": "critical", "HIGH": "high", "MEDIUM": "medium", "LOW": "low"}
_NOW = lambda: datetime.now(timezone.utc).isoformat()

def _apply_pillar_tags(insights: list) -> None:
    """
    Run the categorizer on every insight and write the resulting pillar name
    back as pillar_tag.  Falls back silently so a categorizer failure never
    breaks an agent task.
    """
    if not insights:
        return
    try:
        from Agents.categorizer import categorize_all_swot_items
        swot_items = [
            {
                "type": ins.get("category", ""),
                "title": ins.get("title", ""),
                "description": ins.get("description", ""),
            }
            for ins in insights
        ]
        categorize_all_swot_items(swot_items)
        for ins, item in zip(insights, swot_items):
            pillar_name = item.get("pillar_name")
            if pillar_name:
                ins["pillar_tag"] = pillar_name
    except Exception as exc:
        print(f"[categorizer] pillar tagging failed: {exc}")


# ── Module loader (cached) ────────────────────────────────────────────────────

def _load_module(name: str, path: Path) -> Any:
    """Load a Python file as a module by absolute path, caching after first load."""
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot locate module at {path}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


# ── Job helpers ───────────────────────────────────────────────────────────────

def _new_job() -> str:
    job_id = str(uuid.uuid4())
    _jobs[job_id] = {
        "status": "running",
        "result": None,
        "error": None,
        "started_at": _NOW(),
        "finished_at": None,
    }
    return job_id


def _finish(job_id: str, result: Any) -> None:
    _jobs[job_id].update(status="complete", result=result, finished_at=_NOW())


def _fail(job_id: str, error: str) -> None:
    _jobs[job_id].update(status="failed", error=error, finished_at=_NOW())


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(title="StratOS CDT API", version="1.0.0", docs_url="/api/docs")


@app.on_event("startup")
def startup_event():
    _db_init()


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        os.getenv("NGROK_URL", ""),           # e.g. https://distill-subpar-bankroll.ngrok-free.dev
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {"status": "ok", "timestamp": _NOW()}


# ── Job polling ───────────────────────────────────────────────────────────────

@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return _jobs[job_id]


# ══════════════════════════════════════════════════════════════════════════════
#  GOOGLE OAUTH (for Calendar + Meet)
#
#  Add http://localhost:8000/api/auth/google/callback to your Google Cloud
#  Console project's "Authorised redirect URIs" before using this flow.
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/auth/google/start")
def google_auth_start():
    """Redirect the browser to Google's OAuth consent screen."""
    state = secrets.token_urlsafe(16)
    _oauth_states[state] = time.time()
    params = urllib.parse.urlencode({
        "client_id": os.getenv("GOOGLE_CLIENT_ID", ""),
        "redirect_uri": _GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": _GOOGLE_AUTH_SCOPES,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    })
    return RedirectResponse(f"https://accounts.google.com/o/oauth2/v2/auth?{params}")


@app.get("/api/auth/google/callback")
def google_auth_callback(code: str = "", state: str = "", error: str = ""):
    """Exchange the OAuth code for tokens and store them server-side."""
    if error:
        return HTMLResponse(f"<p>OAuth error: {error}</p>", status_code=400)

    # Prune expired states (>10 min old) and validate
    now = time.time()
    _oauth_states.update({k: v for k, v in _oauth_states.items() if now - v < 600})
    if state not in _oauth_states:
        return HTMLResponse("<p>Invalid or expired state. Please try again.</p>", status_code=400)
    del _oauth_states[state]

    # Exchange code → tokens
    tok_resp = _requests.post(
        "https://oauth2.googleapis.com/token",
        data={
            "code": code,
            "client_id": os.getenv("GOOGLE_CLIENT_ID", ""),
            "client_secret": os.getenv("GOOGLE_CLIENT_SECRET", ""),
            "redirect_uri": _GOOGLE_REDIRECT_URI,
            "grant_type": "authorization_code",
        },
        timeout=15,
    )
    if not tok_resp.ok:
        return HTMLResponse(f"<p>Token exchange failed: {tok_resp.text}</p>", status_code=400)

    tok = tok_resp.json()

    # Fetch user email
    info_resp = _requests.get(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        headers={"Authorization": f"Bearer {tok['access_token']}"},
        timeout=10,
    )
    email = info_resp.json().get("email", "") if info_resp.ok else ""

    _google_tokens["primary"] = {
        "access_token": tok["access_token"],
        "refresh_token": tok.get("refresh_token", ""),
        "expires_at": time.time() + tok.get("expires_in", 3600) - 60,
        "email": email,
    }
    _db_save_tokens(_google_tokens["primary"])

    return HTMLResponse(f"""<!DOCTYPE html>
<html>
<head><title>Google Calendar Connected</title></head>
<body style="font-family:system-ui,sans-serif;text-align:center;padding:60px;background:#0d1117;color:#e2e8f0">
  <div style="font-size:48px;margin-bottom:16px">✓</div>
  <h2 style="color:#22c55e;margin:0 0 8px">Google Calendar Connected</h2>
  <p style="color:#94a3b8;margin:0">Signed in as <strong>{email}</strong>. You can close this window.</p>
  <script>
    if (window.opener) {{
      window.opener.postMessage({{type:'google-auth-success',email:'{email}'}}, '*');
      setTimeout(() => window.close(), 1200);
    }}
  </script>
</body>
</html>""")


@app.get("/api/auth/google/status")
def google_auth_status():
    """Return whether a Google access token is currently stored."""
    tok = _google_tokens.get("primary")
    if not tok:
        return {"connected": False, "email": None}
    return {"connected": True, "email": tok.get("email", "")}


def _get_valid_access_token() -> str | None:
    """Return a valid access token, refreshing via refresh_token if expired."""
    tok = _google_tokens.get("primary")
    if not tok:
        return None
    if time.time() < tok.get("expires_at", 0):
        return tok["access_token"]
    refresh = tok.get("refresh_token")
    if not refresh:
        return None
    resp = _requests.post(
        "https://oauth2.googleapis.com/token",
        data={
            "refresh_token": refresh,
            "client_id": os.getenv("GOOGLE_CLIENT_ID", ""),
            "client_secret": os.getenv("GOOGLE_CLIENT_SECRET", ""),
            "grant_type": "refresh_token",
        },
        timeout=15,
    )
    if not resp.ok:
        return None
    data = resp.json()
    tok["access_token"] = data["access_token"]
    tok["expires_at"] = time.time() + data.get("expires_in", 3600) - 60
    _db_save_tokens(tok)
    return tok["access_token"]


# ══════════════════════════════════════════════════════════════════════════════
#  MEETINGS — Schedule, List, Detail, Fathom Webhook
# ══════════════════════════════════════════════════════════════════════════════

def _find_scheduled_meeting(fathom_data: dict, raw_payload: dict | None = None) -> str | None:
    """
    Match a Fathom webhook to an existing scheduled meeting.

    Strategy (in order):
      1. scheduled_start_time from raw payload vs meeting.date (≤ 10 min) — most reliable.
      2. Title (meeting_title) + recording start time within 3 hours — fallback.

    Fathom's `title` field is auto-generated ("Impromptu Google Meet Meeting") and
    unreliable; `meeting_title` is the Google Calendar event name and is used for #2.
    """
    unprocessed = {mid: m for mid, m in _meetings.items() if not m.get("fathom_call_id")}
    if not unprocessed:
        return None

    # ── Strategy 1: scheduled_start_time exact match ─────────────────────────
    raw = raw_payload or {}
    sched_str = raw.get("scheduled_start_time", "")
    if sched_str:
        try:
            sched_dt = datetime.fromisoformat(sched_str.replace("Z", "+00:00"))
            for mid, m in unprocessed.items():
                try:
                    m_dt = datetime.fromisoformat(m.get("date", "").replace("Z", "+00:00"))
                    if abs((sched_dt - m_dt).total_seconds()) <= 600:  # 10-min window
                        print(f"[meetings] Matched by scheduled_start_time → {mid}")
                        return mid
                except Exception:
                    pass
        except Exception:
            pass

    # ── Strategy 2: meeting_title + recording time within 3 hours ────────────
    title    = _as_str(raw.get("meeting_title") or fathom_data.get("title"), "").strip().lower()
    date_str = fathom_data.get("date", "")
    if title and date_str:
        try:
            fathom_dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
            for mid, m in unprocessed.items():
                if m.get("title", "").strip().lower() != title:
                    continue
                try:
                    m_dt = datetime.fromisoformat(m.get("date", "").replace("Z", "+00:00"))
                    if abs((fathom_dt - m_dt).total_seconds()) < 10_800:
                        print(f"[meetings] Matched by title+time → {mid}")
                        return mid
                except Exception:
                    pass
        except Exception:
            pass

    return None


class ScheduleMeetingRequest(BaseModel):
    title: str
    start_iso: str          # ISO-8601, e.g. "2026-05-15T10:00:00Z"
    duration_minutes: int = 60
    attendee_emails: list[str] = []
    meeting_type: str = "Board Meeting"
    description: str = ""


@app.post("/api/meetings/schedule", status_code=201)
def schedule_meeting(req: ScheduleMeetingRequest):
    """
    Create a meeting. If Google Calendar is authorised, also creates a
    Calendar event with a Google Meet link and invites all attendees.
    """
    meeting_id = f"cal-{uuid.uuid4().hex[:10]}"
    access_token = _get_valid_access_token()

    meet_link = calendar_event_id = html_link = ""

    if access_token:
        try:
            mod = _load_module("meetings_agent", MEETINGS_AGENT_PATH)
            cal = mod.create_calendar_event(
                access_token=access_token,
                title=req.title,
                start_iso=req.start_iso,
                duration_minutes=req.duration_minutes,
                attendee_emails=req.attendee_emails,
                description=req.description,
            )
            calendar_event_id = cal.get("calendar_event_id", "")
            meet_link = cal.get("meet_link", "")
            html_link = cal.get("html_link", "")
        except Exception as exc:
            # Log but don't fail — meeting is still stored locally
            print(f"[meetings] Google Calendar error: {exc}")

    try:
        start_dt = datetime.fromisoformat(req.start_iso.replace("Z", "+00:00"))
    except Exception:
        start_dt = datetime.now(timezone.utc)

    minutes_until = (start_dt - datetime.now(timezone.utc)).total_seconds() / 60
    fathom_warning = None
    if minutes_until < 5:
        fathom_warning = (
            "Meeting starts in less than 5 minutes — Fathom bot may not have "
            "enough time to detect the calendar event and auto-join."
        )
        print(f"[meetings] ⚠️  {fathom_warning}")

    meeting: dict[str, Any] = {
        "id": meeting_id,
        "title": req.title,
        "type": req.meeting_type,
        "date": start_dt.isoformat(),
        "duration_minutes": req.duration_minutes,
        "participants": req.attendee_emails,
        "ai_summary": "",
        "key_decisions": [],
        "action_items": [],
        "has_recording": False,
        "has_transcript": False,
        "transcript": "",
        "recording_url": "",
        "meet_link": meet_link,
        "calendar_event_id": calendar_event_id,
        "html_link": html_link,
        "data_source": "live",
        "created_at": _NOW(),
    }
    _meetings[meeting_id] = meeting
    _db_upsert(meeting)

    return {
        "meeting_id": meeting_id,
        "meet_link": meet_link,
        "calendar_event_id": calendar_event_id,
        "html_link": html_link,
        "fathom_warning": fathom_warning,
    }


@app.get("/api/meetings")
def list_meetings():
    """Return all meetings stored in this session (scheduled + Fathom-imported)."""
    return list(_meetings.values())


@app.get("/api/meetings/webhook-log")
def get_webhook_log():
    """Return recent Fathom webhook delivery attempts (newest first)."""
    return {
        "count": len(_webhook_log),
        "skip_verify": os.getenv("FATHOM_SKIP_VERIFY", "false").lower() == "true",
        "entries": _webhook_log,
    }


@app.get("/api/meetings/fathom-webhook/ping")
def fathom_webhook_ping():
    """Reachability probe — visit this URL to confirm ngrok → FastAPI is working."""
    return {
        "status": "reachable",
        "webhook_endpoint": "POST /api/meetings/fathom-webhook",
        "verify_enabled": bool(os.getenv("FATHOM_WEBHOOK_SECRET")),
    }


@app.get("/api/meetings/{meeting_id}")
def get_meeting(meeting_id: str):
    if meeting_id not in _meetings:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return _meetings[meeting_id]


@app.delete("/api/meetings/{meeting_id}", status_code=200)
def delete_meeting(meeting_id: str):
    if meeting_id not in _meetings:
        raise HTTPException(status_code=404, detail="Meeting not found")

    meeting = _meetings.pop(meeting_id)
    _db_delete(meeting_id)

    # Also delete from Google Calendar if this meeting has a calendar event
    calendar_event_id = meeting.get("calendar_event_id", "")
    if calendar_event_id:
        access_token = _get_valid_access_token()
        if access_token:
            try:
                mod = _load_module("meetings_agent", MEETINGS_AGENT_PATH)
                mod.delete_calendar_event(access_token, calendar_event_id)
                print(f"[meetings] Deleted calendar event {calendar_event_id}")
            except Exception as exc:
                print(f"[meetings] Calendar delete error: {exc}")
                return {"status": "deleted", "calendar": "failed", "detail": str(exc)}

    return {"status": "deleted", "calendar": "ok" if calendar_event_id else "n/a"}


@app.post("/api/meetings/fathom-webhook", status_code=200)
async def fathom_webhook(request: Request):
    """
    Receive post-meeting webhooks from Fathom (Svix delivery).
    Set FATHOM_SKIP_VERIFY=true in .env to bypass signature checking while debugging.
    """
    raw_body = await request.body()
    headers_dict = dict(request.headers)
    webhook_secret = os.getenv("FATHOM_WEBHOOK_SECRET", "")
    skip_verify = os.getenv("FATHOM_SKIP_VERIFY", "false").lower() == "true"

    # ── Diagnostic logging (visible in uvicorn console) ───────────────────────
    print("\n" + "=" * 60)
    print("[fathom-webhook] Incoming request")
    print(f"  body length : {len(raw_body)} bytes")
    relevant = {k: v for k, v in headers_dict.items()
                if any(k.startswith(p) for p in ("svix-", "webhook-", "content-", "user-"))}
    for k, v in relevant.items():
        print(f"  {k}: {v}")
    try:
        parsed_preview = json.loads(raw_body)
        top_keys = list(parsed_preview.keys())
        print(f"  top-level keys : {top_keys}")
        print(f"  payload preview: {raw_body[:600].decode(errors='replace')}")
    except Exception:
        print(f"  payload preview: {raw_body[:600].decode(errors='replace')}")
    print("=" * 60 + "\n")

    # ── Signature verification ────────────────────────────────────────────────
    mod = _load_module("meetings_agent", MEETINGS_AGENT_PATH)
    sig_ok: bool | None = None  # None = not checked

    if webhook_secret and not skip_verify:
        sig_ok = mod.verify_fathom_webhook(raw_body, headers_dict, webhook_secret)
        if not sig_ok:
            _webhook_log.insert(0, {
                "received_at": _NOW(),
                "status": "rejected",
                "reason": "signature_mismatch",
                "body_preview": raw_body[:200].decode(errors="replace"),
            })
            del _webhook_log[_WEBHOOK_LOG_MAX:]
            print("[fathom-webhook] ❌ Signature verification FAILED")
            print("  → Set FATHOM_SKIP_VERIFY=true in .env to bypass while debugging")
            raise HTTPException(status_code=401, detail="Invalid webhook signature")
    elif skip_verify:
        sig_ok = None  # skipped
        print("[fathom-webhook] ⚠️  Signature verification SKIPPED (FATHOM_SKIP_VERIFY=true)")

    try:
        payload = json.loads(raw_body)
    except json.JSONDecodeError:
        _webhook_log.insert(0, {
            "received_at": _NOW(),
            "status": "rejected",
            "reason": "invalid_json",
            "body_preview": raw_body[:200].decode(errors="replace"),
        })
        del _webhook_log[_WEBHOOK_LOG_MAX:]
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    meeting_data = mod.parse_fathom_payload(payload)

    # ── Match to an existing scheduled meeting ────────────────────────────────
    matched_id = _find_scheduled_meeting(meeting_data, payload)
    if matched_id:
        existing = _meetings[matched_id]
        existing.update({
            "ai_summary":      meeting_data["ai_summary"],
            "key_decisions":   meeting_data["key_decisions"],
            "action_items":    meeting_data["action_items"],
            "has_recording":   meeting_data["has_recording"],
            "has_transcript":  meeting_data["has_transcript"],
            "transcript":      meeting_data["transcript"],
            "recording_url":   meeting_data["recording_url"],
            "fathom_call_id":  meeting_data["fathom_call_id"],
            # Real duration from Fathom is more accurate than the scheduled estimate
            "duration_minutes": meeting_data["duration_minutes"] or existing["duration_minutes"],
            # Participants from Fathom have actual names; keep scheduled emails as fallback
            "participants": meeting_data["participants"] or existing["participants"],
            # Clear meet_link — meeting is over, the join button should disappear
            "meet_link": "",
        })
        final_meeting = existing
        stored_id = matched_id
        print(f"[fathom-webhook] 🔗 Merged into scheduled meeting: {matched_id}")
    else:
        _meetings[meeting_data["id"]] = meeting_data
        final_meeting = meeting_data
        stored_id = meeting_data["id"]
        print(f"[fathom-webhook] ✅ Stored new meeting: {stored_id} — {meeting_data['title']}")

    _db_upsert(final_meeting)

    # Unified pipeline: log the parsed meeting in agent_runs.
    try:
        mod.save_meeting(final_meeting)
    except Exception as e:
        print(f"[fathom-webhook] unified save_meeting failed: {e}")

    _webhook_log.insert(0, {
        "received_at":  _NOW(),
        "status":       "ok",
        "event_type":   payload.get("type", "unknown"),
        "meeting_id":   stored_id,
        "meeting_title": final_meeting["title"],
        "sig_verified": sig_ok,
    })
    del _webhook_log[_WEBHOOK_LOG_MAX:]

    return {"status": "ok", "meeting_id": stored_id}


# ══════════════════════════════════════════════════════════════════════════════
#  TECH AGENT
# ══════════════════════════════════════════════════════════════════════════════

def _task_tech(job_id: str) -> None:
    try:
        mod = _load_module(
            "Tech_Agent",
            AGENTS_DIR / "Tech Agent" / "Tech_Agent.py",
        )
        state: dict = mod.compile_and_run()
        result = state.get("final_strategic_output") or {}
        confidence = int((result.get("confidence_score") or 0.8) * 100)
        now = _NOW()

        insights = []
        for opp in result.get("opportunities", []):
            insights.append({
                "id": opp["id"],
                "category": "opportunity",
                "title": opp["title"],
                "description": opp["description"],
                "pillar_tag": "",
                "source_agent": "tech",
                "impact_level": _PRIORITY_MAP.get(opp.get("priority", "MEDIUM"), "medium"),
                "confidence_score": confidence,
                "reference_count": len(opp.get("signal_sources", [])),
                "created_at": now,
                "data_source": "live",
                "is_validated": False,
                "ai_suggestion": True,
                "evidence": {
                    "type": "statistical",
                    "explanation": opp.get("recommended_action", opp["description"]),
                    "data_points": {
                        "signal_sources": ", ".join(opp.get("signal_sources", [])),
                        "time_horizon": opp.get("time_horizon", ""),
                    },
                },
            })
        for thr in result.get("threats", []):
            insights.append({
                "id": thr["id"],
                "category": "threat",
                "title": thr["title"],
                "description": thr["description"],
                "pillar_tag": "",
                "source_agent": "tech",
                "impact_level": _PRIORITY_MAP.get(thr.get("priority", "HIGH"), "high"),
                "confidence_score": confidence,
                "reference_count": len(thr.get("signal_sources", [])),
                "created_at": now,
                "data_source": "live",
                "is_validated": False,
                "ai_suggestion": True,
                "evidence": {
                    "type": "statistical",
                    "explanation": thr.get("recommended_action", thr["description"]),
                    "data_points": {
                        "signal_sources": ", ".join(thr.get("signal_sources", [])),
                        "time_horizon": thr.get("time_horizon", ""),
                    },
                },
            })

        _apply_pillar_tags(insights)
        _finish(job_id, {
            "insights": insights,
            "executive_summary": result.get("executive_summary"),
            "key_deltas": result.get("key_deltas", []),
            "confidence_score": result.get("confidence_score"),
            "analysis_date": result.get("analysis_date"),
            "agent_errors": state.get("errors", []),
        })
    except Exception as exc:
        _fail(job_id, str(exc))


@app.post("/api/agents/tech/run", status_code=202)
def run_tech(background_tasks: BackgroundTasks):
    """Trigger the Tech Intelligence Cluster (GitHub + CISA + SerpApi → Gemini)."""
    job_id = _new_job()
    background_tasks.add_task(_task_tech, job_id)
    return {"job_id": job_id}


# ══════════════════════════════════════════════════════════════════════════════
#  BENCHMARK AGENT
#  Fast path: bulk OpenAlex fetch → frontend result immediately.
#  DB save runs in a daemon thread after the job is marked complete.
# ══════════════════════════════════════════════════════════════════════════════

def _task_benchmark(job_id: str) -> None:
    try:
        mod = _load_module(
            "benchmark_agent",
            AGENTS_DIR / "benchmark_agent.py",
        )
        # Step 1: fetch + parse (fast — 1-2 HTTP calls)
        all_data: list = mod._fetch_all_parsed()
        # Step 2: format for frontend and finish job immediately
        result: dict = mod._format_result(all_data)
        _finish(job_id, result)
        # Step 3: write to Supabase in a daemon thread — does not block the response
        threading.Thread(
            target=mod.write_all_to_db,
            args=(all_data,),
            daemon=True,
            name="benchmark-db-save",
        ).start()
    except Exception as exc:
        _fail(job_id, str(exc))


@app.post("/api/agents/benchmark/run", status_code=202)
def run_benchmark(background_tasks: BackgroundTasks):
    """Trigger the Benchmark Agent (OpenAlex bulk fetch + background Supabase save)."""
    job_id = _new_job()
    background_tasks.add_task(_task_benchmark, job_id)
    return {"job_id": job_id}


# ══════════════════════════════════════════════════════════════════════════════
#  WORKFORCE AGENT
# ══════════════════════════════════════════════════════════════════════════════

def _task_workforce(job_id: str) -> None:
    try:
        from Workforce_agent.agent import compile_and_run as workforce_run  # noqa: PLC0415

        data_path = os.getenv("WORKFORCE_DATA_PATH") or str(DATA_DIR / "real_workforce_data.json")
        result: dict = workforce_run(data_path=data_path)

        impact_map = {"High": "high", "Medium": "medium", "Low": "low"}
        now = _NOW()
        insights = []
        for i, item in enumerate(result.get("insights", []), start=1):
            category = "strength" if item.get("insight_type") == "Strength" else "weakness"
            insights.append({
                "id": f"wf-{i:02d}",
                "category": category,
                "title": item.get("metric_category", "HR Metric"),
                "description": item.get("finding", ""),
                "pillar_tag": "",
                "source_agent": "workforce",
                "impact_level": impact_map.get(item.get("impact_level", "Medium"), "medium"),
                "confidence_score": 85,
                "reference_count": 1,
                "created_at": now,
                "data_source": "live",
                "is_validated": False,
                "ai_suggestion": True,
                "evidence": {
                    "type": "calculation",
                    "explanation": item.get("finding", ""),
                    "data_points": {},
                },
            })

        _apply_pillar_tags(insights)
        _finish(job_id, {
            "insights": insights,
            "calculated_metrics": result.get("calculated_metrics", {}),
        })
    except Exception as exc:
        _fail(job_id, str(exc))


@app.post("/api/agents/workforce/run", status_code=202)
def run_workforce(background_tasks: BackgroundTasks):
    """Trigger the Workforce Agent (HR JSON → metric calc → Gemini insights)."""
    job_id = _new_job()
    background_tasks.add_task(_task_workforce, job_id)
    return {"job_id": job_id}


# ══════════════════════════════════════════════════════════════════════════════
#  SENTIMENT AGENT
# ══════════════════════════════════════════════════════════════════════════════

async def _task_sentiment_async(job_id: str, csv_path: str) -> None:
    try:
        mod = _load_module(
            "sentiment_engine",
            AGENTS_DIR / "Sentiment analysis" / "engine_local.py",
        )
        result: dict = await mod.compile_and_run(csv_path)

        if result.get("error"):
            _fail(job_id, result["error"])
            return

        report = result.get("aggregated_report") or {}
        now = _NOW()
        insights = []

        for item in report.get("top_strengths", []):
            label = str(item.get("label", ""))
            insights.append({
                "id": f"sa-s-{label[:16].replace(' ', '-').lower()}",
                "category": "strength",
                "title": label,
                "source_agent": "sentiment_analysis",
                "description": (
                    f"Mentioned by {item['value']} students "
                    f"({item.get('percentage', '0')}% of responses)"
                ),
                "pillar_tag": "",
                "impact_level": "high" if int(item.get("value", 0)) > 5 else "medium",
                "confidence_score": 78,
                "reference_count": int(item.get("value", 0)),
                "created_at": now,
                "data_source": "live",
                "is_validated": False,
                "ai_suggestion": True,
                "evidence": {
                    "type": "raw_text",
                    "explanation": "; ".join((item.get("quotes") or [])[:3]),
                    "data_points": {
                        "mention_count": item.get("value", 0),
                        "share_pct": item.get("percentage", "0"),
                    },
                },
            })
        for item in report.get("top_weaknesses", []):
            label = str(item.get("label", ""))
            insights.append({
                "id": f"sa-w-{label[:16].replace(' ', '-').lower()}",
                "category": "weakness",
                "title": label,
                "source_agent": "sentiment_analysis",
                "description": (
                    f"Mentioned by {item['value']} students "
                    f"({item.get('percentage', '0')}% of responses)"
                ),
                "pillar_tag": "",
                "impact_level": "high" if int(item.get("value", 0)) > 5 else "medium",
                "confidence_score": 78,
                "reference_count": int(item.get("value", 0)),
                "created_at": now,
                "data_source": "live",
                "is_validated": False,
                "ai_suggestion": True,
                "evidence": {
                    "type": "raw_text",
                    "explanation": "; ".join((item.get("quotes") or [])[:3]),
                    "data_points": {
                        "mention_count": item.get("value", 0),
                        "share_pct": item.get("percentage", "0"),
                    },
                },
            })

        _apply_pillar_tags(insights)
        _finish(job_id, {
            "insights": insights,
            "summary": report.get("summary", {}),
            "total_students": result.get("total_students", 0),
        })
    except Exception as exc:
        _fail(job_id, str(exc))


@app.post("/api/agents/sentiment/run", status_code=202)
async def run_sentiment(background_tasks: BackgroundTasks):
    """Trigger the Sentiment Agent (CSV → Ollama llama3.1 → semantic clustering)."""
    csv_path = os.getenv("SENTIMENT_CSV_PATH") or str(DATA_DIR / "cleaned_students.csv")
    job_id = _new_job()
    background_tasks.add_task(_task_sentiment_async, job_id, csv_path)
    return {"job_id": job_id}


# ══════════════════════════════════════════════════════════════════════════════
#  SOCIAL MEDIA AGENT
#  Reads cached ot_signals.json (instant) or re-runs Groq NLP pipeline.
#  Returns opportunity + threat InsightCards grouped by theme.
# ══════════════════════════════════════════════════════════════════════════════

def _task_social_media(job_id: str) -> None:
    try:
        # Evict cached modules so every run picks up the latest code and
        # so a previously failed selenium import doesn't stay frozen in cache.
        sys.modules.pop("nlp_pipeline", None)
        sys.modules.pop("scraper", None)
        sys.modules.pop("keywords", None)

        mod = _load_module(
            "nlp_pipeline",
            SOCIAL_AGENT_DIR / "nlp_pipeline.py",
        )
        result: dict = mod.compile_and_run()

        if result.get("error"):
            _fail(job_id, result["error"])
            return

        sm_insights = result.get("insights", [])
        for ins in sm_insights:
            ins["source_agent"] = "social_media"
        _apply_pillar_tags(sm_insights)
        _finish(job_id, {
            "insights":             sm_insights,
            "strengths":            result.get("strengths", 0),
            "weaknesses":           result.get("weaknesses", 0),
            "opportunities":        result.get("opportunities", 0),
            "threats":              result.get("threats", 0),
            "total_posts_analyzed": result.get("total_posts_analyzed", 0),
            "scrape_status":        result.get("scrape_status", "unknown"),
            "scrape_error":         result.get("scrape_error", ""),
        })
    except Exception as exc:
        _fail(job_id, str(exc))


@app.post("/api/agents/social/run", status_code=202)
def run_social(background_tasks: BackgroundTasks):
    """Trigger the Social Media Agent (Facebook groups → Groq NLP → SWOT signals)."""
    job_id = _new_job()
    background_tasks.add_task(_task_social_media, job_id)
    return {"job_id": job_id}


# ══════════════════════════════════════════════════════════════════════════════
#  SURVEY AGENT
#  Single-node LangGraph: GraphState.current_weaknesses + user_request
#  → local LLM structured output → SurveyDraft (list of SurveyQuestion)
# ══════════════════════════════════════════════════════════════════════════════

class SurveyRequest(BaseModel):
    audience: str = "All students"
    min_questions: int = 5
    max_questions: int = 10
    instructions: str = ""
    # Optional: pass current weaknesses from the live graph state so the agent
    # can tailor questions to known institutional gaps.
    current_weaknesses: list[str] = []


def _task_survey(job_id: str, req: SurveyRequest) -> None:
    try:
        mod = _load_module(
            "survey_agent",
            AGENTS_DIR / "Survey generation" / "survey_agent.py",
        )
        state_snapshot = {"current_weaknesses": req.current_weaknesses}
        user_request = {
            "audience": req.audience,
            "min_questions": req.min_questions,
            "max_questions": req.max_questions,
            "instructions": req.instructions,
        }
        result: dict = mod.compile_and_run(state_snapshot, user_request)
        _finish(job_id, result)
    except Exception as exc:
        _fail(job_id, str(exc))


@app.post("/api/agents/survey/run", status_code=202)
def run_survey(req: SurveyRequest, background_tasks: BackgroundTasks):
    """Trigger the Survey Agent (LangGraph → local LLM → structured SurveyDraft)."""
    job_id = _new_job()
    background_tasks.add_task(_task_survey, job_id, req)
    return {"job_id": job_id}


# ══════════════════════════════════════════════════════════════════════════════
#  KPI GENERATION AGENT
#  Planning Phase: maps measurable KPIs to the 7 NAQAAE Programmatic Standards.
#  Uses Nile University's KPI style (عدد/نسبة/وجود prefixes, internal entities).
#  Does NOT assign data sources — that is handled by a separate agent downstream.
# ══════════════════════════════════════════════════════════════════════════════

KPI_AGENT_PATH: Path = AGENTS_DIR / "kpi_generation" / "agent.py"


class KPIRequest(BaseModel):
    program_name: str = "علوم الحاسب"
    college_name: str = "كلية تكنولوجيا المعلومات وعلوم الحاسب"
    university_name: str = "جامعة النيل الأهلية"
    # Year range that sets the planning horizon and default timeframe label.
    planning_horizon: str = "2025-2028"
    # KPIs generated per NAQAAE standard (1–7 recommended; 3 is a good default).
    kpis_per_standard: int = 3


def _task_kpi(job_id: str, req: KPIRequest) -> None:
    try:
        if str(ROOT_DIR) not in sys.path:
            sys.path.insert(0, str(ROOT_DIR))

        sys.modules.pop("kpi_agent", None)

        if not KPI_AGENT_PATH.exists():
            raise FileNotFoundError(f"KPI agent not found: {KPI_AGENT_PATH}")

        mod = _load_module("kpi_agent", KPI_AGENT_PATH)

        result: dict = mod.compile_and_run(
            program_name=req.program_name,
            college_name=req.college_name,
            university_name=req.university_name,
            planning_horizon=req.planning_horizon,
            kpis_per_standard=req.kpis_per_standard,
        )

        if result.get("error"):
            _fail(job_id, result["error"])
            return

        _finish(job_id, result)
    except Exception as exc:
        _fail(job_id, str(exc))


@app.post("/api/agents/kpi/run", status_code=202)
def run_kpi(req: KPIRequest, background_tasks: BackgroundTasks):
    """
    Trigger the KPI Generation Agent.

    Generates measurable KPIs for each of the 7 NAQAAE Programmatic Standards
    in the style of Nile University's strategic plan. This is the Planning Phase
    only — KPIs are text/target drafts without data-source assignments.

    Poll GET /api/jobs/{job_id} for the result:
        {
          "kpis": [
            {
              "standard_id":        "1"–"7",
              "kpi_name":           "<Arabic name starting with عدد/نسبة/وجود/مدى>",
              "target_description": "<specific quantified target in Arabic>",
              "responsible_entity": "<internal NU role in Arabic>",
              "timeframe":          "<Arabic timeframe>"
            },
            ...
          ],
          "metadata": { "program", "college", "university",
                        "planning_horizon", "kpis_per_standard",
                        "total_kpis", "standards_covered" }
        }
    """
    job_id = _new_job()
    background_tasks.add_task(_task_kpi, job_id, req)
    return {"job_id": job_id}


# ══════════════════════════════════════════════════════════════════════════════
#  HITL GAP ANALYSIS
#  Phase 1 — GET  /api/gap-analysis/draft     → fetch editable draft data
#  Phase 2 — POST /api/gap-analysis/calculate → LangGraph QA agent → job_id
# ══════════════════════════════════════════════════════════════════════════════

# ── 7 Strategic Pillars for gap analysis ─────────────────────────────────────

_GAP_PILLARS = [
    "Program Mission and Management",
    "Program Design",
    "Teaching, Learning and Assessment",
    "Students and Graduate Outcomes",
    "Faculty and Teaching Assistants",
    "Resources and Learning Facilities",
    "Quality Assurance and Program Evaluation",
]

# ── Mock target states (used when Neo4j returns no matching Standard node) ────

_MOCK_TARGET_STATES: dict[str, str] = {
    "Program Mission and Management": (
        "The program shall have a clearly articulated, formally approved mission that "
        "guides its objectives, curriculum, and operational decisions. Governance "
        "structures must define roles and responsibilities at all levels, with "
        "transparent decision-making and documented annual leadership effectiveness "
        "reviews aligned to NAQAAE accreditation requirements."
    ),
    "Program Design": (
        "The program shall follow a systematic, stakeholder-inclusive design process. "
        "Program and course learning outcomes must be current, industry-validated "
        "through active advisory boards, regularly reviewed on a maximum 3-year cycle, "
        "explicitly mapped to course-level assessments, and aligned to national "
        "qualifications framework level descriptors."
    ),
    "Teaching, Learning and Assessment": (
        "The program shall employ diverse, evidence-based teaching and learning "
        "strategies aligned to intended learning outcomes. Assessment methods must "
        "include both formative and summative components, use calibrated rubrics, "
        "and results must be systematically analysed to drive documented curriculum "
        "improvements each academic cycle."
    ),
    "Students and Graduate Outcomes": (
        "The program shall demonstrate measurable graduate outcomes aligned to the "
        "national qualifications framework. Student support services, progression "
        "tracking, graduate attribute mapping, and alumni engagement must be "
        "systematically managed with documented evidence of continuous improvement "
        "driven by outcome data."
    ),
    "Faculty and Teaching Assistants": (
        "The program shall have structured, funded faculty recruitment, induction, "
        "professional development, performance appraisal, and career progression "
        "mechanisms. Academic staff must maintain current disciplinary expertise, "
        "adopt research-informed teaching, and have access to mentoring. Teaching "
        "load policies must allow meaningful engagement with development activities."
    ),
    "Resources and Learning Facilities": (
        "The program shall be supported by adequate, well-maintained physical and "
        "digital learning resources including laboratories, libraries, and technology "
        "infrastructure. Resources must be regularly reviewed for currency, "
        "accessibility, and alignment to program needs, with a transparent "
        "resource allocation and renewal plan."
    ),
    "Quality Assurance and Program Evaluation": (
        "The program shall operate a fully documented internal quality assurance "
        "system covering all academic and administrative processes. The system must "
        "include systematic review cycles, evidence-based improvement actions, "
        "structured student feedback loops, and cross-departmental QA collaboration "
        "with documented outcomes and closure of corrective actions."
    ),
}

# ── Mock strengths / weaknesses (Supabase placeholder until fully wired) ──────

_MOCK_STRENGTHS: dict[str, str] = {
    "Program Mission and Management": (
        "Program mission statement is formally documented and publicly accessible. "
        "Annual leadership performance reviews are conducted with documented outcomes. "
        "Program committee meets regularly with published minutes and action logs."
    ),
    "Program Design": (
        "Program advisory boards include active industry representatives. "
        "Curriculum review meetings are scheduled and held annually per program. "
        "Course syllabi are standardised in format and centrally stored."
    ),
    "Teaching, Learning and Assessment": (
        "A variety of active learning methodologies are employed across core courses. "
        "Assessment blueprints are aligned to stated course learning outcomes. "
        "Faculty receive training on formative assessment design each academic year."
    ),
    "Students and Graduate Outcomes": (
        "Program learning outcomes are documented and published for all undergraduate "
        "programs. Graduate exit surveys are administered every semester. "
        "An alumni tracking and engagement study was launched in the current academic year."
    ),
    "Faculty and Teaching Assistants": (
        "An annual professional development budget is allocated per faculty member. "
        "Participation in international conferences is financially supported. "
        "A classroom observation and peer-review protocol is formally in place."
    ),
    "Resources and Learning Facilities": (
        "Laboratories are equipped with up-to-date instrumentation aligned to program "
        "needs. An online learning platform (LMS) is fully deployed and actively used. "
        "Library digital collections are reviewed and renewed annually."
    ),
    "Quality Assurance and Program Evaluation": (
        "A dedicated Quality Assurance Unit with a full-time director is operational. "
        "Internal audit cycles are completed bi-annually across all faculties. "
        "ISO 9001 certification process has been initiated for administrative processes."
    ),
}

_MOCK_WEAKNESSES: dict[str, str] = {
    "Program Mission and Management": (
        "Program mission is not consistently communicated or applied across "
        "departments. Decision-making authority at middle-management level remains "
        "unclear. No formal succession planning process exists for key program "
        "leadership positions."
    ),
    "Program Design": (
        "Curriculum revision cycles exceed three years for several programs, creating "
        "currency risks. Industry advisory board engagement is inconsistent and "
        "poorly documented. Learning outcomes are not regularly validated against "
        "current labour market data or employer feedback."
    ),
    "Teaching, Learning and Assessment": (
        "Indirect assessment methods dominate; direct evidence of student learning "
        "is sparse and inconsistently collected. Assessment rubrics lack formal "
        "calibration across evaluators. Feedback turnaround to students exceeds "
        "recommended timelines in several courses."
    ),
    "Students and Graduate Outcomes": (
        "Graduate attribute mapping across the curriculum is incomplete. Alumni "
        "engagement is sporadic and not systematically tracked. Career placement "
        "data is collected inconsistently, limiting outcome benchmarking."
    ),
    "Faculty and Teaching Assistants": (
        "No structured mentoring or coaching program exists for junior faculty. "
        "Professional development is largely self-directed with inconsistent uptake. "
        "Teaching load volumes prevent meaningful engagement with available training "
        "and development opportunities."
    ),
    "Resources and Learning Facilities": (
        "Some laboratory equipment is outdated and not calibrated to current "
        "industry standards. Remote access to digital resources is limited for "
        "off-campus students. A formal resource adequacy review process has not "
        "been established."
    ),
    "Quality Assurance and Program Evaluation": (
        "QA unit findings rarely result in documented, time-bound corrective action "
        "plans with assigned owners. Student feedback collection loops are incomplete "
        "and results are not communicated back to students. Cross-departmental QA "
        "collaboration remains minimal and informal."
    ),
}

# ── Pillar → NAQAAE Standard keyword map ─────────────────────────────────────
#
# H1 headers in the ingested Markdown files produce Standard node titles like:
#   "Standard (1): Program Mission and Management — 4 Indicators (Amended)"
#   "Standard (2): Program Design — 4 Indicators (Amended)"
#   "Standard (3): Teaching, Learning and Assessment — ..."
#   "Standard (4): Students and Graduates — ..."
#   "Standard (5): Faculty and Teaching Assistants — ..."
#   "Standard (6): Resources and Learning Facilities — ..."
#   "Standard (7): Quality Assurance and Program Evaluation — ..."
#
# Each list is tried in order; the first keyword that returns chunks wins.

_PILLAR_KEYWORDS: dict[str, list[str]] = {
    "Program Mission and Management":           ["Mission and Management"],
    "Program Design":                           ["Program Design"],
    "Teaching, Learning and Assessment":        ["Teaching, Learning"],
    "Students and Graduate Outcomes":           ["Students and Graduates"],
    "Faculty and Teaching Assistants":          ["Faculty and Teaching"],
    "Resources and Learning Facilities":        ["Learning Sources"],
    "Quality Assurance and Program Evaluation": ["Quality Assurance and Program Evaluation"],
}

# ── Neo4j lazy connection (reuses credentials from .env) ─────────────────────

_neo4j_driver: Any = None


def _get_neo4j_driver() -> Any:
    global _neo4j_driver
    uri  = os.getenv("NEO4J_URI", "")
    user = os.getenv("NEO4J_USERNAME", "")
    pw   = os.getenv("NEO4J_PASSWORD", "")
    if not all([uri, user, pw]):
        return None
    try:
        if _neo4j_driver is None:
            from neo4j import GraphDatabase as _GD
            _neo4j_driver = _GD.driver(uri, auth=(user, pw))
        return _neo4j_driver
    except Exception as exc:
        print(f"[neo4j] Connection failed: {exc}")
        return None


def _query_target_state(pillar: str) -> str | None:
    """
    Query the NAQAAE knowledge graph for all text chunks that belong to the
    Standard node matching this pillar, then return them concatenated as the
    target state paragraph.

    Traversal:
        Standard -[:HAS_CHUNK]-> Chunk           (preamble chunks directly on Standard)
        Standard -[:HAS_CRITERION]-> Criterion -[:HAS_CHUNK]-> Chunk  (body chunks)

    Keywords are tried in priority order from _PILLAR_KEYWORDS so that
    "Quality Assurance and Program Evaluation" is tried before the shorter
    substring "Quality Assurance", preventing accidental partial matches.
    """
    driver = _get_neo4j_driver()
    if driver is None:
        print(f"[neo4j] No connection — falling back to mock for '{pillar}'")
        return None

    keywords = _PILLAR_KEYWORDS.get(pillar, [pillar])

    for keyword in keywords:
        try:
            with driver.session() as session:
                records = session.run(
                    """
                    MATCH (s:Standard)
                    WHERE toLower(s.title) CONTAINS toLower($keyword)
                    CALL (s) {
                        MATCH (s)-[:HAS_CHUNK]->(ch:Chunk)
                        RETURN ch.content AS content, ch.position AS pos
                        UNION
                        MATCH (s)-[:HAS_CRITERION]->()-[:HAS_CHUNK]->(ch:Chunk)
                        RETURN ch.content AS content, ch.position AS pos
                        UNION
                        MATCH (s)-[:HAS_CRITERION]->()-[:HAS_INDICATOR]->()-[:HAS_CHUNK]->(ch:Chunk)
                        RETURN ch.content AS content, ch.position AS pos
                    }
                    RETURN content, pos
                    ORDER BY pos ASC
                    """,
                    keyword=keyword,
                ).data()

                if records:
                    combined = "\n\n".join(
                        r["content"] for r in records if r.get("content")
                    ).strip()
                    if combined:
                        print(
                            f"[neo4j] '{pillar}' → {len(records)} chunk(s) "
                            f"from Standard matching '{keyword}'"
                        )
                        return combined

        except Exception as exc:
            print(f"[neo4j] Query error for '{pillar}' / keyword '{keyword}': {exc}")
            return None  # don't retry further keywords if the driver itself errored

    print(f"[neo4j] No chunks found for '{pillar}' — run ingest_graph.py first")
    return None


# ── Supabase: fetch live SWOT items grouped by pillar_id ─────────────────────

def _fetch_swot_by_pillar() -> dict[int, dict[str, list[dict]]]:
    """
    Return the most recent SWOT items per agent, grouped by pillar_id (1–7)
    and type. Each item is a structured dict with full metadata for traceability.
    """
    conn = _get_db_conn()
    if not conn:
        return {}
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                WITH latest_runs AS (
                    SELECT DISTINCT ON (agent_id) run_id, agent_id
                    FROM agent_runs
                    ORDER BY agent_id, run_timestamp DESC
                )
                SELECT si.item_id::text, si.type, si.title, si.description,
                       si.pillar_id, si.pillar_name, si.impact_level,
                       si.evidence, si.source_metadata,
                       lr.agent_id
                FROM swot_items si
                JOIN latest_runs lr ON si.run_id = lr.run_id
                WHERE si.pillar_id IS NOT NULL
                  AND si.description IS NOT NULL
                  AND si.description != ''
                """
            )
            rows = cur.fetchall()
    except Exception as exc:
        print(f"[gap-analysis] swot query failed: {exc}")
        return {}

    result: dict[int, dict[str, list[dict]]] = {}
    for row in rows:
        pid       = row["pillar_id"]
        swot_type = row["type"]
        desc      = (row["description"] or "").replace("\x00", "").strip()
        if not desc:
            continue
        if pid not in result:
            result[pid] = {"strength": [], "weakness": [], "opportunity": [], "threat": []}
        if swot_type in result[pid]:
            result[pid][swot_type].append({
                "item_id":         row["item_id"],
                "title":           (row["title"] or "").replace("\x00", "") or desc[:60],
                "description":     desc,
                "agent_id":        row["agent_id"] or "",
                "impact_level":    row["impact_level"] or "medium",
                "pillar_name":     row["pillar_name"] or "",
                "evidence":        row["evidence"],
                "source_metadata": row["source_metadata"],
            })
    return result


def _join_items(items: list[dict]) -> str:
    """Join structured SWOT items into a plain-text block for the LLM."""
    return "\n\n".join(f"• {i['description']}" for i in items)


# ══════════════════════════════════════════════════════════════════════════════
#  LATEST AGENT RESULTS FROM DB
# ══════════════════════════════════════════════════════════════════════════════

_SWOT_AGENTS = ("tech", "workforce", "sentiment_analysis", "social_media")


@app.get("/api/agents/results/latest")
def get_latest_agent_results():
    """
    Return the most recent InsightCards for all four SWOT agents from Supabase.
    Each insight includes source_agent so the frontend can slot it per-agent.
    """
    dsn = os.getenv("DB_CONNECTION_STRING", "")
    if not dsn:
        return {"insights": [], "agents": {}}
    # Use a fresh connection — the shared _db_conn can be in a broken state
    # from prior requests, causing silent empty results.
    try:
        conn = psycopg2.connect(dsn)
    except Exception as exc:
        print(f"[latest-results] connection failed: {exc}")
        return {"insights": [], "agents": {}}
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT DISTINCT ON (agent_id)
                    run_id, agent_id, run_timestamp, status
                FROM agent_runs
                WHERE agent_id = ANY(%s)
                ORDER BY agent_id, run_timestamp DESC
                """,
                (list(_SWOT_AGENTS),),
            )
            latest_runs = {r["agent_id"]: dict(r) for r in cur.fetchall()}
            if not latest_runs:
                return {"insights": [], "agents": {}}

            run_ids = [str(r["run_id"]) for r in latest_runs.values()]
            cur.execute(
                """
                SELECT si.item_id, si.run_id::text, si.type, si.title, si.description,
                       si.evidence, si.impact_level, si.pillar_id, si.pillar_name,
                       si.source_metadata
                FROM swot_items si
                WHERE si.run_id::text = ANY(%s)
                  AND si.description IS NOT NULL
                ORDER BY si.item_id
                """,
                (run_ids,),
            )
            rows = cur.fetchall()
    except Exception as exc:
        print(f"[latest-results] query failed: {exc}")
        conn.close()
        return {"insights": [], "agents": {}}

    run_to_agent = {r["run_id"]: r for r in latest_runs.values()}
    counts: dict[str, int] = {aid: 0 for aid in latest_runs}
    insights = []

    for row in rows:
        meta  = run_to_agent.get(row["run_id"], {})
        agent = meta.get("agent_id", "unknown")
        sm    = row["source_metadata"] or {}

        # Sanitize null bytes before any use
        desc  = (row["description"] or "").replace("\x00", "")
        title = (row["title"] or desc[:60]).replace("\x00", "")
        if not desc:
            continue

        ev_raw = row["evidence"]
        if isinstance(ev_raw, dict) and ev_raw.get("type"):
            evidence = ev_raw
        elif isinstance(ev_raw, list):
            evidence = next(
                (item for item in ev_raw if isinstance(item, dict) and item.get("type")),
                {"type": "raw_text", "explanation": desc, "data_points": {}},
            )
        else:
            evidence = {"type": "raw_text", "explanation": desc, "data_points": {}}

        ts = meta.get("run_timestamp")
        insights.append({
            "id":               f"{agent}-{row['item_id']}",
            "category":         row["type"],
            "title":            title,
            "description":      desc,
            "pillar_tag":       row["pillar_name"] or "",
            "impact_level":     row["impact_level"] or "medium",
            "confidence_score": sm.get("confidence_score", 80),
            "reference_count":  sm.get("reference_count", 1),
            "created_at":       ts.isoformat() if hasattr(ts, "isoformat") else str(ts or _NOW()),
            "data_source":      "live",
            "is_validated":     False,
            "ai_suggestion":    True,
            "source_agent":     agent,
            "evidence":         evidence,
        })
        counts[agent] = counts.get(agent, 0) + 1

    agents_meta = {
        aid: {
            "run_timestamp": (
                latest_runs[aid]["run_timestamp"].isoformat()
                if hasattr(latest_runs[aid]["run_timestamp"], "isoformat")
                else str(latest_runs[aid]["run_timestamp"])
            ),
            "status": latest_runs[aid]["status"],
            "count":  counts.get(aid, 0),
        }
        for aid in latest_runs
    }
    conn.close()
    return {"insights": insights, "agents": agents_meta}


# ── Phase 1: Fetch draft ──────────────────────────────────────────────────────

@app.get("/api/gap-analysis/draft")
def get_gap_analysis_draft():
    """
    Fetch editable draft data for the 7 Strategic Pillars.

    Target states come from the Neo4j NAQAAE knowledge graph (mock fallback).
    Strengths, weaknesses, opportunities, and threats come from the latest
    Supabase agent run results (mock fallback when no real data exists).

    pillar_id is derived from position in _GAP_PILLARS (1-indexed) which
    matches the categorizer's canonical pillar IDs 1–7.
    """
    swot_by_pillar = _fetch_swot_by_pillar()

    pillars_data = []
    for idx, pillar in enumerate(_GAP_PILLARS, start=1):
        neo4j_content = _query_target_state(pillar)
        real = swot_by_pillar.get(idx, {})

        s_items  = real.get("strength",    [])
        w_items  = real.get("weakness",    [])
        o_items  = real.get("opportunity", [])
        t_items  = real.get("threat",      [])
        has_live_sw = bool(s_items or w_items)

        # Plain text for LLM; structured items for UI clickable chips
        strengths_text  = _join_items(s_items) if s_items else _MOCK_STRENGTHS.get(pillar, "")
        weaknesses_text = _join_items(w_items) if w_items else _MOCK_WEAKNESSES.get(pillar, "")
        opps_text       = _join_items(o_items) if o_items else ""
        threats_text    = _join_items(t_items) if t_items else ""

        pillars_data.append({
            "pillar":             pillar,
            "target_state":       neo4j_content or _MOCK_TARGET_STATES[pillar],
            "strengths":          strengths_text,
            "weaknesses":         weaknesses_text,
            "opportunities":      opps_text,
            "threats":            threats_text,
            "strength_items":     s_items,
            "weakness_items":     w_items,
            "opportunity_items":  o_items,
            "threat_items":       t_items,
            "target_source":      "neo4j" if neo4j_content else "mock",
            "swot_source":        "live"  if has_live_sw   else "mock",
        })

    return {"pillars": pillars_data, "data_source": "live+neo4j"}


# ── Phase 2: Calculate gap ────────────────────────────────────────────────────

class GapCalculateRequest(BaseModel):
    pillars: list[dict]  # list of PillarDraft objects from the frontend


def _task_gap_calculate(job_id: str, pillars: list[dict]) -> None:
    try:
        # Ensure project root is on sys.path so `from core.llm import ...` resolves
        if str(ROOT_DIR) not in sys.path:
            sys.path.insert(0, str(ROOT_DIR))

        # Always evict the cached entry before loading.
        # _load_module registers the module in sys.modules BEFORE exec_module runs,
        # so a failed first load leaves a broken empty shell in the cache.
        # Every subsequent call would return that shell (missing compile_and_run).
        sys.modules.pop("gap_analysis_agent", None)

        
        if not GAP_ANALYSIS_AGENT_PATH.exists():
            raise FileNotFoundError(f"Agent file not found: {GAP_ANALYSIS_AGENT_PATH}")

        mod = _load_module("gap_analysis_agent", GAP_ANALYSIS_AGENT_PATH)

        if not hasattr(mod, "compile_and_run"):
            raise AttributeError(
                "gap_analysis_agent loaded but compile_and_run is missing. "
                "Check the agent file for top-level import errors."
            )

        result: list[dict] = mod.compile_and_run(pillars)
        _finish(job_id, result)
    except Exception as exc:
        _fail(job_id, str(exc))


@app.post("/api/gap-analysis/calculate", status_code=202)
async def calculate_gap_analysis(
    req: GapCalculateRequest,
    background_tasks: BackgroundTasks,
):
    """
    Run the LangGraph QA agent on user-edited pillar data.

    Accepts the 7-pillar payload edited by the user in the frontend, queues a
    background LangGraph job, and returns a job_id for polling via
    GET /api/jobs/{job_id}.
    """
    job_id = _new_job()
    background_tasks.add_task(_task_gap_calculate, job_id, req.pillars)
    return {"job_id": job_id}
