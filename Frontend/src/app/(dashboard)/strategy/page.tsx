"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Header } from "@/components/layout/Header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  addGoal,
  addObjective,
  approvePlan,
  checkFeasibility,
  deleteGoal,
  deleteObjective,
  fetchPlan,
  patchGoal,
  patchObjective,
  pollStrategy,
  reorderGoals,
  reorderObjectives,
  runStrategy,
} from "@/services/strategyApi";
import type {
  AlignmentType,
  FeasibilityResult,
  StrategyGoal,
  StrategyObjective,
  StrategyPlan,
  StrategyProgress,
  StrategyStation,
  SwotSourceItem,
  TowsType,
} from "@/types";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Gauge,
  GitBranch,
  GripVertical,
  Loader2,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

type FeasTarget = {
  kind: "goal" | "objective";
  text: string;
  goalId?: string;
  objectiveId?: string;
};

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase = "idle" | "running" | "editing" | "error";

// ── Helpers ───────────────────────────────────────────────────────────────────

function towsBadgeVariant(t: TowsType) {
  return t === "SO"
    ? "strength"
    : t === "WO"
    ? "weakness"
    : t === "ST"
    ? "threat"
    : "opportunity";
}

function alignmentColor(a: AlignmentType) {
  return a === "indicator"
    ? "text-emerald-400"
    : a === "pillar_only"
    ? "text-amber-400"
    : "text-slate-400";
}

function alignmentLabel(a: AlignmentType) {
  return a === "indicator"
    ? "Indicator"
    : a === "pillar_only"
    ? "Pillar only"
    : "Beyond standards";
}

function swotTypeColor(t: SwotSourceItem["type"]) {
  return t === "strength"
    ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
    : t === "weakness"
    ? "border-amber-500/30 bg-amber-500/5 text-amber-300"
    : t === "opportunity"
    ? "border-cyan-500/30 bg-cyan-500/5 text-cyan-300"
    : "border-rose-500/30 bg-rose-500/5 text-rose-300";
}

// ── Sub-components ────────────────────────────────────────────────────────────

