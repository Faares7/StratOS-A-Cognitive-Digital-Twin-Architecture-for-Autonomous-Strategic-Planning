"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  ListChecks,
  Loader2,
  Sparkles,
  Info,
  Clock,
  Wallet,
  AlertTriangle,
  CheckCircle2,
  Target,
  Download,
  Pencil,
  Save,
  X,
  RotateCcw,
  SlidersHorizontal,
  ShieldCheck,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ── Backend contract ────────────────────────────────────────────────────────────
const BACKEND = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
const POLL_INTERVAL_MS = 5_000;
// Gemini 3.1 Pro (reasoning) × one call per objective is slow — keep generous.
// The job continues server-side regardless; this only bounds the page's polling.
const POLL_TIMEOUT_MS = 900_000; // 15 min

// Controlled vocabularies — must mirror the backend (action_planner.py).
const ROLE_VOCAB = [
  "Dean of ITCS", "Vice Dean of Undergraduate Programs", "Vice Dean of Postgraduate Studies",
  "Program Director", "Quality Assurance Unit", "ITCS Council", "Research Center",
  "IT Department", "Student Affairs",
];
const ARCHETYPE_KEYS = [
  "faculty_training_workshop", "student_outreach_campaign", "scholarship_financial_aid",
  "academic_event_conference", "international_mou_partnership", "marketing_branding",
  "accreditation_quality_prep", "software_license_tier_1", "software_license_tier_2",
  "lab_hardware_upgrade", "infrastructure_facility", "curriculum_program_development",
  "survey_assessment_study", "faculty_recruitment", "student_support_service",
  "it_system_deployment", "administrative_routine", "general_initiative",
];
const QUARTERS: string[] = [];
for (const y of [2026, 2027, 2028, 2029]) for (const q of [1, 2, 3, 4]) QUARTERS.push(`Q${q} ${y}`);

// ── Types ────────────────────────────────────────────────────────────────────────
interface ActionItem {
  action_id: string;
  activity_rationale: string; activity_text: string; kpi_name: string;
  timeline_reasoning: string; start_quarter: string; end_quarter: string;
  responsible_exec: string; responsible_monitor: string;
  classification_reasoning: string; assigned_archetype: string;
  relative_cost_weight: number | null;
  inflated_cost_egp: number;  // = allocated EGP (top-down distribution); user-editable
  cost_explanation: string; budget_display: string; edited_by_user: boolean;
}
interface Objective {
  objective_id: string; text: string; tows_type: string | null;
  pillar_id: number | null; pillar_name: string | null; actions: ActionItem[];
}
interface Goal { goal_id: string; title: string; description: string; objectives: Objective[]; }

// Top-down budget types
interface PillarRow {
  pillar_id: number; pillar_name: string;
  allocated_egp: number; assigned_egp: number;
  num_items: number; within_allocation: boolean;
}
interface CashFlowYear { year: number; assigned_egp: number; }
interface BudgetSummary {
  pillars: PillarRow[];
  total_budget_egp: number;
  total_allocated_egp: number;
  total_assigned_egp: number;
  unallocated_egp: number;
  cashflow_by_year: CashFlowYear[];
  warnings: string[];
}

interface ActionPlan { run_id: string; generated: boolean; goals: Goal[]; budget_summary: BudgetSummary | null; totals: { goals: number; objectives: number; actions: number }; }
interface RunMeta { run_id: string; plan_status: string | null; created_at: string | null; goals: number; objectives: number; has_action_plan: boolean; }
interface ArchetypeMeta { key: string; label: string; description: string; base_cost_egp: number | null; cost_driver: string | null; funding_source: string | null; }
interface JobProgress { processed: number; total: number; stage?: string; }

type Phase = "idle" | "generating" | "loaded" | "empty" | "error";

const TOWS_VARIANT: Record<string, string> = { SO: "opportunity", ST: "strength", WO: "weakness", WT: "threat" };
const fmt = (n: number) => `${Math.round(n).toLocaleString()} EGP`;
const archLabel = (k: string) => k.replace(/_/g, " ");

