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
from typing import Any, Optional

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
load_dotenv(ROOT_DIR / ".env", override=True)

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
    # Bounded connect: a slow/unreachable Supabase (e.g. free-tier auto-pause) must
    # not hang startup forever — fail fast so the server still comes online.
    try:
        if _db_conn is None or _db_conn.closed:
            _db_conn = psycopg2.connect(dsn, connect_timeout=10)
            _db_conn.autocommit = True
        # lightweight ping to detect stale pooler connections
        _db_conn.cursor().execute("SELECT 1")
        return _db_conn
    except Exception:
        try:
            _db_conn = psycopg2.connect(dsn, connect_timeout=10)
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
        "progress": None,
        "started_at": _NOW(),
        "finished_at": None,
    }
    return job_id


def _set_progress(job_id: str, processed: int, total: int, stage: str = "generating") -> None:
    if job_id in _jobs:
        _jobs[job_id]["progress"] = {"processed": processed, "total": total, "stage": stage}


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


class _TokenHandoff(BaseModel):
    access_token:  str
    refresh_token: str | None = None
    email:         str | None = None


@app.post("/api/auth/google/handoff")
def google_auth_handoff(body: _TokenHandoff):
    """
    Accept the Google access+refresh token from the NextAuth session
    (set during onboarding) so the meetings agent can use it without
    a separate OAuth popup.
    """
    _google_tokens["primary"] = {
        "access_token":  body.access_token,
        "refresh_token": body.refresh_token or "",
        "email":         body.email or "",
        "expires_at":    time.time() + 3500,   # ~1 h; refresh logic handles expiry
    }
    _db_save_tokens(_google_tokens["primary"])
    return {"ok": True, "email": body.email}


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
      2. recording_start_time vs meeting.date within 3 hours — handles Fathom labelling
         calendar events as "Impromptu" (title is unreliable; time is not).
         Picks the closest unprocessed meeting when multiple exist.
      3. meeting_title + recording time within 3 hours — last resort when time alone
         is ambiguous (e.g. two back-to-back meetings in the same window).

    Fathom's `title` field is auto-generated ("Impromptu Google Meet Meeting") and
    must NOT be used for matching. `meeting_title` is the Google Calendar event name.
    """
    unprocessed = {mid: m for mid, m in _meetings.items() if not m.get("fathom_call_id")}
    if not unprocessed:
        return None

    raw = raw_payload or {}

    # ── Strategy 1: scheduled_start_time exact match ─────────────────────────
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

    # ── Strategy 2: recording_start_time proximity (title-independent) ────────
    # Fathom calls calendar-booked meetings "Impromptu" when it auto-joins, so
    # we cannot rely on the title. Matching by time is sufficient in practice.
    rec_str = raw.get("recording_start_time") or fathom_data.get("date", "")
    if rec_str:
        try:
            rec_dt = datetime.fromisoformat(rec_str.replace("Z", "+00:00"))
            best_mid, best_delta = None, float("inf")
            for mid, m in unprocessed.items():
                try:
                    m_dt = datetime.fromisoformat(m.get("date", "").replace("Z", "+00:00"))
                    delta = abs((rec_dt - m_dt).total_seconds())
                    if delta < 10_800 and delta < best_delta:  # within 3 h, pick closest
                        best_delta = delta
                        best_mid = mid
                except Exception:
                    pass
            if best_mid:
                print(f"[meetings] Matched by recording_start_time proximity → {best_mid}")
                return best_mid
        except Exception:
            pass

    # ── Strategy 3: meeting_title + recording time within 3 hours ────────────
    title    = str(raw.get("meeting_title") or fathom_data.get("title") or "").strip().lower()
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
    access_token: str = ""  # user's own Google token from NextAuth session


@app.post("/api/meetings/schedule", status_code=201)
def schedule_meeting(req: ScheduleMeetingRequest):
    """
    Create a meeting. If Google Calendar is authorised, also creates a
    Calendar event with a Google Meet link and invites all attendees.
    """
    meeting_id = f"cal-{uuid.uuid4().hex[:10]}"

    meet_link = calendar_event_id = html_link = ""

    # Prefer the user's own Google token (forwarded from NextAuth session);
    # fall back to the shared admin token for backward compatibility.
    access_token = req.access_token or _get_valid_access_token()

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
    audience_key: str = ""
    min_questions: int = 5
    max_questions: int = 10
    instructions: str = ""


def _task_survey(job_id: str, req: SurveyRequest) -> None:
    try:
        mod = _load_module(
            "survey_agent",
            AGENTS_DIR / "Survey generation" / "survey_agent.py",
        )
        user_request = {
            "audience":      req.audience,
            "audience_key":  req.audience_key,
            "min_questions": req.min_questions,
            "max_questions": req.max_questions,
            "instructions":  req.instructions,
        }
        # state_snapshot is empty — the agent auto-loads SWOT from the DB
        result: dict = mod.compile_and_run({}, user_request)
        _finish(job_id, result)
    except Exception as exc:
        _fail(job_id, str(exc))


@app.post("/api/agents/survey/run", status_code=202)
def run_survey(req: SurveyRequest, background_tasks: BackgroundTasks):
    """Trigger the Survey Agent (LangGraph → local LLM → structured SurveyDraft)."""
    job_id = _new_job()
    background_tasks.add_task(_task_survey, job_id, req)
    return {"job_id": job_id}


# ── Survey UI convenience routes (synchronous, used by the Surveys page) ──────

_SURVEY_TEMPLATES_PATH = ROOT_DIR / "Data" / "survey_templates.json"

def _load_survey_templates() -> dict:
    try:
        with open(_SURVEY_TEMPLATES_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"[survey] could not load templates from {_SURVEY_TEMPLATES_PATH}: {e}")
        return {}


@app.get("/api/survey/templates")
def survey_templates():
    """Return the bilingual template question sets keyed by audience (loaded from Data/survey_templates.json)."""
    return _load_survey_templates()


class SurveyGenerateRequest(BaseModel):
    audience: str = "mixed"
    audience_key: str = ""
    custom_prompt: str = ""


@app.post("/api/survey/generate-full")
def survey_generate_full(req: SurveyGenerateRequest):
    """
    Synchronously generate a survey via the LLM.

    Returns {questions: list[str], source: "ai"} on success.
    Raises HTTP 502 if the LLM call fails.
    """
    try:
        mod = _load_module(
            "survey_agent",
            AGENTS_DIR / "Survey generation" / "survey_agent.py",
        )
        result: dict = mod.compile_and_run(
            state_snapshot={},
            user_request={
                "audience":     req.audience,
                "audience_key": req.audience_key,
                "min_questions": 5,
                "max_questions": 10,
                "instructions": req.custom_prompt,
            },
        )
        if result.get("error"):
            raise HTTPException(status_code=502, detail=result["error"])

        raw_questions = result.get("questions", [])
        # return full dicts {text, answer_type, pillar} so the frontend can use all fields
        question_objects = [
            q if isinstance(q, dict) else {"text": str(q), "answer_type": "strongly-agree-disagree", "pillar": ""}
            for q in raw_questions
        ]
        return {"questions": question_objects, "source": "ai"}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


class RegenerateQuestionRequest(BaseModel):
    original_question: str
    user_instruction: str


@app.post("/api/survey/regenerate-question")
def survey_regenerate_question(req: RegenerateQuestionRequest):
    """
    Tweak a single survey question using the LLM.

    Returns {question: str} with the rewritten question text.
    """
    try:
        from core.llm import local_brain
        from langchain_core.messages import HumanMessage, SystemMessage

        prompt = (
            f"Original question: {req.original_question}\n\n"
            f"Instruction: {req.user_instruction}\n\n"
            "Rewrite the question following the instruction. "
            "Keep it concise (≤15 words), unambiguous, and suitable for a university survey. "
            "Return ONLY the rewritten question text — no explanation, no quotes."
        )
        response = local_brain.invoke(
            [
                SystemMessage(content="You are an expert university survey designer."),
                HumanMessage(content=prompt),
            ]
        )
        text = response.content.strip().strip('"').strip("'")
        return {"question": text}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


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
#  ACTION PLAN AGENT  (الخطة التنفيذية)
#  Run → Goal → Objective → Action item. For an APPROVED (plan_status='final')
#  strategy run, drafts 2–4 executive activities per objective and fills the
#  operational columns. "LLM classifies, Python computes" — Gemini writes the
#  prose / picks the archetype; Python prices it from Data/financials/* with
#  per-year inflation and a soft 5%-of-tuition ceiling check.
# ══════════════════════════════════════════════════════════════════════════════

ACTION_PLAN_AGENT_PATH: Path = AGENTS_DIR / "action_planner" / "action_planner.py"


class ActionPlanRequest(BaseModel):
    run_id: str
    enable_self_critique: bool = True
    require_final: bool = True


def _ensure_action_planner(reload: bool = False) -> Any:
    """Load the action planner module by path (cached unless reload=True)."""
    if str(ROOT_DIR) not in sys.path:
        sys.path.insert(0, str(ROOT_DIR))
    if reload:
        sys.modules.pop("action_plan_agent", None)
    if not ACTION_PLAN_AGENT_PATH.exists():
        raise FileNotFoundError(f"Action planner not found: {ACTION_PLAN_AGENT_PATH}")
    return _load_module("action_plan_agent", ACTION_PLAN_AGENT_PATH)


def _task_action_plan(job_id: str, req: ActionPlanRequest) -> None:
    try:
        mod = _ensure_action_planner(reload=True)
        result: dict = mod.compile_and_run(
            req.run_id,
            enable_self_critique=req.enable_self_critique,
            require_final=req.require_final,
            progress_cb=lambda done, total: _set_progress(job_id, done, total),
        )
        if result.get("error"):
            _fail(job_id, result["error"])
            return
        _finish(job_id, result)
    except Exception as exc:
        _fail(job_id, str(exc))


@app.post("/api/action-plan", status_code=202)
def run_action_plan(req: ActionPlanRequest, background_tasks: BackgroundTasks):
    """
    Trigger the Action Plan agent for a finalized strategy run (background job).

    Returns 202 + {job_id}. Poll GET /api/jobs/{job_id} for the budget summary;
    read the full plan via GET /api/action-plan/{run_id}.
    """
    if not req.run_id:
        raise HTTPException(status_code=400, detail="run_id is required")
    job_id = _new_job()
    background_tasks.add_task(_task_action_plan, job_id, req)
    return {"job_id": job_id}


# NOTE: these static paths MUST be declared before /api/action-plan/{run_id},
# otherwise "runs"/"vocab" are captured as a run_id.
@app.get("/api/action-plan/vocab")
def action_plan_vocab():
    """Controlled vocabularies for the editor — single source of truth for the UI."""
    mod = _ensure_action_planner()
    catalog = mod.load_catalog()
    return {
        "roles": list(mod.ROLE_VOCAB),
        "archetypes": [
            {
                "key": k,
                "label": catalog[k].get("label", k),
                "description": catalog[k].get("description", ""),
                "base_cost_egp": catalog[k].get("base_cost_egp"),
                "cost_driver": catalog[k].get("cost_driver"),
                "funding_source": catalog[k].get("funding_source"),
            }
            for k in mod.ARCHETYPE_KEYS
        ],
    }


@app.get("/api/action-plan/runs")
def list_action_plan_runs():
    """Strategy runs that have goals/objectives — candidates for the run picker."""
    conn = _get_db_conn()
    if not conn:
        raise HTTPException(status_code=503, detail="Database not configured")
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT r.run_id, r.run_timestamp,
                   r.structured_data->>'plan_status' AS plan_status,
                   (SELECT count(*) FROM strategic_goals g WHERE g.run_id = r.run_id) AS goals,
                   (SELECT count(*) FROM strategic_objectives o
                        JOIN strategic_goals g ON o.goal_id = g.goal_id
                        WHERE g.run_id = r.run_id) AS objectives,
                   EXISTS(SELECT 1 FROM strategic_actions a WHERE a.run_id = r.run_id) AS has_action_plan
            FROM agent_runs r
            WHERE r.agent_id = 'goals_planner'
              AND EXISTS (SELECT 1 FROM strategic_goals g WHERE g.run_id = r.run_id)
            ORDER BY r.run_timestamp DESC
            LIMIT 50
            """
        )
        rows = cur.fetchall()
    return {
        "runs": [
            {
                "run_id": str(r["run_id"]),
                "plan_status": r["plan_status"],
                "created_at": r["run_timestamp"].isoformat() if r["run_timestamp"] else None,
                "goals": r["goals"],
                "objectives": r["objectives"],
                "has_action_plan": r["has_action_plan"],
            }
            for r in rows
        ]
    }


