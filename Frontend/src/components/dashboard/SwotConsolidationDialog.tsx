"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2, Play, Plus, Trash2, Pencil, Check, X, Sparkles, RefreshCw,
  ListFilter, List, ShieldCheck, Info,
  TrendingUp, TrendingDown, Target, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  startConsolidation, getJobStatus, fetchLatest, patchCandidate, deleteCandidate,
  addCandidate, approveSwot,
  type SwotCandidate, type SwotType, type SwotBranch,
} from "@/services/swotConsolidationApi";

// Top-K shown by default: 10 per pillar for internal (S/W), 10 overall per external list.
const TOP_K = 10;

const BACKEND_PILLARS: { id: number; name: string }[] = [
  { id: 1, name: "Program Mission and Management" },
  { id: 2, name: "Program Design" },
  { id: 3, name: "Teaching, Learning and Assessment" },
  { id: 4, name: "Students and Graduates" },
  { id: 5, name: "Faculty and Teaching Assistants" },
  { id: 6, name: "Resources and Learning Facilities" },
  { id: 7, name: "Quality Assurance and Program Evaluation" },
];

const TYPE_CFG: Record<SwotType, { label: string; icon: React.ElementType; color: string; bg: string; border: string; branch: SwotBranch }> = {
  strength:    { label: "Strengths",     icon: TrendingUp,    color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", branch: "internal" },
  weakness:    { label: "Weaknesses",    icon: TrendingDown,  color: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/20", branch: "internal" },
  opportunity: { label: "Opportunities", icon: Target,        color: "text-cyan-400",    bg: "bg-cyan-500/10",    border: "border-cyan-500/20", branch: "external" },
  threat:      { label: "Threats",       icon: AlertTriangle, color: "text-rose-400",    bg: "bg-rose-500/10",    border: "border-rose-500/20", branch: "external" },
};

const TYPES: SwotType[] = ["strength", "weakness", "opportunity", "threat"];

// ── Lifecycle status → badge (clear to the user what each item is) ────────────────
type Status = { label: string; cls: string; title: string };
function statusOf(c: SwotCandidate): Status {
  if ((c.factor_breakdown as { manual?: boolean })?.manual === true)
    return { label: "Manual", cls: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30", title: "You added this item manually." };
  switch (c.lifecycle_state) {
    case "persistent":
      return { label: "Persistent", cls: "bg-violet-500/15 text-violet-300 border-violet-500/30", title: "Was in the previous plan AND is still appearing now — a recurring, unresolved concern/asset." };
    case "carried_forward":
      return { label: "Carried-forward", cls: "bg-slate-500/15 text-slate-300 border-slate-500/30", title: "From the previous plan, but NO current agent signal this run. Kept for reference only — not part of the new SWOT." };
    default:
      return { label: "New", cls: "bg-sky-500/15 text-sky-300 border-sky-500/30", title: "New this run — not found in the previous plan." };
  }
}

const LEGEND: { label: string; cls: string; desc: string }[] = [
  { label: "New",            cls: "bg-sky-500/15 text-sky-300",       desc: "fresh this run, not in the old plan" },
  { label: "Persistent",     cls: "bg-violet-500/15 text-violet-300", desc: "recurs from the previous plan" },
  { label: "Carried-forward",cls: "bg-slate-500/15 text-slate-300",   desc: "old-plan concern, no current signal (reference only)" },
  { label: "Manual",         cls: "bg-cyan-500/15 text-cyan-300",     desc: "you added it" },
];

// ── Top-K selection (default view) ───────────────────────────────────────────────
function visibleFor(all: SwotCandidate[], type: SwotType, showAll: boolean): SwotCandidate[] {
  let list = all.filter((c) => c.type === type);
  if (showAll) return list.sort((a, b) => b.salience_score - a.salience_score);

  // Default view: hide carried_forward, then cap.
  list = list.filter((c) => c.lifecycle_state !== "carried_forward")
             .sort((a, b) => b.salience_score - a.salience_score);

  if (type === "strength" || type === "weakness") {
    // top-K PER PILLAR
    const byPillar = new Map<number | null, SwotCandidate[]>();
    for (const c of list) {
      const arr = byPillar.get(c.pillar_id) ?? [];
      arr.push(c); byPillar.set(c.pillar_id, arr);
    }
    const out: SwotCandidate[] = [];
    byPillar.forEach((arr) => out.push(...arr.slice(0, TOP_K)));
    return out.sort((a, b) => b.salience_score - a.salience_score);
  }
  // external: top-K of the whole list
  return list.slice(0, TOP_K);
}

export function SwotConsolidationReview() {
  const [items, setItems] = useState<SwotCandidate[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [approvedAt, setApprovedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetchLatest(true); // fetch everything (incl. carried) so the toggle is instant
      setItems(res.candidates);
      setRunId(res.consolidation_run_id);
      setApprovedAt(res.approved_at);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Fire-and-forget run + background poll — editing is never blocked by the LLM.
  const handleRun = async () => {
    setError(null);
    try { setJobId(await startConsolidation()); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to start consolidation"); }
  };
  useEffect(() => {
    if (!jobId) return;
    const t = setInterval(async () => {
      try {
        const job = await getJobStatus(jobId);
        if (job.status === "complete") { setJobId(null); await load(); }
        else if (job.status === "failed") { setJobId(null); setError(job.error ?? "Consolidation failed"); }
      } catch { /* transient */ }
    }, 5_000);
    return () => clearInterval(t);
  }, [jobId, load]);

  const mutate = (id: string, patch: Partial<SwotCandidate>) =>
    setItems((prev) => prev.map((c) => (c.candidate_id === id ? { ...c, ...patch } : c)));

  const setDecision = async (id: string, decision: "keep" | "cut") => {
    mutate(id, { reviewer_decision: decision, selected: decision === "keep" });
    try { await patchCandidate(id, { reviewer_decision: decision }); }
    catch (e) { setError(e instanceof Error ? e.message : "Update failed"); await load(); }
  };
  const saveEdit = async (id: string, description: string) => {
    mutate(id, { description });
    try { await patchCandidate(id, { description }); }
    catch (e) { setError(e instanceof Error ? e.message : "Update failed"); await load(); }
  };
  const remove = async (id: string) => {
    setItems((prev) => prev.filter((c) => c.candidate_id !== id));
    try { await deleteCandidate(id); }
    catch (e) { setError(e instanceof Error ? e.message : "Delete failed"); await load(); }
  };
  const add = async (type: SwotType, description: string, pillarId: number | null) => {
    if (!runId) return;
    const branch = TYPE_CFG[type].branch;
    const pillar = BACKEND_PILLARS.find((p) => p.id === pillarId) ?? null;
    try {
      await addCandidate({
        consolidation_run_id: runId, branch, type, description,
        pillar_id: branch === "internal" ? pillarId : null,
        pillar_name: branch === "internal" ? pillar?.name ?? null : null,
      });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Add failed"); }
  };

  const approve = async () => {
    if (!runId) return;
    setApproving(true); setError(null);
    try { const { approved_at } = await approveSwot(runId); setApprovedAt(approved_at); }
    catch (e) { setError(e instanceof Error ? e.message : "Approve failed"); }
    finally { setApproving(false); }
  };

  const keptCount = useMemo(
    () => items.filter((c) => c.lifecycle_state !== "carried_forward" && c.reviewer_decision !== "cut").length,
    [items],
  );
  const carriedCount = useMemo(() => items.filter((c) => c.lifecycle_state === "carried_forward").length, [items]);

  return (
    <div className="flex flex-col gap-4">
      {/* Title + description */}
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-100">
          <Sparkles className="h-5 w-5 text-cyan-400" /> Strategic SWOT — Review for the Plan
        </h1>
        <p className="mt-1 text-xs text-slate-500">
          The consolidated, de-duplicated SWOT the rest of the architecture (gap analysis, goals) will use.
          Ranked by salience — you are the sole filter: keep, cut, edit, delete, or add.
        </p>
      </div>

      {/* Approved banner */}
      {approvedAt && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          <span className="font-semibold">✓ This SWOT was approved</span> on {new Date(approvedAt).toLocaleString()}.
          Re-run the rest of the pipeline (gap analysis → goals) to use this approved SWOT downstream.
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
        <div className="text-xs text-slate-400">
          {runId
            ? <>{keptCount} kept · {items.filter((c) => c.lifecycle_state !== "carried_forward").length} ranked
                {carriedCount > 0 && <> · {carriedCount} carried-forward</>}</>
            : <>No consolidation run yet — generate one to build the strategic SWOT.</>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setShowAll((s) => !s)}
            className={cn("flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-all",
              showAll ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                      : "border-white/10 bg-white/5 text-slate-300 hover:border-cyan-500/30")}
            title={showAll ? "Show only the top items" : "Show every data point, including carried-forward"}>
            {showAll ? <ListFilter className="h-3.5 w-3.5" /> : <List className="h-3.5 w-3.5" />}
            {showAll ? `Top ${TOP_K}` : "Display all"}
          </button>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300 transition-all hover:border-cyan-500/30 disabled:opacity-40">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
          </button>
          <button onClick={handleRun} disabled={!!jobId}
            className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-all",
              jobId ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                    : "border-white/10 bg-white/5 text-slate-300 hover:border-cyan-500/30")}>
            {jobId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {jobId ? "Running in background…" : runId ? "Re-generate (LLM)" : "Generate (LLM)"}
          </button>
          <button onClick={approve} disabled={approving || !runId}
            className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-300 transition-all hover:bg-emerald-500/20 disabled:opacity-40">
            {approving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            Approve SWOT
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-500">
        <span className="flex items-center gap-1 text-slate-400"><Info className="h-3 w-3" /> Status:</span>
        {LEGEND.map((l) => (
          <span key={l.label} className="flex items-center gap-1">
            <span className={cn("rounded-full px-1.5 py-0.5 font-medium", l.cls)}>{l.label}</span>
            <span>{l.desc}</span>
          </span>
        ))}
      </div>

      {/* Disclaimers */}
      {showAll ? (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300/90">
          <span className="font-semibold">Display all:</span> showing every data point, including lower-salience items
          and <span className="font-semibold">carried-forward</span> concerns from the previous plan that have no current
          agent signal. These are for completeness — review carefully; carried-forward items are reference only and are
          not part of the SWOT unless you act on them.
        </div>
      ) : (
        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-400">
          Showing the <span className="font-semibold text-slate-200">top {TOP_K}</span> per pillar (Strengths/Weaknesses)
          and the top {TOP_K} overall (Opportunities/Threats). Click <span className="font-semibold text-slate-200">Display all</span> to
          see every data point.
        </div>
      )}

      {/* Background-run notice */}
      {jobId && (
        <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-300">
          Consolidation is running in the background (the LLM can take several minutes). You can keep editing below —
          the list refreshes automatically when it finishes.
        </div>
      )}

      {error && <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{error}</div>}

      {/* Body */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {TYPES.map((type) => (
            <SwotSection key={type} type={type}
              items={visibleFor(items, type, showAll)}
              onDecision={setDecision} onSaveEdit={saveEdit} onRemove={remove} onAdd={add} canAdd={!!runId} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Section (one SWOT quadrant) ──────────────────────────────────────────────────
function SwotSection({
  type, items, onDecision, onSaveEdit, onRemove, onAdd, canAdd,
}: {
  type: SwotType; items: SwotCandidate[];
  onDecision: (id: string, d: "keep" | "cut") => void;
  onSaveEdit: (id: string, desc: string) => void;
  onRemove: (id: string) => void;
  onAdd: (type: SwotType, desc: string, pillarId: number | null) => void;
  canAdd: boolean;
}) {
  const cfg = TYPE_CFG[type];
  const Icon = cfg.icon;
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [pillarId, setPillarId] = useState<number>(1);

  return (
    <div className="flex flex-col gap-2">
      <div className={cn("flex items-center gap-2 rounded-lg px-3 py-2 border", cfg.bg, cfg.border)}>
        <Icon className={cn("h-4 w-4", cfg.color)} />
        <span className={cn("text-sm font-semibold", cfg.color)}>{cfg.label}</span>
        <span className="ml-auto rounded-full bg-black/20 px-2 py-0.5 text-xs font-bold text-slate-400">{items.length}</span>
      </div>

      {items.map((c) => (
        <SwotRow key={c.candidate_id} c={c} onDecision={onDecision} onSaveEdit={onSaveEdit} onRemove={onRemove} />
      ))}

      {canAdd && (adding ? (
        <div className="rounded-lg border border-white/10 bg-white/5 p-2 flex flex-col gap-2">
          <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
            placeholder={`Add a ${type}…`} rows={2}
            className="w-full resize-none rounded-md bg-[#0d1117] px-2 py-1.5 text-xs text-slate-200 outline-none border border-white/10 focus:border-cyan-500/40" />
          {cfg.branch === "internal" && (
            <select value={pillarId} onChange={(e) => setPillarId(Number(e.target.value))}
              className="rounded-md bg-[#0d1117] px-2 py-1.5 text-xs text-slate-300 border border-white/10">
              {BACKEND_PILLARS.map((p) => <option key={p.id} value={p.id}>{p.id}. {p.name}</option>)}
            </select>
          )}
          <div className="flex items-center justify-end gap-1">
            <button onClick={() => { setAdding(false); setDraft(""); }}
              className="rounded-md px-2 py-1 text-[11px] text-slate-400 hover:bg-white/5">Cancel</button>
            <button onClick={() => { if (draft.trim()) { onAdd(type, draft.trim(), cfg.branch === "internal" ? pillarId : null); setAdding(false); setDraft(""); } }}
              className="flex items-center gap-1 rounded-md bg-cyan-500/15 px-2 py-1 text-[11px] font-medium text-cyan-300 hover:bg-cyan-500/25">
              <Check className="h-3 w-3" /> Add
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)}
          className="flex items-center justify-center gap-1 rounded-lg border border-dashed border-white/10 py-2 text-[11px] text-slate-500 hover:border-cyan-500/30 hover:text-slate-300">
          <Plus className="h-3 w-3" /> Add {type}
        </button>
      ))}
    </div>
  );
}

// ── Row (one candidate) ──────────────────────────────────────────────────────────
function SwotRow({
  c, onDecision, onSaveEdit, onRemove,
}: {
  c: SwotCandidate;
  onDecision: (id: string, d: "keep" | "cut") => void;
  onSaveEdit: (id: string, desc: string) => void;
  onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.description);
  const cut = c.reviewer_decision === "cut";
  const carried = c.lifecycle_state === "carried_forward";
  const status = statusOf(c);
  const refs = (c.factor_breakdown as { reference_count?: number })?.reference_count;

  return (
    <div className={cn("rounded-lg border p-2.5 transition-all",
      cut ? "border-white/5 bg-white/[0.02] opacity-50"
          : carried ? "border-slate-500/10 bg-white/[0.015]"
          : "border-white/10 bg-[#0d1117]")}>
      <div className="flex items-start gap-2">
        <div className="flex shrink-0 flex-col items-center gap-1 pt-0.5">
          <span className="font-mono text-[11px] font-semibold text-cyan-400">{c.salience_score.toFixed(2)}</span>
          <span className={cn("rounded border px-1 text-[8px] font-medium uppercase tracking-wide", status.cls)} title={status.title}>
            {status.label}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          {editing ? (
            <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} rows={2}
              className="w-full resize-none rounded-md bg-[#0d1117] px-2 py-1 text-xs text-slate-200 border border-cyan-500/40 outline-none" />
          ) : (
            <p className={cn("text-xs leading-relaxed", cut ? "text-slate-500 line-through" : carried ? "text-slate-400" : "text-slate-200")}>
              {c.description}
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {c.pillar_name && <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] text-slate-500">{c.pillar_name}</span>}
            {(c.factor_breakdown?.distinct_agents as string[] | undefined)?.map((a) => (
              <span key={a} className="rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] text-slate-600">{a}</span>
            ))}
            {typeof refs === "number" && (
              <span className="rounded-full bg-cyan-500/10 px-1.5 py-0.5 text-[9px] text-cyan-400">{refs} refs</span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {editing ? (
            <>
              <button onClick={() => { onSaveEdit(c.candidate_id, draft.trim()); setEditing(false); }}
                className="rounded p-1 text-emerald-400 hover:bg-emerald-500/10" title="Save"><Check className="h-3.5 w-3.5" /></button>
              <button onClick={() => { setDraft(c.description); setEditing(false); }}
                className="rounded p-1 text-slate-500 hover:bg-white/5" title="Cancel"><X className="h-3.5 w-3.5" /></button>
            </>
          ) : (
            <>
              {!carried && (
                <button onClick={() => onDecision(c.candidate_id, cut ? "keep" : "cut")}
                  className={cn("rounded px-1.5 py-1 text-[10px] font-medium", cut ? "text-emerald-400 hover:bg-emerald-500/10" : "text-rose-400 hover:bg-rose-500/10")}
                  title={cut ? "Keep" : "Cut"}>
                  {cut ? "Keep" : "Cut"}
                </button>
              )}
              <button onClick={() => setEditing(true)} className="rounded p-1 text-slate-500 hover:bg-white/5" title="Edit"><Pencil className="h-3 w-3" /></button>
              <button onClick={() => onRemove(c.candidate_id)} className="rounded p-1 text-slate-500 hover:bg-rose-500/10 hover:text-rose-400" title="Delete"><Trash2 className="h-3 w-3" /></button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
