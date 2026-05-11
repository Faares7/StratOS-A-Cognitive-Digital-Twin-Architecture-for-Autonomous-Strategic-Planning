"""
Meetings Agent — Google Calendar scheduling + Fathom transcript integration.

Google Calendar:
  - create_calendar_event()  → creates event with Google Meet link
  - list_calendar_events()   → fetches upcoming events

Fathom (via Svix webhooks, whsec_... secret):
  - verify_fathom_webhook()  → validates Svix HMAC-SHA256 signature
  - fetch_fathom_call()      → pulls full call details from Fathom REST API
  - parse_fathom_payload()   → normalises webhook/call data → Meeting dict
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import requests

GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3"
FATHOM_API_BASE = os.getenv("FATHOM_API_BASE", "https://api.fathom.video/v1")


# ── Google Calendar ───────────────────────────────────────────────────────────

def create_calendar_event(
    access_token: str,
    title: str,
    start_iso: str,
    duration_minutes: int,
    attendee_emails: list[str],
    description: str = "",
) -> dict[str, Any]:
    """Create a Google Calendar event with a Google Meet conference link."""
    start_dt = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
    end_dt = start_dt + timedelta(minutes=duration_minutes)

    body = {
        "summary": title,
        "description": description,
        "start": {"dateTime": start_dt.isoformat(), "timeZone": "UTC"},
        "end": {"dateTime": end_dt.isoformat(), "timeZone": "UTC"},
        "attendees": [{"email": e} for e in attendee_emails if e.strip()],
        "conferenceData": {
            "createRequest": {
                # uuid4 guarantees uniqueness — reusing a requestId makes Google
                # return the same conference instead of creating a new one.
                "requestId": str(uuid.uuid4()),
                "conferenceSolutionKey": {"type": "hangoutsMeet"},
            }
        },
    }

    resp = requests.post(
        f"{GOOGLE_CALENDAR_API}/calendars/primary/events",
        params={"conferenceDataVersion": "1", "sendUpdates": "all"},
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
        json=body,
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()

    # Fathom's bot reads the `hangoutLink` top-level field specifically.
    # Fall back to conferenceData.entryPoints only if hangoutLink is absent.
    meet_link: str = data.get("hangoutLink", "")
    if not meet_link:
        for ep in data.get("conferenceData", {}).get("entryPoints", []):
            if ep.get("entryPointType") == "video":
                meet_link = ep.get("uri", "")
                break

    conf_status = (
        data.get("conferenceData", {})
        .get("createRequest", {})
        .get("status", {})
        .get("statusCode", "unknown")
    )
    print(f"[calendar] event={data['id']}  hangoutLink={meet_link!r}  confStatus={conf_status}")

    return {
        "calendar_event_id": data["id"],
        "meet_link": meet_link,
        "html_link": data.get("htmlLink", ""),
        "start": data["start"]["dateTime"],
        "end": data["end"]["dateTime"],
        "conf_status": conf_status,
    }


def list_calendar_events(access_token: str, max_results: int = 20) -> list[dict]:
    """Return upcoming primary-calendar events ordered by start time."""
    resp = requests.get(
        f"{GOOGLE_CALENDAR_API}/calendars/primary/events",
        params={
            "timeMin": datetime.now(timezone.utc).isoformat(),
            "maxResults": max_results,
            "singleEvents": "true",
            "orderBy": "startTime",
        },
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json().get("items", [])


def delete_calendar_event(access_token: str, event_id: str) -> None:
    """Delete a Google Calendar event. Raises on non-2xx responses."""
    resp = requests.delete(
        f"{GOOGLE_CALENDAR_API}/calendars/primary/events/{event_id}",
        params={"sendUpdates": "all"},
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=15,
    )
    # 204 = deleted, 410 = already gone — both are fine
    if resp.status_code not in (204, 410):
        resp.raise_for_status()


# ── Fathom / Svix webhook verification ───────────────────────────────────────

def verify_fathom_webhook(raw_body: bytes, headers: dict[str, str], secret: str) -> bool:
    """
    Verify a Fathom webhook using the Svix signing scheme (whsec_... secret).

    Expected headers: svix-id, svix-timestamp, svix-signature
    The signature header contains space-separated 'v1,BASE64SIG' entries.
    """
    msg_id = headers.get("svix-id") or headers.get("webhook-id", "")
    timestamp = headers.get("svix-timestamp") or headers.get("webhook-timestamp", "")
    sig_header = headers.get("svix-signature") or headers.get("webhook-signature", "")

    if not (msg_id and timestamp and sig_header):
        return False

    # Decode the whsec_... secret
    key_b64 = secret[len("whsec_"):] if secret.startswith("whsec_") else secret
    try:
        key = base64.b64decode(key_b64)
    except Exception:
        key = secret.encode()

    # Signed content: "{msg_id}.{timestamp}.{body}"
    signed_content = f"{msg_id}.{timestamp}.".encode() + raw_body

    mac = hmac.new(key, msg=signed_content, digestmod=hashlib.sha256)
    computed = base64.b64encode(mac.digest()).decode()

    # Check all signatures in the header (Svix can send multiple)
    for part in sig_header.split(" "):
        if part.startswith("v1,"):
            if hmac.compare_digest(computed, part[3:]):
                return True

    return False


# ── Fathom REST API ───────────────────────────────────────────────────────────

def fetch_fathom_call(call_id: str) -> dict[str, Any]:
    """Fetch full call details (transcript, summary, action items) from Fathom."""
    api_key = os.getenv("FATHOM_API_KEY", "")
    resp = requests.get(
        f"{FATHOM_API_BASE}/calls/{call_id}",
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def fetch_fathom_calls(limit: int = 20) -> list[dict]:
    """List recent Fathom calls."""
    api_key = os.getenv("FATHOM_API_KEY", "")
    resp = requests.get(
        f"{FATHOM_API_BASE}/calls",
        params={"limit": limit},
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=20,
    )
    resp.raise_for_status()
    return resp.json().get("data", [])


# ── Fathom payload normalisation ──────────────────────────────────────────────

def _as_str(value: Any, fallback: str = "Unknown") -> str:
    """Coerce a value to str — handles Fathom returning objects where strings are expected."""
    if value is None:
        return fallback
    if isinstance(value, str):
        return value or fallback
    if isinstance(value, dict):
        return str(value.get("name") or value.get("email") or value.get("text") or fallback)
    return str(value) or fallback


def parse_fathom_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Normalise a Fathom webhook payload into the project's Meeting schema.

    Confirmed Fathom field names (from live webhook inspection):
      recording_id, meeting_title, calendar_invitees, recording_start_time,
      recording_end_time, scheduled_start_time, scheduled_end_time,
      default_summary, transcript, action_items, url, share_url
    """
    data: dict = payload.get("data", payload)

    call_id = str(data.get("recording_id") or data.get("id", "unknown"))

    # Attendees — Fathom uses calendar_invitees
    attendees = [
        _as_str(a.get("name") or a.get("email"), "Unknown")
        for a in (data.get("calendar_invitees") or data.get("attendees") or [])
    ]

    # Action items
    raw_actions: list = data.get("action_items") or []
    action_items = [
        {
            "id": f"fathom-ai-{call_id}-{i}",
            "description": _as_str(item.get("text") or item.get("description"), ""),
            "assignee": _as_str(
                item.get("assignee"), attendees[0] if attendees else "Unassigned"
            ),
            "is_completed": bool(item.get("completed", False)),
        }
        for i, item in enumerate(raw_actions)
    ]

    # AI summary — Fathom uses default_summary (string or dict)
    raw_summary = data.get("default_summary") or data.get("summary")
    if isinstance(raw_summary, str):
        ai_summary = raw_summary or "Summary is being processed…"
        summary_obj: dict = {}
    else:
        summary_obj = raw_summary or {}
        ai_summary = _as_str(
            summary_obj.get("markdown_formatted")
            or summary_obj.get("short_summary")
            or summary_obj.get("overview")
            or summary_obj.get("text")
            or summary_obj.get("content"),
            "Summary is being processed…",
        )

    # Key decisions — try structured list first, then parse from markdown
    key_decisions: list[str] = []
    for bullet in (summary_obj.get("key_takeaways") or summary_obj.get("bullets") or []):
        text = _as_str(bullet.get("text") if isinstance(bullet, dict) else bullet, "")
        if text:
            key_decisions.append(text)

    if not key_decisions and ai_summary:
        # Parse bullet lines from the Key Takeaways section of the markdown
        in_takeaways = False
        for line in ai_summary.splitlines():
            stripped = line.strip()
            if stripped.lower().startswith("## key takeaway"):
                in_takeaways = True
                continue
            if in_takeaways:
                if stripped.startswith("##"):
                    break  # next section
                if stripped.startswith("- ") or stripped.startswith("* "):
                    # strip markdown link syntax [text](url) → text
                    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", stripped[2:]).strip()
                    # strip bold **text** → text
                    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text).strip()
                    if text:
                        key_decisions.append(text)

    # Timestamps — Fathom uses recording_start/end_time, falls back to scheduled
    started_at: str = (
        data.get("recording_start_time")
        or data.get("scheduled_start_time")
        or data.get("started_at", "")
    )
    ended_at: str = (
        data.get("recording_end_time")
        or data.get("scheduled_end_time")
        or data.get("ended_at", "")
    )
    duration_minutes = 0
    if started_at and ended_at:
        try:
            s = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
            e = datetime.fromisoformat(ended_at.replace("Z", "+00:00"))
            duration_minutes = max(0, int((e - s).total_seconds() / 60))
        except Exception:
            pass

    # Transcript — segments use {"speaker": {"display_name": "..."}, "text": "..."}
    raw_transcript = data.get("transcript") or ""
    if isinstance(raw_transcript, list):
        transcript = "\n".join(
            f"[{_as_str(seg.get('speaker') or seg.get('display_name'), 'Speaker')}] "
            f"{seg.get('text') or seg.get('content', '')}"
            for seg in raw_transcript
        )
    else:
        transcript = str(raw_transcript)

    # Title — meeting_title is the Google Calendar event name; title is Fathom's auto label
    title = _as_str(
        data.get("meeting_title") or data.get("title"), "Untitled Meeting"
    )

    # share_url is the Fathom recording page (not the Google Meet URL)
    share_url = _as_str(data.get("share_url") or data.get("url"), "")

    return {
        "id": f"fathom-{call_id}",
        "fathom_call_id": call_id,
        "title": title,
        "type": "Board Meeting",
        "date": started_at or datetime.now(timezone.utc).isoformat(),
        "duration_minutes": duration_minutes,
        "participants": attendees,
        "ai_summary": ai_summary,
        "key_decisions": key_decisions,
        "action_items": action_items,
        "has_recording": bool(share_url),
        "has_transcript": bool(transcript.strip()),
        "transcript": transcript,
        "recording_url": share_url,
        "meet_link": "",  # Google Meet URL is not in Fathom's payload
        "data_source": "live",
    }
