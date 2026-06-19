"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Play,
  Plus,
  RefreshCw,
  Upload,
  Users,
  Video,
  X,
  XCircle,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import {
  checkGoogleCalendarStatus,
  connectGoogleCalendar,
  fetchLiveMeetings,
  fetchWebhookLog,
  scheduleMeeting,
  type ScheduleMeetingInput,
  type WebhookLog,
} from "@/services/meetingsApi";
import type { Meeting } from "@/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, formatRelativeTime } from "@/lib/utils";
import { useRole } from "@/hooks/useRole";
import { useSession } from "next-auth/react";

// ── Constants ─────────────────────────────────────────────────────────────────

const TYPE_BADGE_MAP: Record<string, "board" | "department" | "committee" | "default"> = {
  "Board Meeting": "board",
  Department: "department",
  Committee: "committee",
};

const MEETING_TYPES = [
  "Board Meeting",
  "Department",
  "Committee",
  "1:1",
  "Research Council",
] as const;

const DURATION_OPTIONS = [30, 45, 60, 90, 120];

// ── Webhook Log Panel ─────────────────────────────────────────────────────────

function WebhookLogPanel({
  log,
  loading,
  onRefresh,
  onClose,
}: {
  log: WebhookLog | null;
  loading: boolean;
  onRefresh: () => void;
  onClose: () => void;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#0d1117]">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-slate-500" />
          <span className="text-xs font-semibold text-slate-300">Fathom Webhook Log</span>
          {log && (
            <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-slate-500">
              {log.count} deliveries
            </span>
          )}
          {log?.skip_verify && (
            <span className="rounded-full border border-yellow-500/20 bg-yellow-500/10 px-2 py-0.5 text-[10px] text-yellow-400">
              signature check off
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onRefresh}
            disabled={loading}
            className="rounded p-1 text-slate-600 hover:bg-white/5 hover:text-slate-400 disabled:opacity-40"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-600 hover:bg-white/5 hover:text-slate-400"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="px-4 py-3">
        {loading && !log && (
          <p className="py-4 text-center text-xs text-slate-600">Loading…</p>
        )}

        {!loading && log?.count === 0 && (
          <div className="py-6 text-center">
            <p className="text-xs text-slate-500">No webhook deliveries received yet.</p>
            <p className="mt-1 text-[10px] text-slate-700">
              Verify the Fathom webhook URL is set to:
            </p>
            <code className="mt-1 block text-[10px] text-blue-400">
              …/api/meetings/fathom-webhook
            </code>
          </div>
        )}

        {log && log.count > 0 && (
          <ul className="flex flex-col divide-y divide-white/5">
            {log.entries.map((entry, i) => (
              <li key={i} className="flex items-start gap-3 py-2.5">
                {entry.status === "ok" ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-400" />
                ) : (
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-300">
                      {entry.status === "ok"
                        ? (entry.meeting_title ?? "Meeting stored")
                        : `Rejected: ${entry.reason ?? "unknown"}`}
                    </span>
                    {entry.event_type && (
                      <span className="text-[10px] text-slate-600">{entry.event_type}</span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-600">
                    {new Date(entry.received_at).toLocaleString()}
                    {entry.meeting_id && (
                      <span className="ml-2 font-mono">{entry.meeting_id}</span>
                    )}
                  </p>
                  {entry.body_preview && (
                    <pre className="mt-1 overflow-x-auto rounded bg-white/5 px-2 py-1 font-mono text-[10px] text-slate-500">
                      {entry.body_preview}
                    </pre>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Schedule Dialog ───────────────────────────────────────────────────────────

interface ScheduleDialogProps {
  open: boolean;
  onClose: () => void;
  onScheduled: (result: { meet_link: string }) => void;
}

function ScheduleDialog({ open, onClose, onScheduled }: ScheduleDialogProps) {
  const { data: session } = useSession();
  const [title, setTitle] = useState("");
  const [startDatetime, setStartDatetime] = useState("");
  const [duration, setDuration] = useState(60);
  const [meetingType, setMeetingType] = useState<string>("Board Meeting");
  const [participantsRaw, setParticipantsRaw] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [fathomWarning, setFathomWarning] = useState<string | null>(null);
  const [tipsOpen, setTipsOpen] = useState(false);

  const minutesUntil = startDatetime
    ? (new Date(startDatetime).getTime() - Date.now()) / 60_000
    : null;
  const tooSoon = minutesUntil !== null && minutesUntil < 5;

  useEffect(() => {
    if (open && !startDatetime) {
      const now = new Date();
      now.setMinutes(0, 0, 0);
      now.setHours(now.getHours() + 1);
      setStartDatetime(
        new Date(now.getTime() - now.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16)
      );
    }
  }, [open, startDatetime]);

  function reset() {
    setTitle("");
    setStartDatetime("");
    setDuration(60);
    setMeetingType("Board Meeting");
    setParticipantsRaw("");
    setDescription("");
    setError(null);
    setSuccess(null);
    setFathomWarning(null);
    setTipsOpen(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !startDatetime) return;

    setSubmitting(true);
    setError(null);

    const emails = participantsRaw
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const input: ScheduleMeetingInput = {
      title: title.trim(),
      start_iso: new Date(startDatetime).toISOString(),
      duration_minutes: duration,
      attendee_emails: emails,
      meeting_type: meetingType,
      description: description.trim(),
      access_token: (session as typeof session & { accessToken?: string })?.accessToken,
    };

    try {
      const result = await scheduleMeeting(input);
      setSuccess(result.meet_link || "no-link");
      setFathomWarning(result.fathom_warning ?? null);
      onScheduled(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to schedule meeting");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative z-10 w-full max-w-lg mx-4 rounded-2xl border border-white/10 bg-[#0d1117] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-blue-400" />
            <h2 className="text-sm font-semibold text-slate-100">Schedule Meeting</h2>
          </div>
          <button onClick={handleClose} className="rounded-md p-1 text-slate-500 hover:bg-white/5 hover:text-slate-300">
            <X className="h-4 w-4" />
          </button>
        </div>

        {success ? (
          <div className="flex flex-col items-center gap-4 px-6 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/15 text-green-400">
              <Video className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-100">Meeting scheduled!</p>
              {success.startsWith("http") && (
                <a href={success} target="_blank" rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 text-xs text-blue-400 hover:underline">
                  <ExternalLink className="h-3 w-3" /> Open Google Meet
                </a>
              )}
            </div>
            {fathomWarning && (
              <div className="w-full rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2.5 text-left">
                <p className="text-xs font-medium text-yellow-400">⚠ Fathom auto-join notice</p>
                <p className="mt-0.5 text-xs text-yellow-300/80">{fathomWarning}</p>
              </div>
            )}
            <div className="w-full rounded-lg border border-white/5 bg-white/5 text-left">
              <button
                onClick={() => setTipsOpen((v) => !v)}
                className="flex w-full items-center justify-between px-3 py-2.5"
              >
                <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  Fathom auto-join checklist
                </span>
                <span className={cn("text-[10px] text-slate-600 transition-transform", tipsOpen && "rotate-180")}>▾</span>
              </button>
              {tipsOpen && (
                <ul className="flex flex-col gap-1 border-t border-white/5 px-3 pb-3 pt-2">
                  {[
                    "Fathom is connected to this Google Calendar account",
                    "Auto-join is set to 'Join all meetings' in Fathom settings",
                    "Meeting was scheduled at least 5 min before start time",
                    "Click 'Admit' when Fathom Notetaker knocks ~30 s before start",
                  ].map((tip, i) => (
                    <li key={i} className="flex items-start gap-2 text-[11px] text-slate-400">
                      <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-slate-600" />
                      {tip}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Button size="sm" variant="outline" onClick={handleClose}>Close</Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-6 py-5">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">
                Meeting title <span className="text-red-400">*</span>
              </label>
              <input required value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Q2 Strategy Review"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">
                  Start <span className="text-red-400">*</span>
                </label>
                <input required type="datetime-local" value={startDatetime}
                  onChange={(e) => setStartDatetime(e.target.value)}
                  className={cn(
                    "w-full rounded-lg border bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-1 [color-scheme:dark]",
                    tooSoon
                      ? "border-yellow-500/40 focus:border-yellow-500/60 focus:ring-yellow-500/20"
                      : "border-white/10 focus:border-blue-500/50 focus:ring-blue-500/30"
                  )} />
                {tooSoon && (
                  <p className="mt-1 text-[10px] text-yellow-400">
                    Less than 5 min away — Fathom bot may not have time to auto-join.
                  </p>
                )}
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">Duration</label>
                <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-full rounded-lg border border-white/10 bg-[#0d1117] px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30">
                  {DURATION_OPTIONS.map((d) => <option key={d} value={d}>{d} min</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">Type</label>
              <select value={meetingType} onChange={(e) => setMeetingType(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-[#0d1117] px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30">
                {MEETING_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">
                Participant emails <span className="text-slate-600">(comma or newline separated)</span>
              </label>
              <textarea value={participantsRaw} onChange={(e) => setParticipantsRaw(e.target.value)}
                placeholder="alice@example.com, bob@example.com" rows={2}
                className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30" />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">
                Description <span className="text-slate-600">(optional)</span>
              </label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="Agenda, notes…" rows={2}
                className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30" />
            </div>

            {error && (
              <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>
            )}

            <div className="flex justify-end gap-2 border-t border-white/5 pt-2">
              <Button type="button" size="sm" variant="ghost" onClick={handleClose}>Cancel</Button>
              <Button type="submit" size="sm" disabled={submitting || !title.trim() || !startDatetime} className="gap-1.5">
                {submitting
                  ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  : <Calendar className="h-3.5 w-3.5" />}
                {submitting ? "Scheduling…" : "Schedule"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MeetingsPage() {
  const { canMutate } = useRole();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "past" | "upcoming">("all");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [connectingGoogle, setConnectingGoogle] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [webhookLog, setWebhookLog] = useState<WebhookLog | null>(null);
  const [loadingLog, setLoadingLog] = useState(false);
  const [backendError, setBackendError] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const loadMeetings = useCallback(async () => {
    setLoading(true);
    setBackendError(false);
    try {
      const data = await fetchLiveMeetings();
      setMeetings(data);
    } catch {
      setBackendError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMeetings();
    checkGoogleCalendarStatus().then(({ connected, email }) => {
      setGoogleConnected(connected);
      setGoogleEmail(email ?? null);
    });
  }, [loadMeetings]);

  async function handleOpenLog() {
    setLogOpen(true);
    setLoadingLog(true);
    try {
      const log = await fetchWebhookLog();
      setWebhookLog(log);
      if (log.count > 0) loadMeetings();
    } catch {
      setWebhookLog({ count: 0, skip_verify: false, entries: [] });
    } finally {
      setLoadingLog(false);
    }
  }

  async function handleConnectGoogle() {
    setConnectingGoogle(true);
    setConnectError(null);
    try {
      const email = await connectGoogleCalendar();
      setGoogleConnected(true);
      setGoogleEmail(email);
    } catch (err) {
      if (err instanceof Error && err.message !== "Authentication cancelled.") {
        setConnectError(err.message);
      }
    } finally {
      setConnectingGoogle(false);
    }
  }

  const now = Date.now();
  const filtered = meetings.filter((m) => {
    const isPast = new Date(m.date).getTime() < now;
    if (filter === "past") return isPast;
    if (filter === "upcoming") return !isPast;
    return true;
  });
  const pastCount = meetings.filter((m) => new Date(m.date).getTime() < now).length;
  const upcomingCount = meetings.length - pastCount;

  return (
    <>
      <ScheduleDialog
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onScheduled={() => { setScheduleOpen(false); loadMeetings(); }}
      />

      <div className="flex min-h-full flex-col">
        <Header title="Meetings" subtitle="AI-summarised strategic sessions" />

        <div className="flex flex-col gap-5 p-6">
          {/* Google Calendar connect banner */}
          {!googleConnected && (
            <div className="flex items-center justify-between rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <Calendar className="h-4 w-4 shrink-0 text-yellow-400" />
                <span className="text-xs text-yellow-300">
                  Connect Google Calendar to schedule meetings with Google Meet and auto-import Fathom summaries.
                </span>
              </div>
              {canMutate && (
                <Button size="sm" variant="outline" onClick={handleConnectGoogle} disabled={connectingGoogle}
                  className="ml-4 shrink-0 border-yellow-500/30 text-yellow-300 hover:bg-yellow-500/10 text-xs">
                  {connectingGoogle ? "Connecting…" : "Connect"}
                </Button>
              )}
            </div>
          )}

          {googleConnected && googleEmail && (
            <div className="flex items-center gap-2 rounded-xl border border-green-500/20 bg-green-500/5 px-4 py-2.5">
              <div className="h-1.5 w-1.5 rounded-full bg-green-400" />
              <span className="text-xs text-green-400">
                Google Calendar connected as <strong>{googleEmail}</strong>
              </span>
            </div>
          )}

          {connectError && (
            <div className="flex items-start justify-between gap-3 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3">
              <div>
                <p className="text-xs font-medium text-red-400">Google Calendar connection failed</p>
                <p className="mt-0.5 text-xs text-red-300/70">{connectError}</p>
                <p className="mt-1 text-[10px] text-slate-500">
                  Make sure the FastAPI backend is running and ngrok is active:{" "}
                  <code className="text-slate-400">ngrok http 8000 --url=distill-subpar-bankroll.ngrok-free.dev</code>
                </p>
              </div>
              <button onClick={() => setConnectError(null)} className="shrink-0 text-slate-600 hover:text-slate-400">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {backendError && (
            <div className="flex items-center gap-2.5 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3">
              <XCircle className="h-4 w-4 shrink-0 text-red-400" />
              <span className="text-xs text-red-300">
                Could not reach the backend. Is FastAPI running on port 8000?{" "}
                <button onClick={loadMeetings} className="underline hover:text-red-200">Retry</button>
              </span>
            </div>
          )}

          {/* Controls */}
          <div className="flex items-center justify-between">
            <div className="flex gap-1 rounded-lg border border-white/5 bg-[#0d1117] p-1">
              {(["all", "past", "upcoming"] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-medium transition-colors capitalize",
                    filter === f ? "bg-white/10 text-slate-200" : "text-slate-500 hover:text-slate-300"
                  )}>
                  {f === "all" ? `All (${meetings.length})` : f === "past" ? `Past (${pastCount})` : `Upcoming (${upcomingCount})`}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              {canMutate && (
                <Button size="sm" variant="outline" className="gap-1.5 text-xs">
                  <Upload className="h-3.5 w-3.5" /> Upload Transcript
                </Button>
              )}
              <Button size="sm" variant="outline" className="gap-1.5 text-xs"
                onClick={handleOpenLog}>
                <Activity className="h-3.5 w-3.5" /> Webhook Log
              </Button>
              {canMutate && (
                <Button size="sm" className="gap-1.5 text-xs" onClick={() => setScheduleOpen(true)}>
                  <Plus className="h-3.5 w-3.5" /> Schedule Meeting
                </Button>
              )}
            </div>
          </div>

          {/* Webhook log panel */}
          {logOpen && (
            <WebhookLogPanel
              log={webhookLog}
              loading={loadingLog}
              onRefresh={handleOpenLog}
              onClose={() => setLogOpen(false)}
            />
          )}

          {/* Meeting list */}
          <div className="flex flex-col gap-2">
            {loading
              ? Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-24 rounded-xl" />)
              : filtered.length === 0
              ? (
                <div className="flex flex-col items-center gap-2 py-16 text-slate-600">
                  <Calendar className="h-8 w-8" />
                  <p className="text-sm">No meetings found</p>
                </div>
              )
              : filtered.map((meeting) => <MeetingCard key={meeting.id} meeting={meeting} />)}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Meeting card ──────────────────────────────────────────────────────────────

function MeetingCard({ meeting }: { meeting: Meeting }) {
  const now = Date.now();
  const isPast = new Date(meeting.date).getTime() < now;

  return (
    <Link href={`/meetings/${meeting.id}`}
      className="group flex flex-col gap-3 rounded-xl border border-white/5 bg-[#0d1117] p-4 transition-all hover:bg-white/5 hover:border-white/10">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant={TYPE_BADGE_MAP[meeting.type] ?? "default"}>{meeting.type}</Badge>
            {meeting.meet_link && (
              <span className="flex items-center gap-1 rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-400">
                <Video className="h-2.5 w-2.5" /> Meet
              </span>
            )}
            <span className="text-[10px] text-slate-600">{formatRelativeTime(meeting.date)}</span>
          </div>
          <h3 className="text-sm font-semibold text-slate-100 group-hover:text-white">{meeting.title}</h3>
          {meeting.ai_summary ? (
            <p className="mt-1 text-xs text-slate-500 line-clamp-2">{meeting.ai_summary}</p>
          ) : !isPast ? (
            <p className="mt-1 text-xs text-slate-600 italic">Scheduled — summary will appear after the meeting</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-[10px] text-slate-600">
          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{meeting.duration_minutes}m</span>
          <span className="flex items-center gap-1"><Users className="h-3 w-3" />{meeting.participants.length}</span>
        </div>
      </div>

      <div className="flex items-center gap-4 border-t border-white/5 pt-2">
        <span className="text-[10px] text-slate-600">
          {meeting.action_items.filter((a) => a.is_completed).length}/{meeting.action_items.length} actions done
        </span>
        <div className="ml-auto flex gap-3">
          {meeting.has_recording && (
            <span className="flex items-center gap-1 text-[10px] text-slate-500">
              <Play className="h-3 w-3" /> Recording
            </span>
          )}
          {meeting.has_transcript && (
            <span className="flex items-center gap-1 text-[10px] text-slate-500">
              <FileText className="h-3 w-3" /> Transcript
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