// ── Run picker ───────────────────────────────────────────────────────────────────
const isFinalRun = (r: RunMeta) => r.plan_status === "final";

// Single row rendered both inside the dropdown and (via SelectValue) in the trigger.
function RunRow({ r }: { r: RunMeta }) {
  const final = isFinalRun(r);
  return (
    <span className="flex items-center gap-2">
      <span className={cn("font-mono", final ? "text-slate-200" : "text-slate-500")}>{r.run_id.slice(0, 8)}</span>
      <span
        className={cn(
          "rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
          final ? "bg-emerald-500/15 text-emerald-400" : "bg-white/5 text-slate-500"
        )}
      >
        {final ? "Final" : "Draft"}
      </span>
      <span className={cn(final ? "text-slate-400" : "text-slate-600")}>{r.objectives} obj</span>
      {r.created_at && <span className="text-slate-600">{new Date(r.created_at).toLocaleDateString()}</span>}
      {r.has_action_plan && <span className="text-emerald-400/70">✓ plan</span>}
    </span>
  );
}

function RunPicker({ runs, value, onChange, disabled }: { runs: RunMeta[]; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const finals = runs.filter(isFinalRun);
  const drafts = runs.filter((r) => !isFinalRun(r));
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="w-full text-xs">
        <SelectValue placeholder="Select a strategy run…" />
      </SelectTrigger>
      <SelectContent>
        {runs.length === 0 && <div className="px-2 py-1.5 text-xs text-slate-500">No runs with objectives found</div>}

        {finals.length > 0 && (
          <>
            <div className="flex items-center gap-1.5 px-2 py-1 text-[9px] font-semibold uppercase tracking-widest text-emerald-500/80">
              <ShieldCheck className="h-3 w-3" /> Approved Plan
            </div>
            {finals.map((r) => (
              <SelectItem key={r.run_id} value={r.run_id} className="text-xs">
                <RunRow r={r} />
              </SelectItem>
            ))}
          </>
        )}

        {drafts.length > 0 && (
          <>
            {finals.length > 0 && <div className="my-1 h-px bg-white/5" />}
            <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-widest text-slate-600">
              Version History · Drafts
            </div>
            {drafts.map((r) => (
              <SelectItem key={r.run_id} value={r.run_id} className="text-xs opacity-80">
                <RunRow r={r} />
              </SelectItem>
            ))}
          </>
        )}
      </SelectContent>
    </Select>
  );
}