@app.get("/api/action-plan/{run_id}")
def get_action_plan(run_id: str):
    """
    Return the generated action plan for a run, grouped Goal → Objective → Actions,
    with a recomputed per-year budget summary. Friendly empty shape if not yet generated.
    """
    conn = _get_db_conn()
    if not conn:
        raise HTTPException(status_code=503, detail="Database not configured")

    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT
                    g.goal_id, g.title AS goal_title, g.description AS goal_description,
                    o.objective_id, o.text AS objective_text, o.tows_type, o.pillar_id,
                    a.action_id, a.activity_rationale, a.activity_text, a.kpi_name,
                    a.timeline_reasoning, a.start_quarter, a.end_quarter, a.start_year_index,
                    a.responsible_exec, a.responsible_monitor,
                    a.classification_reasoning, a.assigned_archetype, a.duration_multiplier,
                    a.base_cost_egp, a.inflated_cost_egp, a.cost_driver, a.funding_source,
                    a.cost_explanation, a.edited_by_user, a.position AS action_pos
                FROM strategic_actions a
                JOIN strategic_objectives o ON a.objective_id = o.objective_id
                JOIN strategic_goals g ON o.goal_id = g.goal_id
                WHERE a.run_id = %s
                ORDER BY g.position, o.position, a.position
                """,
                (run_id,),
            )
            rows = cur.fetchall()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Query failed: {exc}")

    if not rows:
        return {
            "run_id": run_id,
            "generated": False,
            "goals": [],
            "budget_summary": None,
            "totals": {"goals": 0, "objectives": 0, "actions": 0},
        }

    mod = _ensure_action_planner()
    pillar_names = mod.PILLAR_NAMES

    goals: dict[str, dict] = {}
    objectives: dict[str, dict] = {}
    priced: list[dict] = []

    for r in rows:
        gid = str(r["goal_id"])
        if gid not in goals:
            goals[gid] = {
                "goal_id": gid,
                "title": r["goal_title"],
                "description": r["goal_description"],
                "objectives": [],
            }
        oid = str(r["objective_id"])
        if oid not in objectives:
            obj = {
                "objective_id": oid,
                "text": r["objective_text"],
                "tows_type": r["tows_type"],
                "pillar_id": r["pillar_id"],
                "pillar_name": pillar_names.get(r["pillar_id"]),
                "actions": [],
            }
            objectives[oid] = obj
            goals[gid]["objectives"].append(obj)

        inflated = float(r["inflated_cost_egp"]) if r["inflated_cost_egp"] is not None else 0.0
        base = float(r["base_cost_egp"]) if r["base_cost_egp"] is not None else 0.0
        is_central = r["funding_source"] == "central_capex"
        objectives[oid]["actions"].append(
            {
                "action_id": str(r["action_id"]),
                "activity_rationale": r["activity_rationale"],
                "activity_text": r["activity_text"],
                "kpi_name": r["kpi_name"],
                "timeline_reasoning": r["timeline_reasoning"],
                "start_quarter": r["start_quarter"],
                "end_quarter": r["end_quarter"],
                "responsible_exec": r["responsible_exec"],
                "responsible_monitor": r["responsible_monitor"],
                "classification_reasoning": r["classification_reasoning"],
                "assigned_archetype": r["assigned_archetype"],
                "duration_multiplier": r["duration_multiplier"],
                "base_cost_egp": base,
                "inflated_cost_egp": inflated,
                "cost_driver": r["cost_driver"],
                "funding_source": r["funding_source"],
                "cost_explanation": r["cost_explanation"],
                "budget_display": "Funded Centrally" if is_central else f"{inflated:,.0f} EGP",
                "edited_by_user": r["edited_by_user"],
            }
        )
        priced.append(
            {
                "start_year_index": int(r["start_year_index"] or 0),
                "funding_source": r["funding_source"],
                "inflated_cost_egp": inflated,
            }
        )

    budget_summary = mod.reconcile_budget(priced, mod.load_revenue())

    return {
        "run_id": run_id,
        "generated": True,
        "goals": list(goals.values()),
        "budget_summary": budget_summary,
        "totals": {
            "goals": len(goals),
            "objectives": len(objectives),
            "actions": len(rows),
        },
    }


# ── HITL editing for a single action (re-prices on cost-driving changes) ─────────

class ActionEditRequest(BaseModel):
    # All optional — only provided fields are changed.
    activity_text: Optional[str] = None
    kpi_name: Optional[str] = None
    start_quarter: Optional[str] = None
    end_quarter: Optional[str] = None
    responsible_exec: Optional[str] = None
    responsible_monitor: Optional[str] = None
    assigned_archetype: Optional[str] = None
    duration_multiplier: Optional[int] = None


_ACTION_EDITABLE_TEXT = (
    "activity_text", "kpi_name", "responsible_exec", "responsible_monitor",
)


def _reprice_and_update(action_id: str, *, archetype: str, duration: int,
                        start_quarter: str, end_quarter: str,
                        text_overrides: dict, edited: bool) -> dict:
    """
    Shared writer for edit + reset. Normalises the schedule, RE-PRICES via the
    agent (so cost stays consistent with the cost-driving inputs), re-renders
    cost_explanation, and writes the live columns only (never original_*).
    """
    mod = _ensure_action_planner()
    catalog = mod.load_catalog()
    archetype = archetype if archetype in mod.ARCHETYPE_KEYS else "general_initiative"
    duration = max(1, min(4, int(duration)))
    sched = mod.normalize_schedule(start_quarter, end_quarter)
    pricing = mod.price_activity(archetype, duration, sched["start_year_index"], catalog)
    cost_explanation = mod.render_cost_explanation(pricing["pricing_provenance"], pricing["inflated_cost_egp"])

    conn = _get_db_conn()
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE strategic_actions SET
                activity_text = COALESCE(%s, activity_text),
                kpi_name = COALESCE(%s, kpi_name),
                responsible_exec = COALESCE(%s, responsible_exec),
                responsible_monitor = COALESCE(%s, responsible_monitor),
                start_quarter = %s, end_quarter = %s, start_year_index = %s,
                assigned_archetype = %s, duration_multiplier = %s,
                base_cost_egp = %s, inflated_cost_egp = %s, cost_driver = %s,
                funding_source = %s, cost_explanation = %s, pricing_provenance = %s,
                edited_by_user = %s
            WHERE action_id = %s
            """,
            (
                text_overrides.get("activity_text"), text_overrides.get("kpi_name"),
                text_overrides.get("responsible_exec"), text_overrides.get("responsible_monitor"),
                sched["start_quarter"], sched["end_quarter"], sched["start_year_index"],
                archetype, duration,
                pricing["base_cost_egp"], pricing["inflated_cost_egp"], pricing["cost_driver"],
                pricing["funding_source"], cost_explanation, psycopg2.extras.Json(pricing["pricing_provenance"]),
                edited, action_id,
            ),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail=f"Action {action_id} not found")
    return {
        "action_id": action_id,
        "start_quarter": sched["start_quarter"], "end_quarter": sched["end_quarter"],
        "assigned_archetype": archetype, "duration_multiplier": duration,
        "inflated_cost_egp": pricing["inflated_cost_egp"],
        "funding_source": pricing["funding_source"],
        "cost_explanation": cost_explanation, "edited_by_user": edited,
    }


