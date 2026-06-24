/**
 * meetingsApi.ts
 * HTTP client for the StratOS Meetings Agent routes.
 *
 * Routes consumed:
 *   GET  /api/auth/google/status    → {connected, email}
 *   GET  /api/auth/google/start     → redirects to Google OAuth (open in popup)
 *   POST /api/meetings/schedule     → create calendar event
 *   GET  /api/meetings              → list all meetings
 *   GET  /api/meetings/{id}         → single meeting with transcript
 */

import type { Meeting } from "@/types";

const BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
).replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GoogleCalendarStatus {
  connected: boolean;
  email: string | null;
}

export interface ScheduleMeetingInput {
  title: string;
  start_iso: string;
  duration_minutes: number;
  attendee_emails: string[];
  meeting_type: string;
  description?: string;
  access_token?: string;
}

export interface ScheduleMeetingResult {
  meeting_id: string;
  meet_link: string;
  calendar_event_id: string;
  html_link: string;
  fathom_warning: string | null;
  calendar_error: string | null;
}

// ── Token handoff — keeps the FastAPI backend's refresh token in sync ─────────

export async function handoffGoogleToken(
  accessToken: string,
  refreshToken: string | undefined,
  email: string | null | undefined,
): Promise<void> {
  await fetch(`${BASE_URL}/api/auth/google/handoff`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: accessToken, refresh_token: refreshToken ?? null, email: email ?? null }),
  }).catch(() => {}); // best-effort: never block the UI
}

// ── Google Calendar auth ──────────────────────────────────────────────────────

export async function checkGoogleCalendarStatus(): Promise<GoogleCalendarStatus> {
  try {
    const res = await fetch(`${BASE_URL}/api/auth/google/status`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) return { connected: false, email: null };
    return res.json() as Promise<GoogleCalendarStatus>;
  } catch {
    return { connected: false, email: null };
  }
}

/**
 * Opens the Google OAuth flow in a popup window.
 * Resolves with the authorised email when the popup posts back success,
 * or rejects if the popup is closed without completing auth.
 */
export function connectGoogleCalendar(): Promise<string> {
  return new Promise((resolve, reject) => {
    const popup = window.open(
      `${BASE_URL}/api/auth/google/start`,
      "google-oauth",
      "width=520,height=640,scrollbars=yes,resizable=yes"
    );

    if (!popup) {
      reject(new Error("Popup blocked — please allow popups for this site."));
      return;
    }

    const handler = (e: MessageEvent) => {
      if (e.data?.type === "google-auth-success") {
        window.removeEventListener("message", handler);
        resolve(e.data.email ?? "");
      }
    };
    window.addEventListener("message", handler);

    // Detect popup closed without completing auth
    const poll = setInterval(() => {
      if (popup.closed) {
        clearInterval(poll);
        window.removeEventListener("message", handler);
        reject(new Error("Authentication cancelled."));
      }
    }, 500);
  });
}

// ── Meetings CRUD ─────────────────────────────────────────────────────────────

export async function scheduleMeeting(
  input: ScheduleMeetingInput
): Promise<ScheduleMeetingResult> {
  const res = await fetch(`${BASE_URL}/api/meetings/schedule`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string };
    throw new Error(err.detail ?? "Failed to schedule meeting");
  }
  return res.json() as Promise<ScheduleMeetingResult>;
}

export async function fetchLiveMeetings(): Promise<Meeting[]> {
  const res = await fetch(`${BASE_URL}/api/meetings`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error("Failed to fetch meetings");
  return res.json() as Promise<Meeting[]>;
}

export async function fetchLiveMeeting(id: string): Promise<Meeting> {
  const res = await fetch(`${BASE_URL}/api/meetings/${id}`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error("Meeting not found");
  return res.json() as Promise<Meeting>;
}

export async function deleteMeeting(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/meetings/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string };
    throw new Error(err.detail ?? "Failed to delete meeting");
  }
}

export interface WebhookLogEntry {
  received_at: string;
  status: "ok" | "rejected";
  event_type?: string;
  meeting_id?: string;
  meeting_title?: string;
  reason?: string;
  body_preview?: string;
  sig_verified?: boolean | null;
}

export interface WebhookLog {
  count: number;
  skip_verify: boolean;
  entries: WebhookLogEntry[];
}

export async function fetchWebhookLog(): Promise<WebhookLog> {
  const res = await fetch(`${BASE_URL}/api/meetings/webhook-log`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error("Failed to fetch webhook log");
  return res.json() as Promise<WebhookLog>;
}