// Station row used in the running phase
function StationRow({ station }: { station: StrategyStation }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <div className="mt-0.5 shrink-0">
        {station.status === "done" && (
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
        )}
        {station.status === "active" && (
          <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
        )}
        {station.status === "pending" && (
          <Circle className="h-4 w-4 text-white/15" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <span
          className={cn(
            "text-sm font-medium",
            station.status === "done"   && "text-slate-200",
            station.status === "active" && "text-cyan-400",
            station.status === "pending"&& "text-slate-600",
          )}
        >
          {station.label}
        </span>
        {station.detail && (
          <span className="ml-2 text-xs text-slate-500">{station.detail}</span>
        )}
      </div>
    </div>
  );
}

// Right-side provenance drawer
function ProvenanceDrawer({
  objective,
  onClose,
}: {
  objective: StrategyObjective | null;
  onClose: () => void;
}) {
  // A merged objective can have MANY source items and MANY indicators.
  const sourceItems = objective?.source_items ?? [];
  const orderedItems = [
    ...sourceItems.filter((i) => ["strength", "weakness"].includes(i.type)),
    ...sourceItems.filter((i) => ["opportunity", "threat"].includes(i.type)),
  ];
  const towsList =
    objective?.tows_types && objective.tows_types.length > 0
      ? objective.tows_types
      : objective
      ? [objective.tows_type]
      : [];
  // Prefer the full indicators array; fall back to the single primary (legacy rows).
  const indicators =
    objective?.indicators && objective.indicators.length > 0
      ? objective.indicators
      : objective?.indicator_title
      ? [
          {
            indicator_id: objective.grounded_indicator_id,
            grounding_score: objective.grounding_score,
            indicator_title: objective.indicator_title,
            indicator_text: objective.indicator_text,
          },
        ]
      : [];

  return (
    <DialogPrimitive.Root
      open={!!objective}
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[500px] flex-col border-l border-white/8 bg-[#080a16] shadow-2xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right duration-300 overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-cyan-400" />
              <span className="text-sm font-semibold text-slate-100">
                Objective Provenance
              </span>
            </div>
            <DialogPrimitive.Close asChild>
              <button className="rounded-md p-1 text-slate-500 transition-colors hover:text-slate-300">
                <X className="h-4 w-4" />
              </button>
            </DialogPrimitive.Close>
          </div>

          {objective && (
            <div className="flex flex-col gap-5 p-5">
              {/* Objective text */}
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  Objective
                </p>
                <p className="text-sm leading-relaxed text-slate-200">
                  {objective.text}
                </p>
              </div>

              {/* TOWS pair metadata */}
              <div className="flex flex-wrap gap-2">
                {towsList.map((t) => (
                  <Badge key={t} variant={towsBadgeVariant(t)}>
                    {t}
                  </Badge>
                ))}
                {objective.grounding_score != null && (
                  <Badge variant="default" className="tabular-nums">
                    score {objective.grounding_score.toFixed(2)}
                  </Badge>
                )}
                <span
                  className={cn(
                    "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
                    objective.alignment === "indicator"
                      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                      : objective.alignment === "pillar_only"
                      ? "border-amber-500/20 bg-amber-500/10 text-amber-400"
                      : "border-slate-500/20 bg-slate-500/10 text-slate-400",
                  )}
                >
                  {alignmentLabel(objective.alignment)}
                </span>
              </div>

              {/* Source SWOT items (all of them — a merged objective has many) */}
              {orderedItems.length > 0 && (
                <div>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                    Source SWOT Items ({orderedItems.length})
                  </p>
                  <div className="space-y-2">
                    {orderedItems.map((item) => (
                      <div
                        key={item.item_id}
                        className={cn(
                          "rounded-lg border p-3 text-xs",
                          swotTypeColor(item.type),
                        )}
                      >
                        <span className="mb-1 block font-semibold capitalize">
                          {item.type}
                          {item.pillar_name && (
                            <span className="ml-1 font-normal opacity-70">
                              · {item.pillar_name}
                            </span>
                          )}
                        </span>
                        {item.title && (
                          <p className="mb-0.5 font-medium">{item.title}</p>
                        )}
                        <p className="leading-relaxed opacity-80">
                          {item.description}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* NAQAAE indicator grounding — every indicator this objective traces to */}
              <div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  NAQAAE Grounding
                  {indicators.length > 1 && (
                    <span className="ml-1 font-normal normal-case text-slate-500">
                      · {indicators.length} indicators
                    </span>
                  )}
                </p>
                {indicators.length > 0 ? (
                  <div className="space-y-2">
                    {indicators.map((ind, i) => (
                      <div
                        key={ind.indicator_id ?? i}
                        className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3"
                      >
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-emerald-400">
                            {ind.indicator_title ?? ind.indicator_id ?? "Indicator"}
                          </p>
                          {ind.grounding_score != null && (
                            <span className="shrink-0 text-[10px] tabular-nums text-emerald-500/70">
                              {ind.grounding_score.toFixed(2)}
                            </span>
                          )}
                        </div>
                        {ind.indicator_text && (
                          <p className="text-xs leading-relaxed text-slate-400">
                            {ind.indicator_text}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : objective.alignment === "pillar_only" ? (
                  <p className="text-xs text-slate-500">
                    Aligned to the pillar standard — no specific indicator
                    reached the similarity threshold.
                  </p>
                ) : (
                  <p className="text-xs text-slate-500">
                    Beyond NAQAAE standards — strategic direction goes beyond
                    the programmatic indicators.
                  </p>
                )}
              </div>

              {/* Improvement backbone (WO / WT) */}
              {objective.improvement_source && (
                <div>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                    Improvement Backbone
                  </p>
                  <div className="rounded-lg border border-white/8 bg-white/3 p-3">
                    <p className="text-xs leading-relaxed text-slate-400">
                      {objective.improvement_source}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// Feasibility check drawer (HITL) — runs the preview and shows verdict + evidence
function FeasibilityDrawer({
  target,
  runId,
  onClose,
  onVerdict,
}: {
  target: FeasTarget | null;
  runId: string | undefined;
  onClose: () => void;
  onVerdict: (target: FeasTarget, result: FeasibilityResult) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState<FeasibilityResult | null>(null);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!target || !runId) {
      setResult(null); setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true); setResult(null); setError(null);
    checkFeasibility(target.kind, runId, target.text, {
      goalId: target.goalId,
      objectiveId: target.objectiveId,
    })
      .then((r) => {
        if (cancelled) return;
        setResult(r);
        onVerdict(target, r);
      })
      .catch((e) => { if (!cancelled) setError(e?.message ?? String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, runId]);

  const v = result?.verdict;
  const verdictStyle =
    v === "feasible"   ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
    : v === "infeasible" ? "border-rose-500/30 bg-rose-500/10 text-rose-400"
    : "border-slate-500/30 bg-slate-500/10 text-slate-400";
  const verdictLabel =
    v === "feasible"   ? "Feasible"
    : v === "infeasible" ? "Not feasible"
    : v === "insufficient_data" ? "Insufficient data" : "";

  return (
    <DialogPrimitive.Root open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[500px] flex-col border-l border-white/8 bg-[#080a16] shadow-2xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right duration-300 overflow-y-auto">
          <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
            <div className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-cyan-400" />
              <span className="text-sm font-semibold text-slate-100">Feasibility check</span>
            </div>
            <DialogPrimitive.Close asChild>
              <button className="rounded-md p-1 text-slate-500 transition-colors hover:text-slate-300">
                <X className="h-4 w-4" />
              </button>
            </DialogPrimitive.Close>
          </div>

          {target && (
            <div className="flex flex-col gap-5 p-5">
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  {target.kind === "goal" ? "Goal" : "Objective"}
                </p>
                <p className="text-sm leading-relaxed text-slate-200">{target.text}</p>
              </div>

              {loading && (
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Assessing against the SWOT baseline…
                </div>
              )}
              {error && (
                <p className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-xs text-rose-400">
                  {error}
                </p>
              )}

              {result && (
                <>
                  <div className={cn("rounded-lg border p-3", verdictStyle)}>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-sm font-semibold">{verdictLabel}</span>
                      <span className="text-[10px] tabular-nums opacity-70">
                        horizon ≤ {result.timeframe_years} yr
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed opacity-90">{result.reason}</p>
                  </div>

                  {result.suggestion && (
                    <div>
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                        Suggestion
                      </p>
                      <p className="text-xs leading-relaxed text-slate-400">{result.suggestion}</p>
                    </div>
                  )}

                  {result.evidence.pillars.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                        Pillars
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {result.evidence.pillars.map((p) => (
                          <Badge key={p} variant="default" className="text-[10px]">{p}</Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {result.evidence.swot_items.length > 0 && (
                    <div>
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                        Data considered ({result.evidence.swot_items.length})
                      </p>
                      <div className="space-y-2">
                        {result.evidence.swot_items.map((item) => (
                          <div
                            key={item.item_id}
                            className={cn("rounded-lg border p-3 text-xs", swotTypeColor(item.type))}
                          >
                            <span className="mb-1 block font-semibold capitalize">
                              {item.type}
                              {item.pillar_name && (
                                <span className="ml-1 font-normal opacity-70">· {item.pillar_name}</span>
                              )}
                            </span>
                            {item.title && <p className="mb-0.5 font-medium">{item.title}</p>}
                            <p className="leading-relaxed opacity-80">{item.description}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {result.evidence.indicators.length > 0 && (
                    <div>
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                        NAQAAE indicators
                      </p>
                      <div className="space-y-2">
                        {result.evidence.indicators.map((ind, i) => (
                          <div
                            key={ind.indicator_id ?? i}
                            className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3"
                          >
                            <p className="text-xs font-semibold text-emerald-400">
                              {ind.indicator_title ?? ind.indicator_id}
                            </p>
                            {ind.grounding_score != null && (
                              <span className="shrink-0 text-[10px] tabular-nums text-emerald-500/70">
                                {ind.grounding_score.toFixed(2)}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// Single editable objective row
function ObjectiveRow({
  obj,
  onTrace,
  onCheckFeasibility,
  onDelete,
  onTextSave,
  onReset,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
  locked,
}: {
  obj: StrategyObjective;
  onTrace: () => void;
  onCheckFeasibility: () => void;
  onDelete: () => void;
  onTextSave: (text: string) => void;
  onReset: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
  locked: boolean;
}) {
  const [local, setLocal] = useState(obj.text);
  const timerRef           = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Offer the feasibility check on user-added objectives AND on AI objectives the
  // user has edited (the AI suggestion is presumed feasible, but your change may not be).
  const canCheckFeasibility = obj.added_by_user || obj.edited_by_user;
  const verdict   = obj.feasibility?.verdict;

  // Keep local text in sync when the parent resets the objective
  useEffect(() => { setLocal(obj.text); }, [obj.text]);

  function handleChange(val: string) {
    setLocal(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onTextSave(val), 800);
  }

  return (
    <div className="group flex gap-2 rounded-lg border border-white/5 bg-[#080a16] p-3 transition-colors hover:border-white/10">
      {/* Reorder arrows */}
      {!locked && (
        <div className="flex shrink-0 flex-col gap-0.5 pt-0.5">
          <button
            onClick={onMoveUp}
            disabled={isFirst}
            className="rounded p-0.5 text-slate-600 transition-colors hover:text-slate-300 disabled:opacity-20"
          >
            <ChevronUp className="h-3 w-3" />
          </button>
          <button
            onClick={onMoveDown}
            disabled={isLast}
            className="rounded p-0.5 text-slate-600 transition-colors hover:text-slate-300 disabled:opacity-20"
          >
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>
      )}

      <div className="min-w-0 flex-1 space-y-2">
        {/* Inline provenance badges */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={towsBadgeVariant(obj.tows_type)} className="text-[10px]">
            {obj.tows_type}
          </Badge>
          <span
            className={cn(
              "text-[10px] font-medium",
              alignmentColor(obj.alignment),
            )}
          >
            {alignmentLabel(obj.alignment)}
          </span>
          {obj.grounding_score != null && (
            <span className="text-[10px] tabular-nums text-slate-600">
              {obj.grounding_score.toFixed(2)}
            </span>
          )}
          {obj.edited_by_user && (
            <span className="text-[10px] text-slate-600 italic">edited</span>
          )}
          {canCheckFeasibility && verdict && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium",
                verdict === "feasible"
                  ? "bg-emerald-500/10 text-emerald-400"
                  : verdict === "infeasible"
                  ? "bg-rose-500/10 text-rose-400"
                  : "bg-slate-500/10 text-slate-400",
              )}
            >
              <Gauge className="h-2.5 w-2.5" />
              {verdict === "feasible"
                ? "Feasible"
                : verdict === "infeasible"
                ? "Not feasible"
                : "Insufficient data"}
            </span>
          )}
        </div>

        {/* Editable text */}
        {locked ? (
          <p className="text-xs leading-relaxed text-slate-300">{local}</p>
        ) : (
          <textarea
            rows={3}
            value={local}
            onChange={(e) => handleChange(e.target.value)}
            className="w-full resize-none rounded-md border border-white/8 bg-transparent px-2 py-1.5 text-xs text-slate-200 outline-none transition-colors focus:border-cyan-500/40 focus:ring-1 focus:ring-cyan-500/15"
          />
        )}

        {/* Action row */}
        {!locked && (
          <div className="flex items-center gap-2">
            <button
              onClick={onTrace}
              className="flex items-center gap-1 rounded text-[10px] text-cyan-500 hover:text-cyan-400 transition-colors"
            >
              <GitBranch className="h-3 w-3" />
              Trace
            </button>
            {canCheckFeasibility && (
              <button
                onClick={onCheckFeasibility}
                className="flex items-center gap-1 rounded text-[10px] text-cyan-500 hover:text-cyan-400 transition-colors"
              >
                <Gauge className="h-3 w-3" />
                Feasibility
              </button>
            )}
            {obj.edited_by_user && obj.original_text && (
              <button
                onClick={onReset}
                className="flex items-center gap-1 rounded text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
              >
                <RotateCcw className="h-3 w-3" />
                Reset to AI
              </button>
            )}
            <button
              onClick={onDelete}
              className="ml-auto flex items-center gap-1 rounded text-[10px] text-slate-600 hover:text-rose-400 transition-colors"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )}
        {locked && (
          <button
            onClick={onTrace}
            className="flex items-center gap-1 text-[10px] text-cyan-600 hover:text-cyan-400 transition-colors"
          >
            <GitBranch className="h-3 w-3" />
            Trace provenance
          </button>
        )}
      </div>
    </div>
  );
}

// Single goal card
function GoalCard({
  goal,
  index,
  total,
  onDeleteGoal,
  onMoveGoalUp,
  onMoveGoalDown,
  onAddObjective,
  onDeleteObjective,
  onObjectiveTextSave,
  onObjectiveReset,
  onMoveObjectiveUp,
  onMoveObjectiveDown,
  onGoalTitleSave,
  onGoalDescSave,
  onGoalReset,
  onTrace,
  onCheckGoalFeasibility,
  onCheckObjectiveFeasibility,
  locked,
}: {
  goal: StrategyGoal;
  index: number;
  total: number;
  onDeleteGoal: () => void;
  onMoveGoalUp: () => void;
  onMoveGoalDown: () => void;
  onAddObjective: () => void;
  onDeleteObjective: (id: string) => void;
  onObjectiveTextSave: (id: string, text: string) => void;
  onObjectiveReset: (id: string) => void;
  onMoveObjectiveUp: (idx: number) => void;
  onMoveObjectiveDown: (idx: number) => void;
  onGoalTitleSave: (title: string) => void;
  onGoalDescSave: (desc: string) => void;
  onGoalReset: () => void;
  onTrace: (obj: StrategyObjective) => void;
  onCheckGoalFeasibility: () => void;
  onCheckObjectiveFeasibility: (obj: StrategyObjective) => void;
  locked: boolean;
}) {
  const [expanded, setExpanded]     = useState(true);
  const [localTitle, setLocalTitle] = useState(goal.title);
  const [localDesc,  setLocalDesc]  = useState(goal.description ?? "");
  // Offer the feasibility check on user-added goals AND on AI goals the user has
  // edited (the AI suggestion is presumed feasible, but your change may not be).
  const canCheckFeasibility = goal.added_by_user || goal.edited_by_user;
  const verdict   = goal.feasibility?.verdict;
  const titleTimer                  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const descTimer                   = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setLocalTitle(goal.title);             }, [goal.title]);
  useEffect(() => { setLocalDesc(goal.description ?? ""); }, [goal.description]);

  function handleTitle(val: string) {
    setLocalTitle(val);
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => onGoalTitleSave(val), 800);
  }
  function handleDesc(val: string) {
    setLocalDesc(val);
    if (descTimer.current) clearTimeout(descTimer.current);
    descTimer.current = setTimeout(() => onGoalDescSave(val), 800);
  }

  return (
    <div className="rounded-xl border border-white/8 bg-[#0d1117]">
      {/* Goal header */}
      <div className="flex items-center gap-3 p-4">
        {!locked && (
          <div className="flex shrink-0 flex-col gap-0.5">
            <button onClick={onMoveGoalUp} disabled={index === 0} className="rounded p-0.5 text-slate-600 hover:text-slate-300 disabled:opacity-20 transition-colors">
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button onClick={onMoveGoalDown} disabled={index === total - 1} className="rounded p-0.5 text-slate-600 hover:text-slate-300 disabled:opacity-20 transition-colors">
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-cyan-500/10 text-[11px] font-bold text-cyan-400">
          {index + 1}
        </span>

        <div className="min-w-0 flex-1">
          {locked ? (
            <p className="text-sm font-semibold text-slate-100">{localTitle}</p>
          ) : (
            <input
              type="text"
              value={localTitle}
              onChange={(e) => handleTitle(e.target.value)}
              className="w-full rounded-md border border-white/8 bg-transparent px-2 py-1 text-sm font-semibold text-slate-100 outline-none transition-colors focus:border-cyan-500/40"
            />
          )}
          {canCheckFeasibility && verdict && (
            <span
              className={cn(
                "mt-1 ml-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
                verdict === "feasible"
                  ? "bg-emerald-500/10 text-emerald-400"
                  : verdict === "infeasible"
                  ? "bg-rose-500/10 text-rose-400"
                  : "bg-slate-500/10 text-slate-400",
              )}
            >
              <Gauge className="h-2.5 w-2.5" />
              {verdict === "feasible"
                ? "Feasible"
                : verdict === "infeasible"
                ? "Not feasible"
                : "Insufficient data"}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {!locked && canCheckFeasibility && (
            <button
              onClick={onCheckGoalFeasibility}
              title="Check feasibility"
              className="rounded p-1 text-slate-600 hover:text-cyan-400 transition-colors"
            >
              <Gauge className="h-3.5 w-3.5" />
            </button>
          )}
          {!locked && goal.edited_by_user && goal.original_title && (
            <button
              onClick={onGoalReset}
              title="Reset to AI suggestion"
              className="rounded p-1 text-slate-600 hover:text-amber-400 transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
          {!locked && (
            <button onClick={onDeleteGoal} className="rounded p-1 text-slate-600 hover:text-rose-400 transition-colors">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button onClick={() => setExpanded((p) => !p)} className="rounded p-1 text-slate-600 hover:text-slate-300 transition-colors">
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-white/5 p-4 space-y-4">
          {/* Description */}
          {locked ? (
            localDesc && (
              <p className="text-xs leading-relaxed text-slate-500">{localDesc}</p>
            )
          ) : (
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                Description
              </p>
              <textarea
                rows={2}
                value={localDesc}
                onChange={(e) => handleDesc(e.target.value)}
                className="w-full resize-none rounded-md border border-white/8 bg-transparent px-2 py-1.5 text-xs text-slate-400 outline-none transition-colors focus:border-cyan-500/40"
              />
            </div>
          )}

          {/* Objectives */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">
              Objectives ({goal.objectives.length})
            </p>
            {goal.objectives.map((obj, oi) => (
              <ObjectiveRow
                key={obj.objective_id}
                obj={obj}
                onTrace={() => onTrace(obj)}
                onCheckFeasibility={() => onCheckObjectiveFeasibility(obj)}
                onDelete={() => onDeleteObjective(obj.objective_id)}
                onTextSave={(t) => onObjectiveTextSave(obj.objective_id, t)}
                onReset={() => onObjectiveReset(obj.objective_id)}
                onMoveUp={() => onMoveObjectiveUp(oi)}
                onMoveDown={() => onMoveObjectiveDown(oi)}
                isFirst={oi === 0}
                isLast={oi === goal.objectives.length - 1}
                locked={locked}
              />
            ))}
          </div>

          {!locked && canCheckFeasibility && verdict === "infeasible" && (
            <p className="text-[10px] leading-relaxed text-rose-400/80">
              This goal was flagged as not feasible within the {`≤5`}-year horizon —
              reconsider it before adding objectives.
            </p>
          )}
          {!locked && (
            <Button variant="ghost" size="sm" onClick={onAddObjective} className="w-full text-slate-600 hover:text-slate-300 border border-dashed border-white/10 hover:border-white/20">
              <Plus className="h-3.5 w-3.5" />
              Add objective
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// Coverage matrix panel
function CoverageMatrix({ goals }: { goals: StrategyGoal[] }) {
  const objs = goals.flatMap((g) => g.objectives);
  const total   = objs.length;
  const n_ind   = objs.filter((o) => o.alignment === "indicator").length;
  const n_pil   = objs.filter((o) => o.alignment === "pillar_only").length;
  const n_str   = objs.filter((o) => o.alignment === "strategic").length;

  const rows = [
    { label: "Grounded to indicator",  count: n_ind, color: "bg-emerald-400" },
    { label: "Pillar-level alignment",  count: n_pil, color: "bg-amber-400" },
    { label: "Beyond standards",        count: n_str, color: "bg-slate-500" },
  ];

  return (
    <div className="rounded-xl border border-white/8 bg-[#0d1117] p-5">
      <h3 className="mb-1 text-sm font-semibold text-slate-100">
        NAQAAE Coverage Matrix
      </h3>
      <p className="mb-4 text-xs text-slate-500">
        {total} total objective{total !== 1 ? "s" : ""} across {goals.length} goal{goals.length !== 1 ? "s" : ""}
      </p>
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-3">
            <div className="w-44 shrink-0 truncate text-right text-xs text-slate-500">
              {r.label}
            </div>
            <div className="flex-1">
              <Progress
                value={total ? (r.count / total) * 100 : 0}
                className="h-1.5"
                indicatorClassName={r.color}
              />
            </div>
            <div className="w-10 shrink-0 text-right text-xs tabular-nums text-slate-500">
              {r.count}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function StrategyPage() {
  const [phase,     setPhase]     = useState<Phase>("idle");
  const [progress,  setProgress]  = useState<StrategyProgress | null>(null);
  const [plan,      setPlan]      = useState<StrategyPlan | null>(null);
  const [traceObj,  setTraceObj]  = useState<StrategyObjective | null>(null);
  const [feasTarget, setFeasTarget] = useState<FeasTarget | null>(null);
  const [approving, setApproving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  // ── Session persistence ────────────────────────────────────────────────────
  // Reload the last viewed plan on refresh instead of starting from zero.
  useEffect(() => {
    const last = typeof window !== "undefined"
      ? window.localStorage.getItem("stratos:lastRunId")
      : null;
    if (!last) return;
    let cancelled = false;
    setRestoring(true);
    fetchPlan(last)
      .then((p) => { if (!cancelled) { setPlan(p); setPhase("editing"); } })
      .catch(() => window.localStorage.removeItem("stratos:lastRunId"))
      .finally(() => { if (!cancelled) setRestoring(false); });
    return () => { cancelled = true; };
  }, []);

  // Remember the current plan so a refresh can restore it.
  useEffect(() => {
    if (plan?.run_id && typeof window !== "undefined") {
      window.localStorage.setItem("stratos:lastRunId", plan.run_id);
    }
  }, [plan?.run_id]);

  // ── Generate ──────────────────────────────────────────────────────────────

  const handleGenerate = useCallback(async () => {
    setPhase("running");
    setProgress(null);
    setError(null);
    setFeasTarget(null);    // a fresh plan → close any open drawers
    setTraceObj(null);
    try {
      const jobId = await runStrategy();
      const { strategy_run_id } = await pollStrategy(jobId, setProgress);
      const fetched = await fetchPlan(strategy_run_id);
      setPlan(fetched);
      setPhase("editing");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, []);

  // Re-generate from the latest SWOT (creates a NEW plan, replaces the view).
  const handleRegenerate = useCallback(() => {
    if (plan && !window.confirm(
      "Generate fresh goals and objectives from the latest SWOT data? This creates a " +
      "new set and replaces the current view (the old one stays in the database).",
    )) return;
    handleGenerate();
  }, [plan, handleGenerate]);

  // ── Plan mutation helpers ─────────────────────────────────────────────────

  function mutatePlan(fn: (draft: StrategyPlan) => StrategyPlan) {
    setPlan((p) => (p ? fn(p) : p));
  }

  // Reflect a feasibility verdict (already persisted server-side) on the item.
  const applyFeasibility = useCallback((t: FeasTarget, result: FeasibilityResult) => {
    setPlan((p) => {
      if (!p) return p;
      return {
        ...p,
        goals: p.goals.map((g) => {
          if (t.kind === "goal" && g.goal_id === t.goalId) {
            return { ...g, feasibility: result };
          }
          if (t.kind === "objective" && g.goal_id === t.goalId) {
            return {
              ...g,
              objectives: g.objectives.map((o) =>
                o.objective_id === t.objectiveId ? { ...o, feasibility: result } : o,
              ),
            };
          }
          return g;
        }),
      };
    });
  }, []);

  // Goal operations
  const handleGoalTitleSave = useCallback(async (goalId: string, title: string) => {
    mutatePlan((p) => ({
      ...p,
      goals: p.goals.map((g) =>
        g.goal_id === goalId
          ? { ...g, title, edited_by_user: true, feasibility: null }
          : g,
      ),
    }));
    await patchGoal(goalId, { title });
  }, []);

  const handleGoalDescSave = useCallback(async (goalId: string, desc: string) => {
    mutatePlan((p) => ({
      ...p,
      goals: p.goals.map((g) =>
        g.goal_id === goalId
          ? { ...g, description: desc, edited_by_user: true, feasibility: null }
          : g,
      ),
    }));
    await patchGoal(goalId, { description: desc });
  }, []);

  const handleGoalReset = useCallback(async (goalId: string) => {
    await patchGoal(goalId, { reset: true });
    if (!plan) return;
    const fresh = await fetchPlan(plan.run_id);
    setPlan(fresh);
  }, [plan]);

  const handleDeleteGoal = useCallback(async (goalId: string) => {
    mutatePlan((p) => ({
      ...p,
      goals: p.goals.filter((g) => g.goal_id !== goalId),
    }));
    await deleteGoal(goalId);
  }, []);

  const handleAddGoal = useCallback(async () => {
    if (!plan) return;
    const { goal_id, position } = await addGoal(plan.run_id, "New goal", "");
    mutatePlan((p) => ({
      ...p,
      goals: [
        ...p.goals,
        {
          goal_id,
          run_id:               p.run_id,
          title:                "New goal",
          description:          "",
          original_title:       "New goal",
          original_description: "",
          pillar_ids:           [],
          position,
          edited_by_user:       true,
          added_by_user:        true,
          feasibility:          null,
          objectives:           [],
        } satisfies StrategyGoal,
      ],
    }));
  }, [plan]);

  const handleMoveGoal = useCallback(
    async (index: number, dir: "up" | "down") => {
      if (!plan) return;
      const goals = [...plan.goals];
      const swap  = dir === "up" ? index - 1 : index + 1;
      if (swap < 0 || swap >= goals.length) return;
      [goals[index], goals[swap]] = [goals[swap], goals[index]];
      mutatePlan((p) => ({ ...p, goals }));
      await reorderGoals(goals.map((g) => g.goal_id));
    },
    [plan],
  );

  // Objective operations
  const handleObjectiveTextSave = useCallback(
    async (goalId: string, objId: string, text: string) => {
      mutatePlan((p) => ({
        ...p,
        goals: p.goals.map((g) =>
          g.goal_id !== goalId
            ? g
            : {
                ...g,
                objectives: g.objectives.map((o) =>
                  o.objective_id === objId
                    ? { ...o, text, edited_by_user: true, feasibility: null }
                    : o,
                ),
              },
        ),
      }));
      await patchObjective(objId, { text });
    },
    [],
  );

  const handleObjectiveReset = useCallback(
    async (goalId: string, objId: string) => {
      await patchObjective(objId, { reset: true });
      if (!plan) return;
      const fresh = await fetchPlan(plan.run_id);
      setPlan(fresh);
    },
    [plan],
  );

  const handleDeleteObjective = useCallback(
    async (goalId: string, objId: string) => {
      mutatePlan((p) => ({
        ...p,
        goals: p.goals.map((g) =>
          g.goal_id !== goalId
            ? g
            : {
                ...g,
                objectives: g.objectives.filter(
                  (o) => o.objective_id !== objId,
                ),
              },
        ),
      }));
      await deleteObjective(objId);
    },
    [],
  );

  const handleAddObjective = useCallback(async (goalId: string) => {
    const { objective_id, position } = await addObjective(goalId, "New objective");
    mutatePlan((p) => ({
      ...p,
      goals: p.goals.map((g) =>
        g.goal_id !== goalId
          ? g
          : {
              ...g,
              objectives: [
                ...g.objectives,
                {
                  objective_id,
                  goal_id:               goalId,
                  text:                  "New objective",
                  original_text:         "New objective",
                  tows_type:             "SO" as TowsType,
                  alignment:             "strategic" as AlignmentType,
                  pillar_id:             null,
                  grounded_indicator_id: null,
                  grounding_score:       null,
                  source_swot_ids:       [],
                  improvement_source:    null,
                  position,
                  edited_by_user:        true,
                  added_by_user:         true,
                  feasibility:           null,
                  source_items:          [],
                  indicator_title:       null,
                  indicator_text:        null,
                } satisfies StrategyObjective,
              ],
            },
      ),
    }));
  }, []);

  const handleMoveObjective = useCallback(
    async (goalId: string, index: number, dir: "up" | "down") => {
      if (!plan) return;
      const goal = plan.goals.find((g) => g.goal_id === goalId);
      if (!goal) return;
      const objs = [...goal.objectives];
      const swap = dir === "up" ? index - 1 : index + 1;
      if (swap < 0 || swap >= objs.length) return;
      [objs[index], objs[swap]] = [objs[swap], objs[index]];
      mutatePlan((p) => ({
        ...p,
        goals: p.goals.map((g) =>
          g.goal_id === goalId ? { ...g, objectives: objs } : g,
        ),
      }));
      await reorderObjectives(objs.map((o) => o.objective_id));
    },
    [plan],
  );

  // ── Approve ───────────────────────────────────────────────────────────────

  const handleApprove = useCallback(async () => {
    if (!plan) return;
    // HITL gate: validation issues block approval unless the user overrides.
    const issues = plan.validation_errors ?? [];
    let force = false;
    if (issues.length > 0) {
      force = window.confirm(
        `${issues.length} validation issue(s) remain:\n\n` +
        issues.slice(0, 10).join("\n") +
        `\n\nApprove the plan anyway?`,
      );
      if (!force) return;
    }
    setApproving(true);
    try {
      const res = await approvePlan(plan.run_id, force);
      mutatePlan((p) => ({
        ...p,
        plan_status:  res.plan_status as "draft" | "final",
        finalized_at: res.finalized_at,
      }));
    } finally {
      setApproving(false);
    }
  }, [plan]);

  // ── Subtitle ──────────────────────────────────────────────────────────────

  const subtitle =
    phase === "idle"
      ? "Generate your strategic goals and objectives from the latest SWOT data."
      : phase === "running"
      ? "Running the 5-station pipeline — watch each stage complete."
      : phase === "editing"
      ? plan?.plan_status === "final"
        ? `Approved plan · ${plan.goals.length} goals · finalized ${plan.finalized_at?.slice(0, 10)}`
        : `Draft plan · ${plan?.goals.length ?? 0} goals · edit freely, approve when ready`
      : "Strategic Goals";

  const locked = plan?.plan_status === "final";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-full flex-col">
      <Header title="Strategic Goals" subtitle={subtitle} />

      <div className="flex flex-col gap-4 p-6">

        {/* ── Restoring last plan ── */}
        {restoring && !plan && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Restoring your last plan…
          </div>
        )}

        {/* ── Idle ── */}
        {phase === "idle" && !restoring && (
          <div className="flex flex-col items-center gap-6 py-12">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-cyan-500/10">
              <Sparkles className="h-8 w-8 text-cyan-400" />
            </div>
            <div className="text-center">
              <h2 className="mb-2 text-lg font-semibold text-slate-100">
                Generate Your Strategic Goals
              </h2>
              <p className="max-w-md text-sm text-slate-500">
                The pipeline pairs your SWOT items, grounds them in the NAQAAE
                knowledge graph, clusters by theme, and drafts SMART goals and
                objectives using the AI. Uses the most recent day&apos;s SWOT batch.
              </p>
            </div>
            <Button size="lg" onClick={handleGenerate} className="shadow-xl shadow-cyan-500/10">
              <Sparkles className="h-4 w-4" />
              Generate Goals
            </Button>
          </div>
        )}

        {/* ── Running ── */}
        {phase === "running" && (
          <div className="mx-auto w-full max-w-lg rounded-xl border border-white/8 bg-[#0d1117] p-6">
            <div className="mb-4 flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
              <h3 className="text-sm font-semibold text-slate-100">
                Running Strategy Pipeline
              </h3>
              {progress && progress.retries > 0 && (
                <span className="ml-auto text-xs text-amber-400">
                  retry {progress.retries}
                </span>
              )}
            </div>
            <div className="divide-y divide-white/5">
              {(
                progress?.stations ?? [
                  { key: "pair",     label: "Pair TOWS",             status: "active",  detail: "" },
                  { key: "ground",   label: "Ground in NAQAAE graph", status: "pending", detail: "" },
                  { key: "cluster",  label: "Cluster into goals",     status: "pending", detail: "" },
                  { key: "draft",    label: "Draft goals (LLM)",      status: "pending", detail: "" },
                  { key: "validate", label: "Validate",               status: "pending", detail: "" },
                ]
              ).map((s) => (
                <StationRow key={s.key} station={s as StrategyStation} />
              ))}
            </div>
          </div>
        )}

        {/* ── Error ── */}
        {phase === "error" && (
          <div className="flex items-start gap-3 rounded-xl border border-rose-500/20 bg-rose-500/5 p-5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
            <div>
              <p className="text-sm font-semibold text-rose-400">Something went wrong</p>
              <p className="mt-1 text-xs text-slate-400">{error}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => { setError(null); setPhase("idle"); }}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Try again
              </Button>
            </div>
          </div>
        )}

        {/* ── Editing ── */}
        {phase === "editing" && plan && (
          <>
            {/* Status banner */}
            <div className={cn(
              "flex items-center justify-between rounded-xl border px-5 py-3",
              locked
                ? "border-emerald-500/15 bg-emerald-500/5"
                : "border-cyan-500/10 bg-cyan-500/5",
            )}>
              <div className="flex items-center gap-2.5">
                {locked
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  : <Sparkles className="h-4 w-4 text-cyan-400" />
                }
                <div>
                  <p className={cn("text-sm font-semibold", locked ? "text-emerald-400" : "text-cyan-400")}>
                    {locked ? "Plan approved" : "Draft — in review"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {locked
                      ? `Finalized ${plan.finalized_at?.slice(0, 10)}`
                      : "All edits save automatically. Approve when the plan is ready."
                    }
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleRegenerate}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Generate new goals
                </Button>
                {!locked && (
                  <Button
                    size="sm"
                    disabled={approving}
                    onClick={handleApprove}
                  >
                    {approving
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Approving…</>
                      : <><CheckCircle2 className="h-3.5 w-3.5" /> Approve Plan</>
                    }
                  </Button>
                )}
              </div>
            </div>

            {/* Validation issues (from the validate node — blocks approval) */}
            {!locked && (plan.validation_errors?.length ?? 0) > 0 && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-5 py-3">
                <p className="text-sm font-semibold text-amber-400">
                  {plan.validation_errors.length} validation issue
                  {plan.validation_errors.length !== 1 ? "s" : ""} to review
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-slate-400">
                  {plan.validation_errors.slice(0, 8).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                  {plan.validation_errors.length > 8 && (
                    <li>…and {plan.validation_errors.length - 8} more</li>
                  )}
                </ul>
              </div>
            )}

            {/* Goal cards */}
            <div className="space-y-4">
              {plan.goals.map((goal, gi) => (
                <GoalCard
                  key={goal.goal_id}
                  goal={goal}
                  index={gi}
                  total={plan.goals.length}
                  locked={locked ?? false}
                  onDeleteGoal={() => handleDeleteGoal(goal.goal_id)}
                  onMoveGoalUp={() => handleMoveGoal(gi, "up")}
                  onMoveGoalDown={() => handleMoveGoal(gi, "down")}
                  onAddObjective={() => handleAddObjective(goal.goal_id)}
                  onDeleteObjective={(id) => handleDeleteObjective(goal.goal_id, id)}
                  onObjectiveTextSave={(id, t) => handleObjectiveTextSave(goal.goal_id, id, t)}
                  onObjectiveReset={(id) => handleObjectiveReset(goal.goal_id, id)}
                  onMoveObjectiveUp={(oi) => handleMoveObjective(goal.goal_id, oi, "up")}
                  onMoveObjectiveDown={(oi) => handleMoveObjective(goal.goal_id, oi, "down")}
                  onGoalTitleSave={(t) => handleGoalTitleSave(goal.goal_id, t)}
                  onGoalDescSave={(d) => handleGoalDescSave(goal.goal_id, d)}
                  onGoalReset={() => handleGoalReset(goal.goal_id)}
                  onTrace={setTraceObj}
                  onCheckGoalFeasibility={() =>
                    setFeasTarget({
                      kind: "goal",
                      text: [goal.title, goal.description].filter(Boolean).join(" — "),
                      goalId: goal.goal_id,
                    })
                  }
                  onCheckObjectiveFeasibility={(obj) =>
                    setFeasTarget({
                      kind: "objective",
                      text: obj.text,
                      goalId: goal.goal_id,
                      objectiveId: obj.objective_id,
                    })
                  }
                />
              ))}
            </div>

            {!locked && (
              <Button
                variant="outline"
                className="w-full border-dashed"
                onClick={handleAddGoal}
              >
                <Plus className="h-4 w-4" />
                Add goal
              </Button>
            )}

            {/* Coverage matrix */}
            <CoverageMatrix goals={plan.goals} />
          </>
        )}
      </div>

      {/* Provenance drawer */}
      <ProvenanceDrawer
        objective={traceObj}
        onClose={() => setTraceObj(null)}
      />

      {/* Feasibility drawer (HITL) */}
      <FeasibilityDrawer
        target={feasTarget}
        runId={plan?.run_id}
        onClose={() => setFeasTarget(null)}
        onVerdict={applyFeasibility}
      />
    </div>
  );
}