@app.patch("/api/action-plan/action/{action_id}")
def edit_action(action_id: str, req: ActionEditRequest):
    """
    Edit one action. Cost-driving changes (quarters / archetype / duration) trigger
    a deterministic Python re-price. original_* snapshots are never touched; sets
    edited_by_user = true.
    """
    conn = _get_db_conn()
    if not conn:
        raise HTTPException(status_code=503, detail="Database not configured")

    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT assigned_archetype, duration_multiplier, start_quarter, end_quarter "
            "FROM strategic_actions WHERE action_id = %s",
            (action_id,),
        )
        cur_row = cur.fetchone()
    if not cur_row:
        raise HTTPException(status_code=404, detail=f"Action {action_id} not found")

    if req.assigned_archetype is not None:
        mod = _ensure_action_planner()
        if req.assigned_archetype not in mod.ARCHETYPE_KEYS:
            raise HTTPException(status_code=400, detail=f"Unknown archetype '{req.assigned_archetype}'")

    text_overrides = {f: getattr(req, f) for f in _ACTION_EDITABLE_TEXT if getattr(req, f) is not None}
    return _reprice_and_update(
        action_id,
        archetype=req.assigned_archetype or cur_row["assigned_archetype"],
        duration=req.duration_multiplier if req.duration_multiplier is not None else cur_row["duration_multiplier"],
        start_quarter=req.start_quarter or cur_row["start_quarter"],
        end_quarter=req.end_quarter or cur_row["end_quarter"],
        text_overrides=text_overrides,
        edited=True,
    )


