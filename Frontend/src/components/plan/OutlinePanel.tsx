"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  ChevronDown, ChevronRight, Plus, Trash2, ArrowUp, ArrowDown, Pencil, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlanDocument, Chapter, Subchapter } from "@/types/plan-document";
import type { EditorApi } from "./EditorApi";

// ─── Status dot ───────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: "auto" | "edited" | "verified" }) {
  return (
    <span
      title={status}
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        status === "verified" ? "bg-emerald-500" :
        status === "edited"   ? "bg-amber-400"   : "bg-slate-500",
      )}
    />
  );
}

// ─── Inline title editor ──────────────────────────────────────────────────────

function InlineEdit({
  value, onSave, className,
}: {
  value: string;
  onSave: (v: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    if (draft.trim()) onSave(draft.trim());
    else setDraft(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { setDraft(value); setEditing(false); }
        }}
        className={cn("flex-1 bg-transparent outline-none border-b border-cyan-500/50 text-slate-200 py-0.5", className)}
      />
    );
  }

  return (
    <button
      className={cn("group/edit flex items-center gap-1 text-start", className)}
      onDoubleClick={() => setEditing(true)}
      title="Double-click to rename"
    >
      <span className="flex-1">{value}</span>
      <Pencil className="h-2.5 w-2.5 shrink-0 opacity-0 group-hover/edit:opacity-40 transition-opacity" />
    </button>
  );
}

// ─── Subchapter row ───────────────────────────────────────────────────────────