// ── Reasoning popover (click to reveal) ──────────────────────────────────────────
function WhyPopover({ title, sections, align = "left" }: { title: string; sections: { label?: string; text: string }[]; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex">
      <button type="button" onClick={() => setOpen((o) => !o)} title="Show reasoning"
        className={cn("ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-colors",
          open ? "bg-cyan-500/20 text-cyan-300" : "text-slate-500 hover:bg-white/10 hover:text-cyan-400")}>
        <Info className="h-3 w-3" />
      </button>
      {open && (
        <div className={cn("absolute top-full z-50 mt-1.5 w-72 rounded-lg border border-cyan-500/20 bg-[#0d1117] p-3 text-left shadow-xl shadow-black/40 animate-fade-in",
          align === "right" ? "right-0" : "left-0")}>
          <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-400">
            <Sparkles className="h-3 w-3" /> {title}
          </p>
          <div className="space-y-2">
            {sections.map((s, i) => (
              <div key={i}>
                {s.label && <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{s.label}</p>}
                <p className="text-xs leading-relaxed text-slate-300">{s.text || "—"}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}

// ── Budget header (top-down pillar allocation view) ───────────────────────────────
function BudgetHeader({ summary, totals }: { summary: BudgetSummary; totals: ActionPlan["totals"] }) {
  const activePillars = summary.pillars.filter((p) => p.num_items > 0);
  return (
    <div className="rounded-xl border border-cyan-500/15 bg-gradient-to-br from-cyan-500/[0.07] to-transparent p-5 animate-fade-in space-y-4">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/15">
            <Wallet className="h-5 w-5 text-cyan-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Budget Allocation</h3>
            <p className="text-xs text-slate-500">
              {totals.goals} goals · {totals.objectives} objectives · {totals.actions} activities
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="live" className="px-3 py-1">Total {fmt(summary.total_budget_egp)}</Badge>
          <Badge variant="mock" className="px-3 py-1">Assigned {fmt(summary.total_assigned_egp)}</Badge>
          {summary.unallocated_egp > 0 && (
            <Badge variant="default" className="px-3 py-1 text-slate-400">
              Unspent {fmt(summary.unallocated_egp)}
            </Badge>
          )}
        </div>
      </div>

      {/* Per-pillar progress bars */}
      {activePillars.length > 0 && (
        <div className="space-y-2">
          {activePillars.map((p) => {
            const pct = p.allocated_egp > 0
              ? Math.min(100, (p.assigned_egp / p.allocated_egp) * 100)
              : 0;
            return (
              <div key={p.pillar_id} className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#b8922f]/30 text-[10px] font-bold text-[#b8922f]">
                      {p.pillar_id}
                    </span>
                    <span className="truncate text-xs font-medium text-slate-200">{p.pillar_name}</span>
                    <span className="text-[10px] text-slate-600">{p.num_items} items</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-slate-300">{fmt(p.assigned_egp)}</span>
                    <span className="text-[10px] text-slate-500">/ {fmt(p.allocated_egp)}</span>
                    {p.within_allocation
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      : <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />}
                  </div>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
                  <div
                    className={cn("h-full rounded-full transition-all", p.within_allocation ? "bg-cyan-500" : "bg-rose-400")}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Year-by-year cash-flow (scheduling view, no inflation) */}
      {summary.cashflow_by_year.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {summary.cashflow_by_year.map((y) => (
            <div key={y.year} className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2.5">
              <span className="text-xs font-semibold text-slate-300">{y.year}</span>
              <p className="mt-1 text-sm font-medium text-slate-200">{fmt(y.assigned_egp)}</p>
              <p className="text-[10px] text-slate-500">cash out</p>
            </div>
          ))}
        </div>
      )}

      {summary.warnings.length > 0 && (
        <div className="space-y-1">
          {summary.warnings.map((w, i) => (
            <p key={i} className="flex items-start gap-1.5 text-xs text-rose-300">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Small labelled select for the edit form ──────────────────────────────────────
function FieldSelect({ label, value, options, onChange, fmtOpt }: { label: string; value: string; options: string[]; onChange: (v: string) => void; fmtOpt?: (o: string) => string }) {
  return (
    <div className="space-y-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o} value={o} className="text-xs">{fmtOpt ? fmtOpt(o) : o}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

// ── Action card (view + inline edit) ─────────────────────────────────────────────
function ActionCard({ a, index, onChanged, roles, archetypes }: { a: ActionItem; index: number; onChanged: () => Promise<void>; roles: string[]; archetypes: ArchetypeMeta[] }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Vocab for the edit dropdowns — from /vocab, with hardcoded fallback.
  const roleOptions    = roles.length ? roles : ROLE_VOCAB;
  const archetypeKeys  = archetypes.length ? archetypes.map((x) => x.key) : ARCHETYPE_KEYS;
  const archLabelMap: Record<string, string> = {};
  for (const x of archetypes) archLabelMap[x.key] = x.label || archLabel(x.key);
  const fmtArch = (k: string) => archLabelMap[k] || archLabel(k);

  // edit form state
  const [activity, setActivity] = useState(a.activity_text);
  const [kpi,      setKpi]      = useState(a.kpi_name);
  const [startQ,   setStartQ]   = useState(a.start_quarter);
  const [endQ,     setEndQ]     = useState(a.end_quarter);
  const [exec,     setExec]     = useState(a.responsible_exec);
  const [monitor,  setMonitor]  = useState(a.responsible_monitor);
  const [archetype, setArchetype] = useState(a.assigned_archetype);
  const [cost,     setCost]     = useState(String(Math.round(a.inflated_cost_egp)));

  const beginEdit = () => {
    setActivity(a.activity_text); setKpi(a.kpi_name); setStartQ(a.start_quarter); setEndQ(a.end_quarter);
    setExec(a.responsible_exec); setMonitor(a.responsible_monitor); setArchetype(a.assigned_archetype);
    setCost(String(Math.round(a.inflated_cost_egp))); setErr(null); setEditing(true);
  };

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`${BACKEND}/api/action-plan/action/${a.action_id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activity_text:     activity,
          kpi_name:          kpi,
          start_quarter:     startQ,
          end_quarter:       endQ,
          responsible_exec:  exec,
          responsible_monitor: monitor,
          assigned_archetype: archetype,
          inflated_cost_egp: cost ? Number(cost) : undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.detail || `Save failed (${res.status})`);
      setEditing(false);
      await onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : "Save failed."); } finally { setBusy(false); }
  };

  const reset = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`${BACKEND}/api/action-plan/action/${a.action_id}/reset`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.detail || `Reset failed (${res.status})`);
      await onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : "Reset failed."); } finally { setBusy(false); }
  };

  // ── Edit mode ──────────────────────────────────────────────────────────────────
  if (editing) {
    return (
      <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/[0.03] p-4 space-y-2.5">
        <textarea value={activity} onChange={(e) => setActivity(e.target.value)} rows={2}
          className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500/40 focus:outline-none" placeholder="Activity…" />
        <input value={kpi} onChange={(e) => setKpi(e.target.value)}
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 focus:border-cyan-500/40 focus:outline-none" placeholder="KPI…" />
        <div className="grid grid-cols-2 gap-2.5">
          <FieldSelect label="Start" value={startQ} options={QUARTERS} onChange={setStartQ} />
          <FieldSelect label="End"   value={endQ}   options={QUARTERS} onChange={setEndQ} />
          <FieldSelect label="Exec owner"    value={exec}    options={roleOptions} onChange={setExec} />
          <FieldSelect label="Monitor owner" value={monitor} options={roleOptions} onChange={setMonitor} />
          <FieldSelect label="Category (reporting)" value={archetype} options={archetypeKeys} onChange={setArchetype} fmtOpt={fmtArch} />
          {/* Direct cost input — top-down model: user sets the number */}
          <div className="space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Cost (EGP)</span>
            <input
              type="text"
              inputMode="numeric"
              value={cost}
              onChange={(e) => setCost(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="0"
              className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-slate-200 outline-none focus:border-cyan-500/40"
            />
          </div>
        </div>
        <p className="text-[10px] text-slate-500">
          Cost is user-adjustable. Category is for reporting only — it no longer drives the budget.
        </p>
        {err && <p className="text-xs text-rose-400">{err}</p>}
        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={busy} className="h-8 gap-1.5 text-xs">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
          </Button>
          <Button variant="outline" onClick={() => setEditing(false)} disabled={busy} className="h-8 gap-1.5 text-xs">
            <X className="h-3.5 w-3.5" /> Cancel
          </Button>
        </div>
      </div>
    );
  }

  // ── View mode ───────────────────────────────────────────────────────────────────
  return (
    <div className="group rounded-xl border border-white/5 bg-white/[0.02] p-4 transition-colors hover:border-cyan-500/20">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-cyan-500/10 text-[11px] font-bold text-cyan-400">{index}</span>
        <div className="flex-1">
          <p className="inline text-sm font-medium leading-relaxed text-slate-100">{a.activity_text}</p>
          <WhyPopover title="Why this activity & KPI" sections={[{ text: a.activity_rationale }]} />
        </div>
        {/* toolbar */}
        <div className="flex shrink-0 items-center gap-1.5">
          {a.edited_by_user && <Badge variant="new" className="px-1.5 py-0 text-[9px]">Edited</Badge>}
          {a.edited_by_user && (
            <button onClick={reset} disabled={busy} title="Reset to AI suggestion"
              className="flex h-6 w-6 items-center justify-center rounded text-slate-500 transition-colors hover:bg-amber-500/10 hover:text-amber-400">
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
            </button>
          )}
          <button onClick={beginEdit} title="Edit"
            className="flex h-6 w-6 items-center justify-center rounded text-slate-500 opacity-0 transition-all hover:bg-cyan-500/10 hover:text-cyan-400 group-hover:opacity-100">
            <Pencil className="h-3 w-3" />
          </button>
        </div>
      </div>

      <p className="mt-2 ml-7 text-[13px] text-slate-400">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">KPI · </span>{a.kpi_name}
      </p>

      <div className="mt-3 ml-7 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-md border border-blue-500/20 bg-blue-500/10 px-2 py-1 text-[11px] font-medium text-blue-300">
          <Clock className="mr-1.5 h-3 w-3" />{a.start_quarter} → {a.end_quarter}
          <WhyPopover title="Why this timeline" sections={[{ text: a.timeline_reasoning }]} />
        </span>
        <span className="inline-flex items-center rounded-md border border-violet-500/20 bg-violet-500/10 px-2 py-1 text-[11px] font-medium text-violet-300">Exec: {a.responsible_exec}</span>
        <span className="inline-flex items-center rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-300">Monitor: {a.responsible_monitor}</span>
        <span className="inline-flex items-center rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-300">
          <Wallet className="mr-1.5 h-3 w-3" />{a.budget_display}
          <WhyPopover title="Budget allocation" align="right"
            sections={[
              { label: "Category", text: archLabel(a.assigned_archetype) },
              { label: "Allocation", text: a.cost_explanation },
              { label: "Reasoning", text: a.classification_reasoning },
            ]} />
        </span>
      </div>
    </div>
  );
}

function ObjectiveBlock({ obj, onChanged, roles, archetypes }: { obj: Objective; onChanged: () => Promise<void>; roles: string[]; archetypes: ArchetypeMeta[] }) {
  const tows = (obj.tows_type || "").toUpperCase();
  return (
    <div className="rounded-xl border border-white/5 bg-[#0d1117] p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="flex-1 text-sm font-semibold text-slate-200">{obj.text}</p>
        <div className="flex shrink-0 items-center gap-1.5">
          {tows && <Badge variant={(TOWS_VARIANT[tows] as any) || "default"} className="px-2 py-0.5 text-[10px]">{tows}</Badge>}
          {obj.pillar_name && <Badge variant="mock" className="px-2 py-0.5 text-[10px]" title={obj.pillar_name}>P{obj.pillar_id}</Badge>}
        </div>
      </div>
      <div className="space-y-3">
        {obj.actions.map((a, i) => <ActionCard key={a.action_id} a={a} index={i + 1} onChanged={onChanged} roles={roles} archetypes={archetypes} />)}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────────
export default function ActionPlanPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [runId, setRunId] = useState("");
  const [allowDraft, setAllowDraft] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [plan, setPlan] = useState<ActionPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [runs, setRuns] = useState<RunMeta[]>([]);
  const [roles, setRoles] = useState<string[]>(ROLE_VOCAB);
  const [archetypes, setArchetypes] = useState<ArchetypeMeta[]>([]);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const runRef = useRef(0);

  async function loadRuns() {
    try { const d = await (await fetch(`${BACKEND}/api/action-plan/runs`)).json(); setRuns(d.runs || []); } catch { /* ignore */ }
  }
  useEffect(() => { loadRuns(); }, []);

  // Auto-select the canonical run on load: latest 'final' plan, else newest draft.
  // (runs arrive newest-first from the backend.) Only fires while nothing is chosen.
  useEffect(() => {
    if (runId || runs.length === 0) return;
    const preferred = runs.find((r) => r.plan_status === "final") ?? runs[0];
    if (preferred) setRunId(preferred.run_id);
  }, [runs, runId]);
  useEffect(() => {
    fetch(`${BACKEND}/api/action-plan/vocab`).then((r) => r.json()).then((d) => {
      if (d.roles?.length) setRoles(d.roles);
      if (d.archetypes?.length) setArchetypes(d.archetypes);
    }).catch(() => { /* fall back to hardcoded vocab */ });
  }, []);
  const selectedRun = runs.find((r) => r.run_id === runId) || null;

  useEffect(() => {
    if (phase !== "generating") return;
    const start = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, [phase]);

  async function fetchPlan(id: string): Promise<ActionPlan> {
    const res = await fetch(`${BACKEND}/api/action-plan/${id}`);
    if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
    return res.json();
  }

  // Re-fetch after an edit/reset so the cards AND budget summary stay in sync.
  async function refetch() {
    if (!plan) return;
    try { setPlan(await fetchPlan(plan.run_id)); } catch (e) { setError(e instanceof Error ? e.message : "Refresh failed."); }
  }

  async function handleLoad() {
    if (!runId.trim()) return setError("Select a run first.");
    setError(null);
    try {
      const data = await fetchPlan(runId.trim());
      if (!data.generated) { setPlan(null); setPhase("empty"); }
      else { setPlan(data); setPhase("loaded"); }
    } catch (e) { setError(e instanceof Error ? e.message : "Load failed."); setPhase("error"); }
  }

  async function handleGenerate() {
    if (!runId.trim()) return setError("Select a run first.");
    const myRun = ++runRef.current;
    setPhase("generating"); setError(null); setPlan(null); setProgress(null);
    try {
      const runRes = await fetch(`${BACKEND}/api/action-plan`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_id: runId.trim(), require_final: !allowDraft }),
      });
      if (!runRes.ok) throw new Error(`Backend error ${runRes.status} — is the API running on ${BACKEND}?`);
      const { job_id } = (await runRes.json()) as { job_id: string };
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      const poll = async (): Promise<void> => {
        if (myRun !== runRef.current) return;
        if (Date.now() > deadline)
          throw new Error("Still generating after 15 minutes — the job keeps running on the server. Wait a moment, then click Load to fetch the finished plan.");
        const jr = await fetch(`${BACKEND}/api/jobs/${job_id}`);
        const job = (await jr.json()) as { status: string; error?: string; progress?: JobProgress };
        if (myRun === runRef.current && job.progress) setProgress(job.progress);
        if (job.status === "complete") {
          const data = await fetchPlan(runId.trim());
          if (myRun !== runRef.current) return;
          setPlan(data); setPhase(data.generated ? "loaded" : "empty");
          loadRuns(); // refresh the ✓ plan flags in the picker
        } else if (job.status === "failed") { throw new Error(job.error ?? "Generation failed."); }
        else { await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS)); await poll(); }
      };
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      await poll();
    } catch (e) {
      if (myRun !== runRef.current) return;
      setError(e instanceof Error ? e.message : "Unknown error."); setPhase("error");
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <Header title="Action Plan" subtitle="الخطة التنفيذية — operational activities, schedule, owners & budget" />

      <div className="flex flex-col gap-5 p-6">
        {/* Config bar */}
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-white/5 bg-[#0d1117] p-4">
          <div className="flex-1 min-w-[280px] space-y-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Strategy Run</span>
            <RunPicker runs={runs} value={runId} onChange={setRunId} disabled={phase === "generating"} />
          </div>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 pb-2.5 text-[11px] transition-colors",
              showAdvanced ? "text-slate-300" : "text-slate-600 hover:text-slate-400"
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" /> Advanced
          </button>
          <Button variant="outline" onClick={handleLoad} disabled={phase === "generating" || !runId} className="gap-2"><Download className="h-4 w-4" /> Load</Button>
          <Button onClick={handleGenerate} disabled={phase === "generating" || !runId} className="gap-2 font-semibold">
            {phase === "generating" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {phase === "generating" ? "Generating…" : "Generate"}
          </Button>

          {showAdvanced && (
            <div className="w-full rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2.5 animate-fade-in">
              <label className="flex items-center gap-2 text-xs text-slate-400">
                <input type="checkbox" checked={allowDraft} onChange={(e) => setAllowDraft(e.target.checked)} disabled={phase === "generating"} className="h-3.5 w-3.5 accent-cyan-500" />
                Allow draft — skip the <code className="text-slate-500">plan_status=final</code> approval gate
              </label>
              <p className="mt-1 pl-6 text-[10px] text-slate-600">
                Dev/testing only. By default the action plan is built from an <span className="text-emerald-400/70">approved (final)</span> strategy run.
              </p>
            </div>
          )}

          {selectedRun && phase !== "generating" && (
            <p className={cn("w-full text-[11px]", selectedRun.has_action_plan ? "text-emerald-400/80" : "text-amber-400/80")}>
              {selectedRun.has_action_plan
                ? "This run already has a plan — click Load to view it, or Generate to rebuild it."
                : "No action plan for this run yet — click Generate (takes a few minutes; the page polls until it's ready)."}
            </p>
          )}
        </div>

        {error && <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300"><span className="font-semibold">Error: </span>{error}</div>}

        {phase === "generating" && (
          <div className="flex flex-col gap-4 rounded-xl border border-white/5 bg-[#0d1117] p-6 animate-fade-in">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />
              <div>
                <p className="text-sm font-semibold text-slate-200">Generating the action plan with Gemini 3.1 Pro…</p>
                <p className="text-xs text-slate-500">One reasoning call per objective — this can take a few minutes. Keep this page open.</p>
              </div>
            </div>
            {progress && progress.total > 0 && (
              <div className="space-y-1.5">
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
                  <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-500"
                    style={{ width: `${Math.round((progress.processed / progress.total) * 100)}%` }} />
                </div>
                <p className="text-xs font-medium text-slate-300">
                  Objective {progress.processed} of {progress.total} · {Math.round((progress.processed / progress.total) * 100)}% complete
                </p>
              </div>
            )}
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {elapsed}s elapsed</span>
              <span>{progress ? `${progress.processed}/${progress.total} objectives` : "Polling every 5s…"}</span>
            </div>
            <div className="space-y-3 pt-1">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-24 rounded-xl" style={{ animationDelay: `${i * 0.12}s` }} />)}</div>
          </div>
        )}

        {phase === "empty" && (
          <div className="flex min-h-[300px] items-center justify-center rounded-xl border border-dashed border-white/10 bg-[#0d1117]">
            <div className="max-w-sm text-center">
              <Target className="mx-auto mb-3 h-8 w-8 text-slate-600" />
              <p className="text-sm font-semibold text-slate-300">No action plan for this run yet</p>
              <p className="mt-1 text-xs text-slate-600">Click <span className="text-slate-400">Generate</span> to build one from its goals & objectives.</p>
            </div>
          </div>
        )}

        {phase === "idle" && (
          <div className="flex min-h-[300px] items-center justify-center rounded-xl border border-dashed border-white/10 bg-[#0d1117]">
            <div className="max-w-sm text-center">
              <ListChecks className="mx-auto mb-3 h-8 w-8 text-cyan-400" />
              <p className="text-sm font-semibold text-slate-300">Operational Action Plan</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Pick a strategy run above, then Load an existing plan or Generate a new one. Click the <Info className="inline h-3 w-3 text-cyan-400" /> on any
                field for the AI's reasoning, or the <Pencil className="inline h-3 w-3 text-cyan-400" /> to edit (the budget re-prices automatically).
              </p>
            </div>
          </div>
        )}

        {phase === "loaded" && plan && plan.budget_summary && (
          <>
            <BudgetHeader summary={plan.budget_summary} totals={plan.totals} />
            {plan.goals.map((g) => (
              <div key={g.goal_id} className="animate-fade-in">
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10"><Target className="h-4 w-4 text-cyan-400" /></div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-100">{g.title}</p>
                    {g.description && <p className="truncate text-[11px] text-slate-500">{g.description}</p>}
                  </div>
                  <Badge variant="mock" className="ml-auto shrink-0">{g.objectives.length} obj</Badge>
                </div>
                <div className="space-y-4 border-l border-white/5 pl-4">
                  {g.objectives.map((o) => <ObjectiveBlock key={o.objective_id} obj={o} onChanged={refetch} roles={roles} archetypes={archetypes} />)}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