@app.post("/api/action-plan/action/{action_id}/reset")
def reset_action(action_id: str):
    """
    Reset one action to its frozen AI snapshot (original_*), recompute the cost
    from the original cost-driving fields, and clear edited_by_user.
    """
    conn = _get_db_conn()
    if not conn:
        raise HTTPException(status_code=503, detail="Database not configured")

    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT original_activity_text, original_kpi_name,
                   original_start_quarter, original_end_quarter,
                   original_responsible_exec, original_responsible_monitor,
                   original_assigned_archetype, original_duration_multiplier
            FROM strategic_actions WHERE action_id = %s
            """,
            (action_id,),
        )
        o = cur.fetchone()
    if not o:
        raise HTTPException(status_code=404, detail=f"Action {action_id} not found")
    if o["original_assigned_archetype"] is None:
        raise HTTPException(
            status_code=409,
            detail="This action predates edit-snapshot support (migration 005); regenerate the plan to enable reset.",
        )

    return _reprice_and_update(
        action_id,
        archetype=o["original_assigned_archetype"],
        duration=o["original_duration_multiplier"],
        start_quarter=o["original_start_quarter"],
        end_quarter=o["original_end_quarter"],
        text_overrides={
            "activity_text": o["original_activity_text"],
            "kpi_name": o["original_kpi_name"],
            "responsible_exec": o["original_responsible_exec"],
            "responsible_monitor": o["original_responsible_monitor"],
        },
        edited=False,
    )


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

# ── Gap Analysis Feedback (few-shot store) ────────────────────────────────────
#
# Approved user-added suggestions are persisted here and injected as few-shot
# examples on the next compile_and_run call for the same pillar.

_GAP_FEEDBACK_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS gap_analysis_feedback (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    pillar_name    TEXT        NOT NULL,
    pillar_id      INTEGER,
    user_query     TEXT        NOT NULL,
    suggestion     TEXT        NOT NULL,
    reasoning      TEXT        NOT NULL,
    gap_identified TEXT        NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""


def _ensure_gap_feedback_table() -> None:
    conn = _get_db_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(_GAP_FEEDBACK_TABLE_SQL)
        conn.commit()
    except Exception as exc:
        print(f"[gap-feedback] table creation failed: {exc}")


def _fetch_gap_feedback(pillar_names: list[str]) -> dict[str, list[dict]]:
    """Return up to 3 approved suggestions per pillar, newest first."""
    conn = _get_db_conn()
    if not conn:
        return {}
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT DISTINCT ON (pillar_name, id)
                    pillar_name, suggestion, reasoning, gap_identified
                FROM gap_analysis_feedback
                WHERE pillar_name = ANY(%s)
                ORDER BY pillar_name, created_at DESC
                """,
                (pillar_names,),
            )
            rows = cur.fetchall()
    except Exception as exc:
        print(f"[gap-feedback] fetch failed: {exc}")
        return {}

    result: dict[str, list[dict]] = {}
    for row in rows:
        pn = row["pillar_name"]
        if pn not in result:
            result[pn] = []
        if len(result[pn]) < 3:
            result[pn].append({
                "suggestion":     row["suggestion"],
                "reasoning":      row["reasoning"],
                "gap_identified": row["gap_identified"],
            })
    return result


def _save_gap_feedback(
    pillar_name: str,
    pillar_id: int | None,
    user_query: str,
    suggestion: str,
    reasoning: str,
    gap_identified: str,
) -> None:
    _ensure_gap_feedback_table()
    conn = _get_db_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO gap_analysis_feedback
                    (pillar_name, pillar_id, user_query, suggestion, reasoning, gap_identified)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (pillar_name, pillar_id, user_query, suggestion, reasoning, gap_identified),
            )
        conn.commit()
    except Exception as exc:
        print(f"[gap-feedback] save failed: {exc}")


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
        if str(ROOT_DIR) not in sys.path:
            sys.path.insert(0, str(ROOT_DIR))

        # Always evict the cached entry before loading.
        # _load_module registers the module in sys.modules BEFORE exec_module runs,
        # so a failed first load leaves a broken empty shell in the cache.
        sys.modules.pop("gap_analysis_agent", None)

        if not GAP_ANALYSIS_AGENT_PATH.exists():
            raise FileNotFoundError(f"Agent file not found: {GAP_ANALYSIS_AGENT_PATH}")

        mod = _load_module("gap_analysis_agent", GAP_ANALYSIS_AGENT_PATH)

        if not hasattr(mod, "compile_and_run"):
            raise AttributeError(
                "gap_analysis_agent loaded but compile_and_run is missing. "
                "Check the agent file for top-level import errors."
            )

        pillar_names = [p["pillar"] for p in pillars if p.get("pillar")]
        feedback = _fetch_gap_feedback(pillar_names)

        result: list[dict] = mod.compile_and_run(pillars, feedback=feedback)
        _finish(job_id, result)
    except Exception as exc:
        _fail(job_id, str(exc))


def _task_suggest_one(job_id: str, pillar_data: dict, user_query: str) -> None:
    """Background task: generate a single suggestion from a user's natural-language query."""
    try:
        if str(ROOT_DIR) not in sys.path:
            sys.path.insert(0, str(ROOT_DIR))

        sys.modules.pop("gap_analysis_agent", None)

        if not GAP_ANALYSIS_AGENT_PATH.exists():
            raise FileNotFoundError(f"Agent file not found: {GAP_ANALYSIS_AGENT_PATH}")

        mod = _load_module("gap_analysis_agent", GAP_ANALYSIS_AGENT_PATH)

        if not hasattr(mod, "generate_user_suggestion"):
            raise AttributeError("gap_analysis_agent missing generate_user_suggestion")

        pillar_name = pillar_data.get("pillar", "")
        feedback_examples = _fetch_gap_feedback([pillar_name]).get(pillar_name, [])

        result: dict = mod.generate_user_suggestion(
            pillar_data, user_query, feedback_examples
        )
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


# ── HITL: user-initiated single suggestion ────────────────────────────────────

class SuggestOneRequest(BaseModel):
    pillar_data: dict  # PillarDraft from the frontend (pillar, target_state, strengths, weaknesses)
    user_query: str    # administrator's natural-language intent


@app.post("/api/gap-analysis/suggest-one", status_code=202)
async def suggest_one(req: SuggestOneRequest, background_tasks: BackgroundTasks):
    """
    Generate a single structured suggestion from the user's natural-language query.
    The LLM reasons against the specific pillar's NAQAAE target state and SWOT data.
    Previously approved suggestions for this pillar are injected as few-shot examples.
    Returns a job_id; poll GET /api/jobs/{job_id} for the result.
    """
    job_id = _new_job()
    background_tasks.add_task(_task_suggest_one, job_id, req.pillar_data, req.user_query)
    return {"job_id": job_id}


# ── HITL: approve and persist a suggestion as feedback ───────────────────────

class FeedbackRequest(BaseModel):
    pillar_name:    str
    pillar_id:      int | None = None
    user_query:     str
    suggestion:     str
    reasoning:      str
    gap_identified: str


@app.post("/api/gap-analysis/feedback", status_code=201)
def submit_gap_feedback(req: FeedbackRequest):
    """
    Persist an approved user-added suggestion as a few-shot feedback example.
    On the next compile_and_run call for this pillar, this suggestion will be
    injected into the system prompt to guide the model's output style and quality.
    """
    _save_gap_feedback(
        pillar_name=req.pillar_name,
        pillar_id=req.pillar_id,
        user_query=req.user_query,
        suggestion=req.suggestion,
        reasoning=req.reasoning,
        gap_identified=req.gap_identified,
    )
    return {"status": "saved"}