function SubRow({
  ch, sub, idx, api, isLast,
}: {
  ch: Chapter;
  sub: Subchapter;
  idx: number;
  api: EditorApi;
  isLast: boolean;
}) {
  const handleClick = () => {
    const el = document.getElementById(sub.id);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="group/sub flex items-center gap-1.5 py-1 ps-7 hover:bg-white/5 rounded-md transition-colors">
      <StatusDot status={sub.status} />
      <span className="shrink-0 text-[10px] text-slate-600 w-5">
        {ch.number}.{idx + 1}
      </span>
      <InlineEdit
        value={sub.heading}
        onSave={(v) => api.setHeading(ch.id, sub.id, v)}
        className="flex-1 text-xs text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
      />
      <button
        title="Go to section"
        onClick={handleClick}
        className="shrink-0 text-slate-600 hover:text-slate-300 transition-colors opacity-0 group-hover/sub:opacity-100"
      >
        <ChevronRight className="h-3 w-3" />
      </button>
      <div className="hidden group-hover/sub:flex items-center gap-0.5 shrink-0">
        <button
          title="Move up"
          disabled={idx === 0}
          onClick={() => api.moveSubchapter(ch.id, sub.id, "up")}
          className="flex h-4 w-4 items-center justify-center rounded text-slate-500 hover:bg-white/5 hover:text-slate-300 disabled:opacity-20 transition-colors"
        >
          <ArrowUp className="h-2.5 w-2.5" />
        </button>
        <button
          title="Move down"
          disabled={isLast}
          onClick={() => api.moveSubchapter(ch.id, sub.id, "down")}
          className="flex h-4 w-4 items-center justify-center rounded text-slate-500 hover:bg-white/5 hover:text-slate-300 disabled:opacity-20 transition-colors"
        >
          <ArrowDown className="h-2.5 w-2.5" />
        </button>
        <button
          title="Delete section"
          onClick={() => { if (confirm("Delete this section?")) api.deleteSubchapter(ch.id, sub.id); }}
          className="flex h-4 w-4 items-center justify-center rounded text-rose-400/60 hover:bg-rose-500/10 hover:text-rose-400 transition-colors"
        >
          <Trash2 className="h-2.5 w-2.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Chapter row ──────────────────────────────────────────────────────────────

function ChapterRow({
  ch, api, isFirst, isLast, chIdx, total,
}: {
  ch: Chapter;
  api: EditorApi;
  isFirst: boolean;
  isLast: boolean;
  chIdx: number;
  total: number;
}) {
  const [open, setOpen] = useState(true);
  const rolledStatus: "auto" | "edited" | "verified" =
    ch.sections.length === 0 ? "auto"
    : ch.sections.every(s => s.status === "verified") ? "verified"
    : ch.sections.some(s => s.status === "edited") ? "edited"
    : "auto";

  const handleChapterClick = () => {
    const el = document.getElementById(ch.id);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div>
      {/* Chapter header */}
      <div className="group/ch flex items-center gap-1.5 py-1.5 px-2 rounded-md hover:bg-white/5 transition-colors">
        <button
          onClick={() => setOpen(v => !v)}
          className="shrink-0 text-slate-600 hover:text-slate-300 transition-colors"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>

        <StatusDot status={rolledStatus} />

        <span className="shrink-0 text-[10px] font-bold text-slate-600">
          {String(chIdx + 1).padStart(2, "0")}
        </span>

        <InlineEdit
          value={ch.title}
          onSave={(v) => api.setHeading(ch.id, null, v)}
          className="flex-1 text-xs font-semibold text-slate-300 hover:text-slate-100 transition-colors cursor-pointer"
        />

        <button
          title="Go to chapter"
          onClick={handleChapterClick}
          className="shrink-0 text-slate-600 hover:text-slate-300 opacity-0 group-hover/ch:opacity-100 transition-opacity"
        >
          <ChevronRight className="h-3 w-3" />
        </button>

        <div className="hidden group-hover/ch:flex items-center gap-0.5 shrink-0">
          <button
            disabled={isFirst}
            onClick={() => api.moveChapter(ch.id, "up")}
            className="flex h-4 w-4 items-center justify-center rounded text-slate-500 hover:bg-white/5 hover:text-slate-300 disabled:opacity-20 transition-colors"
          >
            <ArrowUp className="h-2.5 w-2.5" />
          </button>
          <button
            disabled={isLast}
            onClick={() => api.moveChapter(ch.id, "down")}
            className="flex h-4 w-4 items-center justify-center rounded text-slate-500 hover:bg-white/5 hover:text-slate-300 disabled:opacity-20 transition-colors"
          >
            <ArrowDown className="h-2.5 w-2.5" />
          </button>
          <button
            disabled={total <= 1}
            onClick={() => { if (confirm("Delete this chapter?")) api.deleteChapter(ch.id); }}
            className="flex h-4 w-4 items-center justify-center rounded text-rose-400/60 hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-20 transition-colors"
          >
            <Trash2 className="h-2.5 w-2.5" />
          </button>
        </div>
      </div>

      {/* Subchapter rows */}
      {open && (
        <div>
          {ch.sections.map((sub, idx) => (
            <SubRow
              key={sub.id}
              ch={ch}
              sub={sub}
              idx={idx}
              api={api}
              isLast={idx === ch.sections.length - 1}
            />
          ))}
          {/* Add subchapter */}
          <button
            onClick={() => api.addSubchapter(ch.id)}
            className="mt-0.5 flex w-full items-center gap-1.5 rounded-md px-3 py-1 ps-9 text-xs text-slate-600 hover:bg-white/5 hover:text-slate-400 transition-colors"
          >
            <Plus className="h-3 w-3" />
            Add section
          </button>
        </div>
      )}
    </div>
  );
}

// ─── OutlinePanel ─────────────────────────────────────────────────────────────

interface OutlinePanelProps {
  doc: PlanDocument;
  editorApi: EditorApi;
}

export function OutlinePanel({ doc, editorApi }: OutlinePanelProps) {
  return (
    <aside className="flex h-full w-56 flex-col border-e border-white/5 bg-[#0b0e1a] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-3">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
          Outline
        </span>
        <div className="flex items-center gap-2 text-[10px] text-slate-600">
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" /> verified
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" /> edited
          </span>
        </div>
      </div>

      {/* Chapter list */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-0.5">
        {doc.chapters.map((ch, i) => (
          <ChapterRow
            key={ch.id}
            ch={ch}
            api={editorApi}
            isFirst={i === 0}
            isLast={i === doc.chapters.length - 1}
            chIdx={i}
            total={doc.chapters.length}
          />
        ))}
        {/* Add chapter */}
        <button
          onClick={() => editorApi.addChapter()}
          className="mt-2 flex w-full items-center gap-1.5 rounded-md border border-dashed border-white/10 px-3 py-2 text-xs text-slate-600 hover:border-white/20 hover:text-slate-400 transition-colors"
        >
          <Plus className="h-3 w-3" />
          Add chapter
        </button>
      </div>

      {/* Status summary */}
      <div className="border-t border-white/5 px-3 py-2 text-[10px] text-slate-600">
        {(() => {
          const allSubs = doc.chapters.flatMap(c => c.sections);
          const verified = allSubs.filter(s => s.status === "verified").length;
          const total = allSubs.length;
          const pct = total > 0 ? Math.round((verified / total) * 100) : 0;
          return (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1 rounded-full bg-white/5 overflow-hidden">
                <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <span>{verified}/{total} approved</span>
            </div>
          );
        })()}
      </div>
    </aside>
  );
}
