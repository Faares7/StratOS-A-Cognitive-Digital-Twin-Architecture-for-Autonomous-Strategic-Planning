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

NAQAAE_TECH_OPP   = "Pillar 12: Digital Transformation"
NAQAAE_TECH_THR   = "Pillar 3: Quality Assurance Systems"
NAQAAE_WORKFORCE  = "Pillar 4: Faculty Development"
NAQAAE_SENTIMENT  = "Pillar 5: Student Learning Outcomes"
NAQAAE_SOCIAL_OPP = "Pillar 8: Community Engagement"
NAQAAE_SOCIAL_THR = "Pillar 2: Strategic Planning"


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
                "pillar_tag": NAQAAE_TECH_OPP,
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
                "pillar_tag": NAQAAE_TECH_THR,
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

        data_path = os.getenv("WORKFORCE_DATA_PATH") or str(DATA_DIR / "mock_workforce_data.json")
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
                "pillar_tag": NAQAAE_WORKFORCE,
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
                "description": (
                    f"Mentioned by {item['value']} students "
                    f"({item.get('percentage', '0')}% of responses)"
                ),
                "pillar_tag": NAQAAE_SENTIMENT,
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
                "description": (
                    f"Mentioned by {item['value']} students "
                    f"({item.get('percentage', '0')}% of responses)"
                ),
                "pillar_tag": NAQAAE_SENTIMENT,
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
        mod = _load_module(
            "nlp_pipeline",
            SOCIAL_AGENT_DIR / "nlp_pipeline.py",
        )
        result: dict = mod.compile_and_run()

        if result.get("error"):
            _fail(job_id, result["error"])
            return

        _finish(job_id, {
            "insights": result.get("insights", []),
            "opportunities": result.get("opportunities", 0),
            "threats": result.get("threats", 0),
            "total_posts_analyzed": result.get("total_posts_analyzed", 0),
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