# ══════════════════════════════════════════════════════════════════════════════
#  GOALS PLANNER (routes)
#  POST /api/agents/strategy/run               — run the full 5-station pipeline
#  GET  /api/strategy/goals/{run_id}           — fetch goals + provenance
#  POST /api/strategy/{run_id}/approve         — mark plan final
#  POST /api/strategy/goals/{run_id}           — add a goal
#  DELETE /api/strategy/goals/{goal_id}        — delete a goal
#  PATCH /api/strategy/goals/reorder           — reorder goals
#  PATCH /api/strategy/goals/{goal_id}         — edit / reset a goal
#  POST /api/strategy/objectives/{goal_id}     — add an objective
#  DELETE /api/strategy/objectives/{obj_id}    — delete an objective
#  PATCH /api/strategy/objectives/reorder      — reorder objectives
#  PATCH /api/strategy/objectives/{obj_id}     — edit / reset an objective
# ══════════════════════════════════════════════════════════════════════════════

# ── DB helpers ────────────────────────────────────────────────────────────────

def _fetch_swot_items(
    conn, swot_run_id: str | None
) -> tuple[list[dict], str | None]:
    """
    Pull SWOT rows from the DB and return (items, swot_day_iso).
    When swot_run_id is None, selects all items from the MOST RECENT day
    that has any rows (UTC date of MAX created_at).
    """
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        if swot_run_id:
            cur.execute(
                "SELECT * FROM swot_items WHERE run_id = %s ORDER BY created_at",
                (swot_run_id,),
            )
        else:
            # Take the most recent run_id for each agent independently.
            # e.g. tech ran 2 weeks ago, workforce ran yesterday → both are included.
            cur.execute(
                """
                WITH latest_runs AS (
                    SELECT DISTINCT ON (agent_id) agent_id, run_id
                    FROM swot_items
                    ORDER BY agent_id, created_at DESC
                )
                SELECT si.*
                FROM swot_items si
                JOIN latest_runs lr ON si.run_id = lr.run_id
                ORDER BY si.created_at
                """
            )
        items = [dict(r) for r in cur.fetchall()]

    swot_day: str | None = None
    if items:
        ts = items[0].get("created_at")
        if hasattr(ts, "date"):
            swot_day = ts.date().isoformat()
        else:
            swot_day = str(ts)[:10]

    return items, swot_day


def _create_strategy_run_entry(
    conn, swot_count: int, swot_day: str | None
) -> str:
    """Insert a placeholder agent_runs row so strategic_goals FK is satisfied."""
    strategy_run_id = str(uuid.uuid4())
    meta = json.dumps({
        "swot_day":        swot_day,
        "swot_count":      swot_count,
        "goals_count":     0,
        "objectives_count": 0,
        "validated":       False,
        "plan_status":     "draft",
        "finalized_at":    None,
    })
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO agent_runs
                (run_id, agent_id, run_timestamp, status, errors, structured_data, raw_envelope)
            VALUES (%s, 'goals_planner', NOW(), 'running',
                    '[]'::jsonb, %s::jsonb, '{}'::jsonb)
            """,
            (strategy_run_id, meta),
        )
    return strategy_run_id


def _finish_strategy_run_entry(
    conn,
    strategy_run_id: str,
    status: str,
    goals_count: int,
    objectives_count: int,
    validated: bool,
    errors: list[str] | None = None,
) -> None:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT structured_data FROM agent_runs WHERE run_id = %s",
            (strategy_run_id,),
        )
        row  = cur.fetchone()
        meta = dict(row["structured_data"]) if row else {}

    meta.update({
        "goals_count":       goals_count,
        "objectives_count":  objectives_count,
        "validated":         validated,
        # Surfaced to the UI and used to gate approval (HITL).
        "validation_errors": list(errors or []),
    })

    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE agent_runs
               SET status = %s, structured_data = %s::jsonb
             WHERE run_id = %s
            """,
            (status, json.dumps(meta), strategy_run_id),
        )


# ── Background task (streaming with live progress) ────────────────────────────

def _task_strategy(job_id: str, swot_run_id: str | None) -> None:
    try:
        if str(ROOT_DIR) not in sys.path:
            sys.path.insert(0, str(ROOT_DIR))
        if str(AGENTS_DIR) not in sys.path:
            sys.path.insert(0, str(AGENTS_DIR))

        # Connect — surface the real psycopg2 error in the UI if it fails
        _dsn = os.getenv("DB_CONNECTION_STRING", "")
        if not _dsn:
            _fail(job_id, "DB_CONNECTION_STRING is not set in .env.")
            return
        try:
            conn = psycopg2.connect(_dsn)
            conn.autocommit = True
        except Exception as _db_exc:
            _fail(job_id, f"Cannot connect to DB: {_db_exc}")
            return

        swot_items, swot_day = _fetch_swot_items(conn, swot_run_id)
        if not swot_items:
            _fail(
                job_id,
                "No SWOT items found. Run one or more agents first so there is "
                "data to plan from."
                if not swot_run_id else
                "No SWOT items found for the specified run_id.",
            )
            return

        strategy_run_id = _create_strategy_run_entry(conn, len(swot_items), swot_day)

        # ── Initial progress — pair station is active right away ──────────────
        stations: list[dict] = [
            {"key": "pair",     "label": "Pair TOWS",             "status": "active",  "detail": ""},
            {"key": "ground",   "label": "Ground in NAQAAE graph", "status": "pending", "detail": ""},
            {"key": "cluster",  "label": "Cluster into goals",     "status": "pending", "detail": ""},
            {"key": "draft",    "label": "Draft goals (LLM)",      "status": "pending", "detail": ""},
            {"key": "validate", "label": "Validate",               "status": "pending", "detail": ""},
        ]
        progress: dict = {"stations": stations, "retries": 0}
        _jobs[job_id]["progress"] = progress

        def _done(key: str, detail: str) -> None:
            for s in stations:
                if s["key"] == key:
                    s["status"] = "done"
                    s["detail"] = detail

        def _active(key: str) -> None:
            for s in stations:
                if s["key"] == key:
                    s["status"] = "active"
                    s["detail"] = ""

        # ── Force clean re-import ─────────────────────────────────────────────
        for mod_name in list(sys.modules.keys()):
            if mod_name.startswith("goals_planner"):
                del sys.modules[mod_name]

        from goals_planner import (  # noqa: PLC0415
            RUN_CONFIG, build_initial_state, get_graph,
        )

        graph   = get_graph()
        initial = build_initial_state(swot_items, strategy_run_id)
        accumulated: dict = dict(initial)

        # ── Stream node-by-node ───────────────────────────────────────────────
        import time as _time
        _t_prev = _time.monotonic()
        for chunk in graph.stream(initial, config=RUN_CONFIG, stream_mode="updates"):
            for node_name, node_update in (chunk or {}).items():
                _now = _time.monotonic()
                print(f"[strategy timing] {node_name}: {_now - _t_prev:.1f}s", flush=True)
                _t_prev = _now
                accumulated.update(node_update or {})

                if node_name == "pair_tows":
                    n = len(node_update.get("pairs") or [])
                    _done("pair", f"{n} pair{'s' if n != 1 else ''} built")
                    _active("ground")

                elif node_name == "ground_in_graph":
                    pairs = node_update.get("pairs") or []
                    n_ind = sum(1 for p in pairs if p.get("alignment") == "indicator")
                    n_pil = sum(1 for p in pairs if p.get("alignment") == "pillar_only")
                    n_str = sum(1 for p in pairs if p.get("alignment") == "strategic")
                    _done("ground", f"{n_ind} indicator · {n_pil} pillar · {n_str} strategic")
                    _active("cluster")

                elif node_name == "cluster_into_goals":
                    n = len(node_update.get("clusters") or [])
                    _done("cluster", f"{n} goal{'s' if n != 1 else ''}")
                    _active("draft")

                elif node_name == "draft_goals":
                    draft  = node_update.get("draft") or []
                    n_obj  = sum(len(g.get("objectives", [])) for g in draft)
                    _done("draft", f"{len(draft)} goals · {n_obj} objectives")
                    _active("validate")

                elif node_name == "validate":
                    errors    = node_update.get("errors") or []
                    validated = node_update.get("validated", False)
                    retries   = accumulated.get("retries", 0)
                    if validated:
                        detail = "passed"
                    elif retries >= 2:
                        detail = f"{len(errors)} issue(s) — saving best effort"
                    else:
                        detail = f"{len(errors)} issue(s) — retrying"
                    _done("validate", detail)

                elif node_name == "increment_retries":
                    retries = accumulated.get("retries", 0)
                    progress["retries"] = retries
                    # reset draft + validate for the retry lap
                    _active("draft")
                    for s in stations:
                        if s["key"] == "validate":
                            s["status"] = "pending"
                            s["detail"] = ""

            _jobs[job_id]["progress"] = progress

        goals     = accumulated.get("draft", [])
        errors    = accumulated.get("errors", [])
        validated = accumulated.get("validated", False)
        n_obj_total = sum(len(g.get("objectives", [])) for g in goals)
        status    = "success" if validated else "partial"

        _finish_strategy_run_entry(
            conn, strategy_run_id, status,
            len(goals), n_obj_total, validated, errors,
        )

        _finish(job_id, {
            "strategy_run_id": strategy_run_id,
            "goals_count":     len(goals),
            "validated":       validated,
            "errors":          errors,
        })

    except Exception as exc:
        _fail(job_id, str(exc))


