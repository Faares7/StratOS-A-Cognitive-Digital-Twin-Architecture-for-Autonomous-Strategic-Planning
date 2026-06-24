"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Check,
  Clock,
  ExternalLink,
  FileText,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Upload,
  Wallet,
  X,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRole } from "@/hooks/useRole";
import type { OrgProfile } from "@/app/api/org/profile/route";
import type { ReferencePlan } from "@/app/api/knowledge-base/plans/route";

// ── Constants ─────────────────────────────────────────────────────────────────

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "") ?? "http://localhost:8000";


// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(2);
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}-${mm}-${yy} · ${hh}:${min}`;
}

// ── ChipListEditor ────────────────────────────────────────────────────────────

function ChipListEditor({
  items,
  onChange,
}: {
  items: string[];
  onChange: (next: string[]) => void;
}) {
  const [input, setInput] = useState("");

  function add() {
    const v = input.trim();
    if (!v || items.includes(v)) return;
    onChange([...items, v]);
    setInput("");
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span
            key={item}
            className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs text-slate-300"
          >
            {item}
            <button
              onClick={() => onChange(items.filter((i) => i !== item))}
              className="ml-0.5 text-slate-600 hover:text-slate-400"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="Add item..."
          className="flex-1 rounded-lg border border-white/10 bg-[#080a14] px-3 py-1.5 text-xs text-slate-300 placeholder-slate-600 outline-none focus:border-cyan-500/40"
        />
        <button
          onClick={add}
          disabled={!input.trim()}
          className="flex items-center gap-1 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 transition hover:border-cyan-500/30 hover:text-cyan-400 disabled:opacity-30"
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>
      </div>
    </div>
  );
}

function ChipList({ items }: { items: string[] | null }) {
  if (!items?.length) return <p className="text-xs text-slate-600 italic">None set</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs text-slate-300"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

// ── Status chip for a plan ────────────────────────────────────────────────────

function PlanStatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    needs_review: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    edited:       "bg-violet-500/10 text-violet-400 border-violet-500/20",
    verified:     "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    pending:      "bg-slate-500/10 text-slate-400 border-slate-500/20",
    extracting:   "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
    failed:       "bg-rose-500/10 text-rose-400 border-rose-500/20",
  };
  const label: Record<string, string> = {
    needs_review: "needs review",
    edited:       "edited",
    verified:     "verified",
    pending:      "processing",
    extracting:   "extracting",
    failed:       "failed",
  };

  const key = map[status] ? status : "pending";
  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", map[key])}>
      {label[key] ?? key}
    </span>
  );
}

// ── Plan document block ───────────────────────────────────────────────────────

function PlanBlock({
  plan,
  onRetrigger,
}: {
  plan: ReferencePlan;
  onRetrigger: () => void;
}) {
  const isInProgress =
    plan.extraction_status === "pending" || plan.extraction_status === "extracting";

  const [logs,      setLogs]      = useState<string[]>([]);
  const [retrying,  setRetrying]  = useState(false);
  const [retryErr,  setRetryErr]  = useState<string | null>(null);

  // Poll pipeline logs every 2 s while extraction is running
  useEffect(() => {
    if (!isInProgress) return;
    const poll = async () => {
      try {
        const res = await fetch(`/api/knowledge-base/${plan.plan_id}/logs`, {
          cache: "no-store",
        });
        if (res.ok) {
          const data = (await res.json()) as { logs: string[] };
          setLogs(data.logs);
        }
      } catch { /* ignore */ }
    };
    void poll();
    const id = setInterval(() => void poll(), 2_000);
    return () => clearInterval(id);
  }, [isInProgress, plan.plan_id]);

  async function retrigger() {
    setRetrying(true);
    setRetryErr(null);
    setLogs([]);
    try {
      const res = await fetch(`/api/knowledge-base/${plan.plan_id}/trigger`, {
        method: "POST",
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(e.error ?? `HTTP ${res.status}`);
      }
      onRetrigger(); // refresh plan list so status updates
    } catch (err) {
      setRetryErr(err instanceof Error ? err.message : "Failed to trigger");
    } finally {
      setRetrying(false);
    }
  }

  // Derive 0–100 progress from the latest "Step X/7" line
  const progress = useMemo(() => {
    if (!isInProgress) return plan.extraction_status === "ready" ? 100 : 0;
    for (let i = logs.length - 1; i >= 0; i--) {
      const m = logs[i].match(/Step (\d+)\/7/);
      if (m) return Math.min(Math.round((parseInt(m[1]) / 7) * 100), 95);
    }
    return logs.length > 0 ? 12 : 5;
  }, [logs, isInProgress, plan.extraction_status]);

  // Show latest meaningful log line (strip timestamp prefix)
  const latestStep = useMemo(() => {
    for (let i = logs.length - 1; i >= 0; i--) {
      const line = logs[i].replace(/^\[pipeline [\d:]+\]\s*/, "").trim();
      if (line && !line.startsWith("━")) return line;
    }
    return plan.extraction_status === "pending"
      ? "Queued — waiting for pipeline…"
      : "Starting extraction…";
  }, [logs, plan.extraction_status]);

  const displayStatus =
    plan.extraction_status !== "ready"
      ? plan.extraction_status
      : (plan.computed_status ?? "needs_review");

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-white/5 bg-[#0d1117] px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5">
            <FileText className="h-4 w-4 text-slate-400" />
          </div>
          <div className="space-y-1 min-w-0">
            <p className="text-sm font-medium text-slate-200 truncate">
              {plan.title ?? "Untitled plan"}
              {plan.period_label && (
                <span className="ml-2 text-xs text-slate-500">{plan.period_label}</span>
              )}
            </p>
            <div className="flex items-center gap-1.5 flex-wrap">
              <PlanStatusChip status={displayStatus} />
              {isInProgress && (
                <Loader2 className="h-3 w-3 animate-spin text-cyan-500" />
              )}
            </div>
            <p className="flex items-center gap-1 text-[11px] text-slate-600">
              <Clock className="h-3 w-3" />
              Uploaded {fmtDate(plan.uploaded_at)}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {plan.extraction_status === "ready" && (
            <Link
              href={`/knowledge-base/${plan.plan_id}/review`}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 transition hover:border-cyan-500/30 hover:text-cyan-400"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Review / Edit
            </Link>
          )}
          {/* Retry button — shown when stuck in pending/extracting */}
          {isInProgress && (
            <button
              onClick={() => void retrigger()}
              disabled={retrying}
              title="Re-trigger pipeline"
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-500 transition hover:border-cyan-500/30 hover:text-cyan-400 disabled:opacity-40"
            >
              {retrying
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <RefreshCw className="h-3.5 w-3.5" />}
              {retrying ? "Starting…" : "Retry"}
            </button>
          )}
          {/* Also show retry when failed */}
          {plan.extraction_status === "failed" && (
            <button
              onClick={() => void retrigger()}
              disabled={retrying}
              className="flex items-center gap-1.5 rounded-lg border border-rose-500/20 px-3 py-1.5 text-xs text-rose-400 transition hover:border-rose-400/40 disabled:opacity-40"
            >
              {retrying
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <RefreshCw className="h-3.5 w-3.5" />}
              {retrying ? "Starting…" : "Retry"}
            </button>
          )}
        </div>
      </div>

      {/* Live progress bar — only while extracting */}
      {isInProgress && (
        <div className="space-y-1.5 border-t border-white/5 pt-3">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-[11px] text-slate-500 max-w-[88%]">
              {latestStep}
            </p>
            <span className="shrink-0 text-[10px] font-mono text-slate-600">{progress}%</span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full bg-cyan-500 transition-all duration-700 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {retryErr && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-400">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {retryErr}
        </div>
      )}
    </div>
  );
}

// ── Upload dialog ─────────────────────────────────────────────────────────────

function UploadDialog({
  onClose,
  onUploaded,
}: {
  onClose: () => void;
  onUploaded: () => void;
}) {
  const fileRef   = useRef<HTMLInputElement>(null);
  const [file,    setFile]    = useState<File | null>(null);
  const [title,   setTitle]   = useState("");
  const [period,  setPeriod]  = useState("");
  const [vDate,   setVDate]   = useState("");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  async function submit() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (title)  fd.append("title", title);
      if (period) fd.append("period_label", period);
      if (vDate)  fd.append("version_date", vDate);

      const res = await fetch("/api/knowledge-base/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const e = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(e.error ?? "Upload failed");
      }
      onUploaded();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d1117] p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100">Upload Strategic Plan</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          {/* File picker */}
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              PDF File *
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="flex w-full items-center gap-2 rounded-lg border border-dashed border-white/20 px-4 py-3 text-sm text-slate-500 transition hover:border-cyan-500/40 hover:text-slate-300"
            >
              <Upload className="h-4 w-4 shrink-0" />
              {file ? file.name : "Click to select a PDF"}
            </button>
          </div>

          {/* Title */}
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Title (optional)
            </p>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., NU FCIT Strategic Plan"
              className="w-full rounded-lg border border-white/10 bg-[#080a14] px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500/50 placeholder-slate-600"
            />
          </div>

          {/* Period label */}
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Period Label (optional)
            </p>
            <input
              type="text"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              placeholder="e.g., 2020–2024"
              className="w-full rounded-lg border border-white/10 bg-[#080a14] px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500/50 placeholder-slate-600"
            />
          </div>

          {/* Version date */}
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Approval Date (optional)
            </p>
            <input
              type="date"
              value={vDate}
              onChange={(e) => setVDate(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-[#080a14] px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500/50"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-400">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="text-xs text-slate-500 hover:text-slate-300 transition"
          >
            Cancel
          </button>
          <Button size="sm" disabled={!file || loading} onClick={() => void submit()} className="gap-1.5 text-xs">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {loading ? "Uploading…" : "Upload"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Budget section ────────────────────────────────────────────────────────────

interface WorkspaceBudget {
  total_budget_egp: number;
  pillar_allocations: { pillar_id: number; allocated_egp: number; pillar_name: string }[];
}

function fmt(n: number) {
  return n.toLocaleString("en-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 0 });
}

function BudgetSection({ isAdmin }: { isAdmin: boolean }) {
  const [budget,  setBudget]  = useState<WorkspaceBudget | null>(null);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // Edit-form state: flat map pillarId → string value for controlled inputs
  const [totalDraft,   setTotalDraft]   = useState("");
  const [pillarDrafts, setPillarDrafts] = useState<Record<number, string>>({});

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${BACKEND}/api/workspace/budget`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setBudget(await res.json() as WorkspaceBudget);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not load budget");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function startEdit() {
    if (!budget) return;
    setTotalDraft(String(Math.round(budget.total_budget_egp)));
    const drafts: Record<number, string> = {};
    for (const p of budget.pillar_allocations) drafts[p.pillar_id] = String(Math.round(p.allocated_egp));
    setPillarDrafts(drafts);
    setSaveErr(null);
    setEditing(true);
  }

  async function saveBudget() {
    setSaving(true);
    setSaveErr(null);
    try {
      const body = {
        total_budget_egp: Number(totalDraft) || 0,
        pillar_allocations: Object.entries(pillarDrafts).map(([id, v]) => ({
          pillar_id: Number(id),
          allocated_egp: Number(v) || 0,
        })),
      };
      const res = await fetch(`${BACKEND}/api/workspace/budget`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated = await res.json() as WorkspaceBudget;
      setBudget(updated);
      setEditing(false);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const totalAllocated = budget?.pillar_allocations?.reduce((s, p) => s + p.allocated_egp, 0) ?? 0;
  const draftAllocated = Object.values(pillarDrafts).reduce((s, v) => s + (Number(v) || 0), 0);
  const draftTotal     = Number(totalDraft) || 0;
  const over           = editing ? draftAllocated > draftTotal : totalAllocated > (budget?.total_budget_egp ?? 0);

  return (
    <div className="rounded-xl border border-white/5 bg-[#0d1117]">
      <div className="flex items-center justify-between border-b border-white/5 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <Wallet className="h-4 w-4 text-cyan-400" />
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Strategic Budget</h3>
            <p className="text-xs text-slate-500">Workspace budget allocated across NAQAAE pillars</p>
          </div>
        </div>
        {isAdmin && !editing && !loading && !err && (
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={startEdit}>
            <Pencil className="h-3 w-3" /> Edit
          </Button>
        )}
        {editing && (
          <div className="flex items-center gap-2">
            <button onClick={() => setEditing(false)} className="text-xs text-slate-500 hover:text-slate-300">
              Cancel
            </button>
            <Button size="sm" className="gap-1.5 text-xs" onClick={() => void saveBudget()} disabled={saving || over}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </div>

      <div className="p-5 space-y-4">
        {loading && (
          <div className="flex items-center gap-2 text-slate-600">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span className="text-xs">Loading budget…</span>
          </div>
        )}

        {err && !loading && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-400">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {err}
          </div>
        )}

        {budget && !loading && (
          <>
            {/* Total budget row */}
            <div className="flex items-center justify-between gap-4 rounded-lg border border-cyan-500/15 bg-cyan-500/[0.05] px-4 py-3">
              <span className="text-xs font-semibold text-slate-300">Total Workspace Budget</span>
              {editing ? (
                <input
                  type="text"
                  inputMode="numeric"
                  value={totalDraft}
                  onChange={(e) => setTotalDraft(e.target.value.replace(/[^0-9]/g, ""))}
                  className="w-36 rounded-md border border-white/10 bg-[#080a14] px-2 py-1 text-right text-sm text-slate-200 outline-none focus:border-cyan-500/40"
                />
              ) : (
                <span className="text-sm font-bold text-cyan-300">{fmt(budget.total_budget_egp)}</span>
              )}
            </div>

            {/* Per-pillar rows */}
            <div className="space-y-1.5">
              {[1, 2, 3, 4, 5, 6, 7].map((pid) => {
                const row = budget.pillar_allocations.find((p) => p.pillar_id === pid);
                const name = row?.pillar_name ?? `Pillar ${pid}`;
                const allocated = row?.allocated_egp ?? 0;
                const pct = budget.total_budget_egp > 0
                  ? Math.min(100, (allocated / budget.total_budget_egp) * 100) : 0;
                const draftPct = draftTotal > 0
                  ? Math.min(100, ((Number(pillarDrafts[pid]) || 0) / draftTotal) * 100) : 0;

                return (
                  <div key={pid} className="flex items-center gap-3 rounded-lg border border-white/5 px-3 py-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#b8922f]/30 text-[10px] font-bold text-[#b8922f]">
                      {pid}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-300">{name}</span>
                    {editing ? (
                      <>
                        <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-white/5">
                          <div className="h-full rounded-full bg-cyan-500/50" style={{ width: `${draftPct}%` }} />
                        </div>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={pillarDrafts[pid] ?? "0"}
                          onChange={(e) => setPillarDrafts((d) => ({ ...d, [pid]: e.target.value.replace(/[^0-9]/g, "") }))}
                          className="w-32 rounded-md border border-white/10 bg-[#080a14] px-2 py-1 text-right text-xs text-slate-200 outline-none focus:border-cyan-500/40"
                        />
                      </>
                    ) : (
                      <>
                        <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-white/5">
                          <div className="h-full rounded-full bg-cyan-500" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-32 text-right text-xs text-slate-300">{fmt(allocated)}</span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Allocation summary */}
            <div className={cn(
              "flex items-center justify-between rounded-lg px-3 py-2 text-xs",
              over
                ? "border border-rose-500/20 bg-rose-500/5 text-rose-400"
                : "border border-white/5 bg-white/[0.02] text-slate-500",
            )}>
              <span>Total allocated across pillars</span>
              <span className="font-semibold">
                {fmt(editing ? draftAllocated : totalAllocated)}
                {" / "}
                {fmt(editing ? draftTotal : (budget.total_budget_egp))}
                {over && " — exceeds total"}
              </span>
            </div>

            {saveErr && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-400">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {saveErr}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

interface EditState {
  faculty: string;
  strategic_period: string;
  strategic_priorities: string[];
  academic_programs: string[];
  research_focus: string[];
}

export default function ProfilePage() {
  const { isAdmin } = useRole();
  const [profile,  setProfile]  = useState<OrgProfile | null>(null);
  const [plans,    setPlans]    = useState<ReferencePlan[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [editing,  setEditing]  = useState(false);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [saving,   setSaving]   = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  const loadProfile = useCallback(async () => {
    const res = await fetch("/api/org/profile");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<OrgProfile>;
  }, []);

  const loadPlans = useCallback(async () => {
    const res = await fetch("/api/knowledge-base/plans");
    if (!res.ok) return [] as ReferencePlan[];
    return res.json() as Promise<ReferencePlan[]>;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, pl] = await Promise.all([loadProfile(), loadPlans()]);
      setProfile(p);
      setPlans(pl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [loadProfile, loadPlans]);

  useEffect(() => { void load(); }, [load]);

  // Auto-poll while any plan is still being extracted (every 4 s)
  useEffect(() => {
    const hasInProgress = plans.some(
      (p) => p.extraction_status === "pending" || p.extraction_status === "extracting"
    );
    if (!hasInProgress) return;
    const id = setInterval(async () => {
      const updated = await loadPlans();
      setPlans(updated);
    }, 4_000);
    return () => clearInterval(id);
  }, [plans, loadPlans]);

  function startEdit() {
    if (!profile) return;
    setEditState({
      faculty:               profile.faculty               ?? "",
      strategic_period:      profile.strategic_period      ?? "",
      strategic_priorities:  profile.strategic_priorities  ?? [],
      academic_programs:     profile.academic_programs     ?? [],
      research_focus:        profile.research_focus        ?? [],
    });
    setSaveError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setEditState(null);
    setSaveError(null);
  }

  async function saveEdit() {
    if (!editState) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/org/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          faculty:               editState.faculty,
          strategic_period:      editState.strategic_period,
          strategic_priorities:  editState.strategic_priorities,
          academic_programs:     editState.academic_programs,
          research_focus:        editState.research_focus,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(e.error ?? "Save failed");
      }
      setProfile((prev) => prev ? { ...prev, ...editState } : prev);
      setEditing(false);
      setEditState(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <Header
        title="Organization Profile"
        subtitle="Institution details and strategic workspace configuration"
      />

      {showUpload && (
        <UploadDialog
          onClose={() => setShowUpload(false)}
          onUploaded={() => void loadPlans().then(setPlans)}
        />
      )}

      <div className="flex flex-col gap-5 p-6 max-w-2xl">
        {loading && (
          <div className="flex items-center gap-2 py-10 text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-xs text-rose-400">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {profile && !loading && (
          <>
            {/* Institution Details */}
            <div className="rounded-xl border border-white/5 bg-[#0d1117] p-5">
              <h3 className="mb-4 text-sm font-semibold text-slate-100">Institution Details</h3>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: "Institution Name",   value: profile.display_name },
                  { label: "Country",            value: "Egypt" },
                  { label: "Accreditation Body", value: "NAQAAE" },
                  { label: "Deployment",         value: "Single-tenant" },
                ].map((f) => (
                  <div key={f.label}>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">{f.label}</p>
                    <p className="mt-0.5 text-sm text-slate-200">{f.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Strategic Profile */}
            <div className="rounded-xl border border-white/5 bg-[#0d1117]">
              <div className="flex items-center justify-between border-b border-white/5 px-5 py-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">Strategic Profile</h3>
                  <p className="text-xs text-slate-500">Planning context configured during onboarding</p>
                </div>
                {isAdmin && !editing && (
                  <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={startEdit}>
                    <Pencil className="h-3 w-3" /> Edit
                  </Button>
                )}
                {editing && (
                  <div className="flex items-center gap-2">
                    <button onClick={cancelEdit} className="text-xs text-slate-500 hover:text-slate-300">Cancel</button>
                    <Button size="sm" className="gap-1.5 text-xs" onClick={() => void saveEdit()} disabled={saving}>
                      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      {saving ? "Saving…" : "Save"}
                    </Button>
                  </div>
                )}
              </div>

              {saveError && (
                <div className="mx-5 mt-3 rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-400">
                  {saveError}
                </div>
              )}

              <div className="divide-y divide-white/5">
                <div className="px-5 py-4">
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Faculty / Department</p>
                  {editing && editState ? (
                    <input
                      type="text"
                      value={editState.faculty}
                      onChange={(e) => setEditState({ ...editState, faculty: e.target.value })}
                      placeholder="e.g., ITCS"
                      className="w-full rounded-lg border border-white/10 bg-[#080a14] px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500/50"
                    />
                  ) : (
                    <p className={cn("text-sm", profile.faculty ? "text-slate-200" : "italic text-slate-600")}>
                      {profile.faculty ?? "Not set"}
                    </p>
                  )}
                </div>

                <div className="px-5 py-4">
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Strategic Period</p>
                  {editing && editState ? (
                    <input
                      type="text"
                      value={editState.strategic_period}
                      onChange={(e) => setEditState({ ...editState, strategic_period: e.target.value })}
                      placeholder="e.g., 2024-2027"
                      className="w-full rounded-lg border border-white/10 bg-[#080a14] px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500/50"
                    />
                  ) : (
                    <p className={cn("text-sm", profile.strategic_period ? "text-slate-200" : "italic text-slate-600")}>
                      {profile.strategic_period ?? "Not set"}
                    </p>
                  )}
                </div>

                <div className="px-5 py-4">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {profile.strategic_period?.trim()
                      ? `Strategic Priorities (${profile.strategic_period.trim()})`
                      : "Strategic Priorities"}
                  </p>
                  {editing && editState ? (
                    <ChipListEditor
                      items={editState.strategic_priorities}
                      onChange={(v) => setEditState({ ...editState, strategic_priorities: v })}
                    />
                  ) : (
                    <ChipList items={profile.strategic_priorities} />
                  )}
                </div>

                <div className="px-5 py-4">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Active Academic Programs</p>
                  {editing && editState ? (
                    <ChipListEditor
                      items={editState.academic_programs}
                      onChange={(v) => setEditState({ ...editState, academic_programs: v })}
                    />
                  ) : (
                    <ChipList items={profile.academic_programs} />
                  )}
                </div>

                <div className="px-5 py-4">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Active Research Focus</p>
                  {editing && editState ? (
                    <ChipListEditor
                      items={editState.research_focus}
                      onChange={(v) => setEditState({ ...editState, research_focus: v })}
                    />
                  ) : (
                    <ChipList items={profile.research_focus} />
                  )}
                </div>
              </div>
            </div>

            {/* Budget */}
            <BudgetSection isAdmin={isAdmin} />

            {/* Knowledge Base — document blocks */}
            <div className="rounded-xl border border-white/5 bg-[#0d1117]">
              <div className="flex items-center justify-between border-b border-white/5 px-5 py-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">Knowledge Base</h3>
                  <p className="text-xs text-slate-500">Previous strategic plans uploaded for AI synthesis</p>
                </div>
                {isAdmin && (
                  <Button size="sm" className="gap-1.5 text-xs" onClick={() => setShowUpload(true)}>
                    <Upload className="h-3.5 w-3.5" />
                    Upload
                  </Button>
                )}
              </div>

              <div className="p-4 space-y-3">
                {plans.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-8 text-slate-600">
                    <FileText className="h-8 w-8" />
                    <p className="text-xs">No documents uploaded yet</p>
                  </div>
                ) : (
                  plans.map((plan) => (
                    <PlanBlock
                      key={plan.plan_id}
                      plan={plan}
                      onRetrigger={() => void loadPlans().then(setPlans)}
                    />
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
