"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Markdown from "react-markdown";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock,
  ExternalLink,
  FileText,
  Play,
  Trash2,
  Users,
  Video,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { deleteMeeting, fetchLiveMeeting } from "@/services/meetingsApi";
import type { Meeting } from "@/types";
import { Badge } from "@/components/ui/badge";
import { cn, formatDate } from "@/lib/utils";
import { useRole } from "@/hooks/useRole";

const TYPE_BADGE_MAP: Record<string, "board" | "department" | "committee" | "default"> = {
  "Board Meeting": "board",
  Department: "department",
  Committee: "committee",
};

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({
  title,
  icon: Icon,
  children,
  collapsible = false,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="rounded-xl border border-white/5 bg-[#0d1117]">
      <button
        onClick={() => collapsible && setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center justify-between px-5 py-3.5",
          collapsible && "cursor-pointer hover:bg-white/5"
        )}
      >
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-slate-500" />
          <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            {title}
          </span>
        </div>
        {collapsible && (
          <ChevronDown
            className={cn(
              "h-4 w-4 text-slate-600 transition-transform",
              open && "rotate-180"
            )}
          />
        )}
      </button>
      {open && (
        <div className="border-t border-white/5 px-5 py-4">{children}</div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MeetingDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const { canMutate } = useRole();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteMeeting(params.id);
      router.push("/meetings");
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const live = await fetchLiveMeeting(params.id);
        setMeeting(live);
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [params.id]);

  if (loading) {
    return (
      <div className="flex min-h-full flex-col">
        <Header title="Meeting" subtitle="" />
        <div className="flex flex-col gap-4 p-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-28 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (notFound || !meeting) {
    return (
      <div className="flex min-h-full flex-col">
        <Header title="Meeting" subtitle="" />
        <div className="flex flex-col items-center gap-3 py-20 text-slate-600">
          <FileText className="h-10 w-10" />
          <p className="text-sm">Meeting not found</p>
          <Link
            href="/meetings"
            className="text-xs text-blue-400 hover:underline"
          >
            Back to Meetings
          </Link>
        </div>
      </div>
    );
  }

  const completedActions = meeting.action_items.filter((a) => a.is_completed).length;

  return (
    <div className="flex min-h-full flex-col">
      <Header
        title={meeting.title}
        subtitle={formatDate(meeting.date)}
      />

      <div className="flex flex-col gap-4 p-6">
        {/* Back link + delete */}
        <div className="flex items-center justify-between">
          <Link
            href="/meetings"
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All Meetings
          </Link>

          {meeting.data_source === "live" && canMutate && (
            confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Delete this meeting?</span>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/20 disabled:opacity-50"
                >
                  {deleting ? "Deleting…" : "Yes, delete"}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 hover:bg-white/5"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-500 hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            )
          )}
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/5 bg-[#0d1117] px-5 py-4">
          <Badge variant={TYPE_BADGE_MAP[meeting.type] ?? "default"}>
            {meeting.type}
          </Badge>
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <Clock className="h-3.5 w-3.5" />
            {meeting.duration_minutes} min
          </span>
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <Users className="h-3.5 w-3.5" />
            {meeting.participants.join(", ")}
          </span>
          {meeting.meet_link && (
            <a
              href={meeting.meet_link}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto flex items-center gap-1.5 rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-1.5 text-xs text-blue-400 hover:bg-blue-500/20"
            >
              <Video className="h-3.5 w-3.5" />
              Open Google Meet
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {meeting.has_recording && meeting.recording_url && (
            <a
              href={meeting.recording_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 hover:bg-white/5"
            >
              <Play className="h-3.5 w-3.5" />
              Recording
            </a>
          )}
        </div>

        {/* AI Summary */}
        {meeting.ai_summary && meeting.ai_summary !== "Summary is being processed…" && (
          <Section title="AI Summary" icon={FileText}>
            <Markdown
              components={{
                h2: ({ children }) => (
                  <h2 className="mt-4 mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400 first:mt-0">
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="mt-3 mb-1 text-xs font-semibold text-slate-400">
                    {children}
                  </h3>
                ),
                p: ({ children }) => (
                  <p className="mb-2 text-sm leading-relaxed text-slate-300">{children}</p>
                ),
                ul: ({ children }) => (
                  <ul className="mb-2 flex flex-col gap-1 pl-1">{children}</ul>
                ),
                ol: ({ children }) => (
                  <ol className="mb-2 flex flex-col gap-1 pl-4 list-decimal">{children}</ol>
                ),
                li: ({ children }) => (
                  <li className="text-sm text-slate-300 leading-relaxed ml-3">
                    {children}
                  </li>
                ),
                strong: ({ children }) => (
                  <strong className="font-semibold text-slate-200">{children}</strong>
                ),
                a: ({ href, children }) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:underline"
                  >
                    {children}
                  </a>
                ),
              }}
            >
              {meeting.ai_summary}
            </Markdown>
          </Section>
        )}

        {/* Key Decisions */}
        {meeting.key_decisions.length > 0 && (
          <Section title="Key Decisions" icon={CheckCircle2}>
            <ul className="flex flex-col gap-2">
              {meeting.key_decisions.map((d, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-blue-500/30 bg-blue-500/10 text-[10px] text-blue-400">
                    {i + 1}
                  </span>
                  <span className="text-sm text-slate-300">{d}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Action Items */}
        <Section title={`Action Items (${completedActions}/${meeting.action_items.length})`} icon={CheckCircle2}>
          {meeting.action_items.length === 0 ? (
            <p className="text-xs text-slate-600">No action items recorded.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {meeting.action_items.map((item) => (
                <li key={item.id} className="flex items-start gap-3">
                  {item.is_completed ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
                  ) : (
                    <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-600" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p
                      className={cn(
                        "text-sm",
                        item.is_completed
                          ? "text-slate-500 line-through"
                          : "text-slate-300"
                      )}
                    >
                      {item.description}
                    </p>
                    <p className="text-[10px] text-slate-600">
                      Assignee: {item.assignee}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Transcript */}
        {meeting.has_transcript && meeting.transcript && (
          <Section title="Transcript" icon={FileText} collapsible>
            <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-slate-400">
              {meeting.transcript}
            </pre>
          </Section>
        )}

        {/* Fathom source badge */}
        {meeting.fathom_call_id && (
          <p className="text-center text-[10px] text-slate-700">
            Imported from Fathom · call {meeting.fathom_call_id}
          </p>
        )}
      </div>
    </div>
  );
}