# ── Trigger route ─────────────────────────────────────────────────────────────

class StrategyRunRequest(BaseModel):
    swot_run_id: str | None = None  # override: restrict to one run; None = latest day


@app.post("/api/agents/strategy/run", status_code=202)
def run_strategy(req: StrategyRunRequest, background_tasks: BackgroundTasks):
    """
    Trigger the strategy-planner pipeline.
    Selects SWOT items from the most recent day in the DB (or the specified run).
    Returns a job_id; poll GET /api/jobs/{job_id} for live progress + result.
    Job result carries `strategy_run_id` for use with GET /api/strategy/goals/{run_id}.
    """
    job_id = _new_job()
    background_tasks.add_task(_task_strategy, job_id, req.swot_run_id)
    return {"job_id": job_id}


# ── Read goals (with provenance enrichment) ───────────────────────────────────

def _parse_uuid_array(value) -> list[str]:
    """Normalize a Postgres uuid[] column value to a list of uuid strings.

    psycopg2 has no uuid typecaster registered, so it returns uuid[] as the
    raw array literal string '{u1,u2}' (and '{}' when empty) rather than a
    Python list. Iterating that string character-by-character is what produced
    the malformed ANY('{b,9,{,...}') query. Accept an already-parsed list too,
    in case a typecaster is registered later.
    """
    if not value:
        return []
    if isinstance(value, (list, tuple)):
        return [str(u) for u in value if u]
    inner = str(value).strip().strip("{}")
    if not inner:
        return []
    return [u.strip().strip('"') for u in inner.split(",") if u.strip()]


@app.get("/api/strategy/goals/{run_id}")
def get_strategy_goals(run_id: str):
    """
    Return goals + nested objectives for the human editing phase.
    Each objective is enriched with:
      source_items  — the SWOT item texts behind source_swot_ids
      indicator_title / indicator_text — raw NAQAAE text from Neo4j (if grounded)
    Also returns plan_status / finalized_at from agent_runs.
    """
    conn = _get_db_conn()
    if conn is None:
        raise HTTPException(status_code=503, detail="Database unavailable.")

    # ── Plan lifecycle metadata ───────────────────────────────────────────────
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT structured_data FROM agent_runs WHERE run_id = %s",
            (run_id,),
        )
        row      = cur.fetchone()
        run_meta = dict(row["structured_data"]) if row else {}

    plan_status  = run_meta.get("plan_status", "draft")
    finalized_at = run_meta.get("finalized_at")

    # ── Goals + objectives ────────────────────────────────────────────────────
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT * FROM strategic_goals WHERE run_id = %s ORDER BY position",
            (run_id,),
        )
        goals = [dict(r) for r in cur.fetchall()]

        for goal in goals:
            goal["goal_id"] = str(goal["goal_id"])
            goal["run_id"]  = str(goal["run_id"])
            goal["added_by_user"] = bool(goal.get("added_by_user", False))
            goal["feasibility"]   = _shape_feasibility(goal)
            cur.execute(
                "SELECT * FROM strategic_objectives WHERE goal_id = %s ORDER BY position",
                (goal["goal_id"],),
            )
            objectives = []
            for row in cur.fetchall():
                obj = dict(row)
                obj["objective_id"] = str(obj["objective_id"])
                obj["goal_id"]      = str(obj["goal_id"])
                obj["source_swot_ids"] = _parse_uuid_array(obj.get("source_swot_ids"))
                obj["added_by_user"]   = bool(obj.get("added_by_user", False))
                obj["feasibility"]     = _shape_feasibility(obj)
                objectives.append(obj)
            goal["objectives"] = objectives

    # ── Batch-resolve SWOT provenance ─────────────────────────────────────────
    all_swot_ids: set[str] = set()
    for goal in goals:
        for obj in goal["objectives"]:
            all_swot_ids.update(obj.get("source_swot_ids") or [])

    swot_map: dict[str, dict] = {}
    if all_swot_ids:
        id_arr = "{" + ",".join(all_swot_ids) + "}"
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT item_id, type, title, description, pillar_name
                FROM swot_items
                WHERE item_id = ANY(%s::uuid[])
                """,
                (id_arr,),
            )
            for row in cur.fetchall():
                swot_map[str(row["item_id"])] = dict(row)

    # ── Batch-resolve Neo4j indicator text ────────────────────────────────────
    # An objective may trace to several indicators (pillar-merge): collect ids from
    # both the primary column and the grounded_indicators array (migration 002).
    all_indicator_ids: set[str] = set()
    for goal in goals:
        for obj in goal["objectives"]:
            if obj.get("grounded_indicator_id"):
                all_indicator_ids.add(obj["grounded_indicator_id"])
            for ind in (obj.get("grounded_indicators") or []):
                if isinstance(ind, dict) and ind.get("indicator_id"):
                    all_indicator_ids.add(ind["indicator_id"])
    indicator_map: dict[str, dict] = {}
    if all_indicator_ids:
        driver = _get_neo4j_driver()
        if driver:
            try:
                with driver.session() as session:
                    result = session.run(
                        """
                        MATCH (ind:Indicator)
                        WHERE ind.indicator_id IN $ids
                        OPTIONAL MATCH (ind)-[:HAS_CHUNK]->(ch:Chunk)
                        RETURN ind.indicator_id AS id,
                               ind.title        AS title,
                               collect(ch.content) AS chunks
                        """,
                        ids=list(all_indicator_ids),
                    )
                    for row in result:
                        raw_chunks = row["chunks"] or []
                        chunk_text = (raw_chunks[0] or "")[:600] if raw_chunks else ""
                        indicator_map[row["id"]] = {
                            "indicator_title": row["title"],
                            "indicator_text":  chunk_text,
                        }
            except Exception as exc:
                print(f"[strategy] Neo4j provenance enrichment failed: {exc}")

    # ── Attach provenance to objectives ───────────────────────────────────────
    for goal in goals:
        for obj in goal["objectives"]:
            obj["source_items"] = [
                swot_map[sid]
                for sid in (obj.get("source_swot_ids") or [])
                if sid in swot_map
            ]
            # Primary (strongest) indicator — kept for backward compatibility.
            ind_id = obj.get("grounded_indicator_id")
            ind    = indicator_map.get(ind_id) if ind_id else None
            obj["indicator_title"] = ind["indicator_title"] if ind else None
            obj["indicator_text"]  = ind["indicator_text"]  if ind else None

            # Full list — every indicator this (possibly merged) objective traces to,
            # strongest first, enriched with title/text from Neo4j.
            raw = obj.get("grounded_indicators") or []
            if not raw and ind_id:                       # legacy rows: single indicator
                raw = [{"indicator_id": ind_id, "grounding_score": obj.get("grounding_score")}]
            enriched_inds = []
            for item in raw:
                if not isinstance(item, dict):
                    continue
                iid = item.get("indicator_id")
                meta = indicator_map.get(iid, {})
                enriched_inds.append({
                    "indicator_id":    iid,
                    "grounding_score": item.get("grounding_score"),
                    "indicator_title": meta.get("indicator_title"),
                    "indicator_text":  meta.get("indicator_text"),
                })
            enriched_inds.sort(key=lambda d: (d.get("grounding_score") or 0.0), reverse=True)
            obj["indicators"] = enriched_inds

    return {
        "run_id":            run_id,
        "plan_status":       plan_status,
        "finalized_at":      finalized_at,
        "validation_errors": run_meta.get("validation_errors", []),
        "goals":             goals,
    }


# ── Approve ───────────────────────────────────────────────────────────────────

@app.post("/api/strategy/{run_id}/approve")
def approve_strategy(run_id: str, force: bool = False):
    """Flip plan_status → final and stamp finalized_at in agent_runs.structured_data.

    Blocked while validation issues remain (HITL: the human must resolve them) —
    pass ?force=true to approve anyway.
    """
    conn = _get_db_conn()
    if conn is None:
        raise HTTPException(status_code=503, detail="Database unavailable.")

    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT structured_data FROM agent_runs WHERE run_id = %s",
            (run_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Strategy run not found.")
        meta = dict(row["structured_data"])

    val_errors = meta.get("validation_errors") or []
    if val_errors and not force:
        raise HTTPException(
            status_code=409,
            detail={
                "message": f"{len(val_errors)} validation issue(s) must be resolved "
                           f"before approval (or approve with force=true).",
                "validation_errors": val_errors,
            },
        )

    finalized_at = datetime.now(timezone.utc).isoformat()
    meta["plan_status"]  = "final"
    meta["finalized_at"] = finalized_at

    with conn.cursor() as cur:
        cur.execute(
            "UPDATE agent_runs SET structured_data = %s::jsonb WHERE run_id = %s",
            (json.dumps(meta), run_id),
        )

    return {"plan_status": "final", "finalized_at": finalized_at}


# ── Feasibility (HITL) ────────────────────────────────────────────────────────

def _shape_feasibility(row: dict) -> dict | None:
    """Build the nested `feasibility` object the frontend reads, or None if the
    item has never been checked. Resilient to the feasibility columns (migration 002) not being applied."""
    verdict = row.get("feasibility_verdict")
    if not verdict:
        return None
    ev = row.get("feasibility_evidence")
    checked = row.get("feasibility_checked_at")
    return {
        "verdict":         verdict,
        "reason":          row.get("feasibility_reason"),
        "suggestion":      row.get("feasibility_suggestion"),
        "timeframe_years": row.get("feasibility_timeframe_years"),
        "evidence":        ev if isinstance(ev, dict) else None,
        "checked_at":      checked.isoformat() if hasattr(checked, "isoformat") else checked,
    }


def _clear_feasibility(cur, table: str, id_col: str, id_val: str) -> None:
    """Wipe a stored feasibility verdict (called when the text is edited/reset).
    No-op if the feasibility columns (migration 002) aren't present."""
    try:
        cur.execute(
            f"""
            UPDATE {table} SET
                feasibility_verdict = NULL, feasibility_reason = NULL,
                feasibility_suggestion = NULL, feasibility_timeframe_years = NULL,
                feasibility_evidence = NULL, feasibility_checked_at = NULL
            WHERE {id_col} = %s
            """,
            (id_val,),
        )
    except Exception as exc:
        print(f"[feasibility] clear skipped ({exc})")


class FeasibilityRequest(BaseModel):
    run_id:       str
    text:         str
    goal_id:      str | None = None
    objective_id: str | None = None


@app.post("/api/strategy/feasibility/{kind}")
def check_feasibility(kind: str, req: FeasibilityRequest):
    """Judge the feasibility of a goal/objective against the run's SWOT baseline
    within the plan horizon (<= PLAN_HORIZON_YEARS). Returns the verdict + evidence.

    Works as a pure PREVIEW on raw `text` (no id). If a goal_id/objective_id is
    supplied (a saved item), the verdict + evidence are also PERSISTED on that row,
    so it survives refresh and the Action Plan stage can read it. Advisory only.
    """
    if kind not in ("goal", "objective"):
        raise HTTPException(status_code=400, detail="kind must be 'goal' or 'objective'.")
    if not (req.text or "").strip():
        raise HTTPException(status_code=400, detail="text is required.")

    conn = _get_db_conn()
    if conn is None:
        raise HTTPException(status_code=503, detail="Database unavailable.")

    swot_items, _ = _fetch_swot_items(conn, None)
    if not swot_items:
        raise HTTPException(status_code=400, detail="No SWOT data to assess against.")

    if str(AGENTS_DIR) not in sys.path:
        sys.path.insert(0, str(AGENTS_DIR))
    try:
        from goals_planner.feasibility import evaluate  # noqa: PLC0415
        result = evaluate(req.text, kind, swot_items)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Feasibility check failed: {exc}")

    # Persist on a saved item (no-op for pure preview / un-migrated DB).
    target_id = req.goal_id if kind == "goal" else req.objective_id
    if target_id:
        table  = "strategic_goals" if kind == "goal" else "strategic_objectives"
        id_col = "goal_id" if kind == "goal" else "objective_id"
        try:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    UPDATE {table} SET
                        feasibility_verdict         = %s,
                        feasibility_reason          = %s,
                        feasibility_suggestion      = %s,
                        feasibility_timeframe_years = %s,
                        feasibility_evidence        = %s::jsonb,
                        feasibility_checked_at      = NOW()
                    WHERE {id_col} = %s
                    """,
                    (result["verdict"], result["reason"], result["suggestion"],
                     result["timeframe_years"], json.dumps(result["evidence"]), target_id),
                )
        except Exception as exc:
            print(f"[feasibility] could not persist verdict ({exc}); returning preview only.")

    return result


# ── Goal CRUD ─────────────────────────────────────────────────────────────────

class GoalCreate(BaseModel):
    title: str
    description: str = ""


@app.post("/api/strategy/goals/{run_id}", status_code=201)
def create_goal(run_id: str, req: GoalCreate):
    """Add a new (user-authored) goal to an existing strategy run."""
    conn = _get_db_conn()
    if conn is None:
        raise HTTPException(status_code=503, detail="Database unavailable.")

    goal_id = str(uuid.uuid4())
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT COALESCE(MAX(position), -1) AS mx FROM strategic_goals WHERE run_id = %s",
            (run_id,),
        )
        pos = (cur.fetchone() or {}).get("mx", -1) + 1
        cur.execute(
            """
            INSERT INTO strategic_goals
                (goal_id, run_id, title, description,
                 original_title, original_description,
                 pillar_ids, position, edited_by_user)
            VALUES (%s, %s, %s, %s, %s, %s, '{}', %s, true)
            """,
            (goal_id, run_id, req.title, req.description,
             req.title, req.description, pos),
        )
        try:  # mark human-added (no-op if added_by_user column absent)
            cur.execute(
                "UPDATE strategic_goals SET added_by_user = true WHERE goal_id = %s",
                (goal_id,),
            )
        except Exception as exc:
            print(f"[strategy] added_by_user skipped ({exc})")
    return {"goal_id": goal_id, "position": pos}


@app.delete("/api/strategy/goals/{goal_id}", status_code=204)
def delete_goal(goal_id: str):
    """Delete a goal and cascade-delete its objectives."""
    conn = _get_db_conn()
    if conn is None:
        raise HTTPException(status_code=503, detail="Database unavailable.")
    with conn.cursor() as cur:
        cur.execute("DELETE FROM strategic_goals WHERE goal_id = %s", (goal_id,))


# IMPORTANT: /reorder must be declared BEFORE /{goal_id} so FastAPI matches it first.
class ReorderRequest(BaseModel):
    ordered_ids: list[str]


@app.patch("/api/strategy/goals/reorder")
def reorder_goals(req: ReorderRequest):
    """Update position for each goal according to the supplied ordered id list."""
    conn = _get_db_conn()
    if conn is None:
        raise HTTPException(status_code=503, detail="Database unavailable.")
    with conn.cursor() as cur:
        for pos, gid in enumerate(req.ordered_ids):
            cur.execute(
                "UPDATE strategic_goals SET position = %s WHERE goal_id = %s",
                (pos, gid),
            )
    return {"status": "reordered"}


class GoalPatch(BaseModel):
    title:       str | None = None
    description: str | None = None
    reset:       bool = False   # when True, restore original_* values


@app.patch("/api/strategy/goals/{goal_id}")
def patch_goal(goal_id: str, req: GoalPatch):
    """Edit or reset a goal's title / description."""
    conn = _get_db_conn()
    if conn is None:
        raise HTTPException(status_code=503, detail="Database unavailable.")

    if req.reset:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE strategic_goals
                   SET title = original_title,
                       description = original_description,
                       edited_by_user = false
                 WHERE goal_id = %s
                """,
                (goal_id,),
            )
            _clear_feasibility(cur, "strategic_goals", "goal_id", goal_id)
        return {"status": "reset", "goal_id": goal_id}

    fields, values = [], []
    if req.title is not None:
        fields.append("title = %s")
        values.append(req.title)
    if req.description is not None:
        fields.append("description = %s")
        values.append(req.description)
    if not fields:
        raise HTTPException(status_code=400, detail="Nothing to update.")

    fields.append("edited_by_user = true")
    values.append(goal_id)
    with conn.cursor() as cur:
        cur.execute(
            f"UPDATE strategic_goals SET {', '.join(fields)} WHERE goal_id = %s",
            values,
        )
        _clear_feasibility(cur, "strategic_goals", "goal_id", goal_id)
    return {"status": "updated", "goal_id": goal_id}


# ── Objective CRUD ────────────────────────────────────────────────────────────

class ObjectiveCreate(BaseModel):
    text: str


@app.post("/api/strategy/objectives/{goal_id}", status_code=201)
def create_objective(goal_id: str, req: ObjectiveCreate):
    """Add a new (user-authored) objective to a goal."""
    conn = _get_db_conn()
    if conn is None:
        raise HTTPException(status_code=503, detail="Database unavailable.")

    obj_id = str(uuid.uuid4())
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT COALESCE(MAX(position), -1) AS mx FROM strategic_objectives WHERE goal_id = %s",
            (goal_id,),
        )
        pos = (cur.fetchone() or {}).get("mx", -1) + 1
        cur.execute(
            """
            INSERT INTO strategic_objectives
                (objective_id, goal_id, text, original_text,
                 tows_type, alignment,
                 pillar_id, grounded_indicator_id, grounding_score,
                 source_swot_ids, improvement_source, position, edited_by_user)
            VALUES (%s, %s, %s, %s, 'SO', 'strategic',
                    NULL, NULL, NULL, '{}', NULL, %s, true)
            """,
            (obj_id, goal_id, req.text, req.text, pos),
        )
        try:  # mark human-added (no-op if added_by_user column absent)
            cur.execute(
                "UPDATE strategic_objectives SET added_by_user = true WHERE objective_id = %s",
                (obj_id,),
            )
        except Exception as exc:
            print(f"[strategy] added_by_user skipped ({exc})")
    return {"objective_id": obj_id, "position": pos}


@app.delete("/api/strategy/objectives/{objective_id}", status_code=204)
def delete_objective(objective_id: str):
    """Delete a single objective."""
    conn = _get_db_conn()
    if conn is None:
        raise HTTPException(status_code=503, detail="Database unavailable.")
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM strategic_objectives WHERE objective_id = %s",
            (objective_id,),
        )


# IMPORTANT: /reorder must be declared BEFORE /{objective_id}.
@app.patch("/api/strategy/objectives/reorder")
def reorder_objectives(req: ReorderRequest):
    """Update position for each objective according to the supplied ordered id list."""
    conn = _get_db_conn()
    if conn is None:
        raise HTTPException(status_code=503, detail="Database unavailable.")
    with conn.cursor() as cur:
        for pos, oid in enumerate(req.ordered_ids):
            cur.execute(
                "UPDATE strategic_objectives SET position = %s WHERE objective_id = %s",
                (pos, oid),
            )
    return {"status": "reordered"}


class ObjectivePatch(BaseModel):
    text:  str | None = None
    reset: bool = False   # when True, restore original_text


@app.patch("/api/strategy/objectives/{objective_id}")
def patch_objective(objective_id: str, req: ObjectivePatch):
    """Edit or reset an objective's text."""
    conn = _get_db_conn()
    if conn is None:
        raise HTTPException(status_code=503, detail="Database unavailable.")

    if req.reset:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE strategic_objectives
                   SET text = original_text, edited_by_user = false
                 WHERE objective_id = %s
                """,
                (objective_id,),
            )
            _clear_feasibility(cur, "strategic_objectives", "objective_id", objective_id)
        return {"status": "reset", "objective_id": objective_id}

    if req.text is None:
        raise HTTPException(status_code=400, detail="Nothing to update.")

    with conn.cursor() as cur:
        cur.execute(
            "UPDATE strategic_objectives SET text = %s, edited_by_user = true WHERE objective_id = %s",
            (req.text, objective_id),
        )
        _clear_feasibility(cur, "strategic_objectives", "objective_id", objective_id)
    return {"status": "updated", "objective_id": objective_id}
