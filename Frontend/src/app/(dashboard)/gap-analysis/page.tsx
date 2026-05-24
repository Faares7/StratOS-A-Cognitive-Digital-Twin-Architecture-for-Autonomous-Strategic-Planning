"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { fetchGapDraft, calculateGap } from "@/services/gapAnalysisApi";
import type { PillarDraft, GapCalculationResult } from "@/types";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Database,
  Lightbulb,
  Loader2,
  RotateCcw,
  Sparkles,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase = "loading" | "editing" | "calculating" | "results" | "error";

// ── Sub-components ────────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
      {children}
    </p>
  );
}

function EditableField({
  value,
  onChange,
  rows = 3,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  disabled?: boolean;
}) {
  return (
    <textarea
      rows={rows}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "w-full resize-none rounded-lg border border-white/10 bg-[#0d1117] px-3 py-2.5",
        "text-xs text-slate-200 placeholder-slate-600 outline-none",
        "transition-colors focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
    />
  );
}

/** Card used in Phase 1 (editing). Shows all three editable fields. */
function PillarEditCard({
  draft,
  index,
  onChange,
  disabled,
}: {
  draft: PillarDraft;
  index: number;
  onChange: (index: number, field: keyof PillarDraft, value: string) => void;
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-xl border border-white/5 bg-[#0d1117]">
      {/* Card header */}
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="flex w-full items-center justify-between gap-3 p-4 text-left"
      >
        <div className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-cyan-500/10 text-[11px] font-bold text-cyan-400">
            {index + 1}
          </span>
          <span className="text-sm font-semibold text-slate-100">
            {draft.pillar}
          </span>
          {draft.target_source === "neo4j" && (
            <span
              title="Target state sourced from Neo4j NAQAAE knowledge graph"
              className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400"
            >
              <Database className="h-2.5 w-2.5" />
              Neo4j
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-slate-600" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-600" />
        )}
      </button>

      {expanded && (
        <div className="grid gap-4 border-t border-white/5 p-4 md:grid-cols-3">
          <div>
            <FieldLabel>Target State (NAQAAE Standard)</FieldLabel>
            <EditableField
              rows={6}
              disabled={disabled}
              value={draft.target_state}
              onChange={(v) => onChange(index, "target_state", v)}
            />
          </div>
          <div>
            <FieldLabel>Current Strengths</FieldLabel>
            <EditableField
              rows={6}
              disabled={disabled}
              value={draft.strengths}
              onChange={(v) => onChange(index, "strengths", v)}
            />
          </div>
          <div>
            <FieldLabel>Current Weaknesses</FieldLabel>
            <EditableField
              rows={6}
              disabled={disabled}
              value={draft.weaknesses}
              onChange={(v) => onChange(index, "weaknesses", v)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Card used in Phase 3 (results). Shows compact inputs + LLM suggestions. */
function PillarResultCard({
  draft,
  suggestions,
  index,
}: {
  draft: PillarDraft;
  suggestions: string[];
  index: number;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/5 bg-[#0d1117]">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-white/5 p-4">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-cyan-500/10 text-[11px] font-bold text-cyan-400">
          {index + 1}
        </span>
        <h3 className="text-sm font-semibold text-slate-100">{draft.pillar}</h3>
      </div>

      <div className="grid gap-0 md:grid-cols-2">
        {/* Left: compact input summary */}
        <div className="space-y-3 border-b border-white/5 p-4 md:border-b-0 md:border-r">
          <div>
            <FieldLabel>Target State</FieldLabel>
            <p className="text-xs leading-relaxed text-slate-400">
              {draft.target_state}
            </p>
          </div>
          <div>
            <FieldLabel>Strengths</FieldLabel>
            <p className="text-xs leading-relaxed text-emerald-400/80">
              {draft.strengths}
            </p>
          </div>
          <div>
            <FieldLabel>Weaknesses</FieldLabel>
            <p className="text-xs leading-relaxed text-rose-400/80">
              {draft.weaknesses}
            </p>
          </div>
        </div>

        {/* Right: LLM suggestions */}
        <div className="p-4">
          <div className="mb-3 flex items-center gap-1.5">
            <Lightbulb className="h-3.5 w-3.5 text-amber-400" />
            <FieldLabel>Improvement Suggestions</FieldLabel>
          </div>
          {suggestions.length === 0 ? (
            <p className="text-xs text-slate-600 italic">No suggestions generated.</p>
          ) : (
            <ul className="space-y-2">
              {suggestions.map((s, i) => (
                <li key={i} className="flex gap-2 text-xs leading-relaxed text-slate-200">
                  <span className="mt-0.5 shrink-0 text-amber-400">•</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-xl border border-white/5 bg-[#0d1117] p-4">
      <div className="mb-4 h-4 w-1/3 rounded bg-white/5" />
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2">
            <div className="h-3 w-1/2 rounded bg-white/5" />
            <div className="h-24 rounded-lg bg-white/5" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function GapAnalysisPage() {
  // ── State (flat, phase-driven) ──────────────────────────────────────────────
  const [phase, setPhase]       = useState<Phase>("loading");
  const [drafts, setDrafts]     = useState<PillarDraft[]>([]);
  const [results, setResults]   = useState<GapCalculationResult>([]);
  const [pollTick, setPollTick] = useState(0);
  const [error, setError]       = useState<string | null>(null);

  // ── Phase 1: load draft data on mount ──────────────────────────────────────
  useEffect(() => {
    fetchGapDraft()
      .then((data) => {
        setDrafts(data.pillars);
        setPhase("editing");
      })
      .catch((err: Error) => {
        setError(err.message);
        setPhase("error");
      });
  }, []);

  // ── Editing: field change handler ───────────────────────────────────────────
  const handleFieldChange = useCallback(
    (index: number, field: keyof PillarDraft, value: string) => {
      setDrafts((prev) =>
        prev.map((d, i) => (i === index ? { ...d, [field]: value } : d)),
      );
    },
    [],
  );

  // ── Phase 2: submit to LangGraph agent ─────────────────────────────────────
  const handleCalculate = useCallback(async () => {
    setPhase("calculating");
    setPollTick(0);
    try {
      const res = await calculateGap(drafts, () =>
        setPollTick((t) => t + 1),
      );
      setResults(res);
      setPhase("results");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, [drafts]);

  // ── Reset back to editing ───────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    setResults([]);
    setError(null);
    setPhase("editing");
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────────

  const subtitle =
    phase === "editing"
      ? "Review and edit each pillar's data, then trigger the AI gap calculation."
      : phase === "calculating"
      ? "The QA agent is generating improvement suggestions — please wait."
      : phase === "results"
      ? "AI-generated improvement suggestions alongside your verified pillar data."
      : "Gap analysis across the 7 NAQAAE Strategic Pillars";

  return (
    <div className="flex min-h-full flex-col">
      <Header title="Gap Analysis" subtitle={subtitle} />

      <div className="flex flex-col gap-4 p-6">

        {/* ── Loading skeletons ── */}
        {phase === "loading" && (
          <div className="space-y-4">
            {[0, 1, 2].map((i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {/* ── Error state ── */}
        {phase === "error" && (
          <div className="flex items-start gap-3 rounded-xl border border-rose-500/20 bg-rose-500/5 p-5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
            <div>
              <p className="text-sm font-semibold text-rose-400">
                Something went wrong
              </p>
              <p className="mt-1 text-xs text-slate-400">{error}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => {
                  setError(null);
                  setPhase("loading");
                  fetchGapDraft()
                    .then((d) => { setDrafts(d.pillars); setPhase("editing"); })
                    .catch((e: Error) => { setError(e.message); setPhase("error"); });
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Retry
              </Button>
            </div>
          </div>
        )}

        {/* ── Editing phase ── */}
        {(phase === "editing" || phase === "calculating") && drafts.length > 0 && (
          <>
            {/* Info banner */}
            <div className="flex items-start gap-3 rounded-xl border border-cyan-500/10 bg-cyan-500/5 px-4 py-3">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
              <p className="text-xs text-slate-400">
                All three fields are editable. Target States are pulled from the
                Neo4j NAQAAE knowledge graph where available; Strengths and
                Weaknesses are pre-populated placeholder data. Edit anything
                before running the analysis.
              </p>
            </div>

            {/* Pillar cards */}
            <div className="space-y-3">
              {drafts.map((d, i) => (
                <PillarEditCard
                  key={d.pillar}
                  draft={d}
                  index={i}
                  onChange={handleFieldChange}
                  disabled={phase === "calculating"}
                />
              ))}
            </div>

            {/* Calculate CTA */}
            <div className="sticky bottom-6 flex justify-end">
              <Button
                size="lg"
                disabled={phase === "calculating"}
                onClick={handleCalculate}
                className="shadow-xl shadow-cyan-500/10"
              >
                {phase === "calculating" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating suggestions… (poll #{pollTick})
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Calculate Gap Analysis
                  </>
                )}
              </Button>
            </div>
          </>
        )}

        {/* ── Results phase ── */}
        {phase === "results" && (
          <>
            {/* Results summary banner */}
            <div className="flex items-center justify-between rounded-xl border border-emerald-500/15 bg-emerald-500/5 px-5 py-3">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <div>
                  <p className="text-sm font-semibold text-emerald-400">
                    Analysis complete
                  </p>
                  <p className="text-xs text-slate-500">
                    {results.reduce((acc, r) => acc + r.suggestions.length, 0)}{" "}
                    improvement suggestions generated across {results.length}{" "}
                    pillars
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={handleReset}>
                <RotateCcw className="h-3.5 w-3.5" />
                Re-edit
              </Button>
            </div>

            {/* Per-pillar suggestion cards */}
            <div className="space-y-4">
              {results.map((r, i) => {
                const draft = drafts.find((d) => d.pillar === r.pillar) ?? drafts[i];
                return (
                  <PillarResultCard
                    key={r.pillar}
                    draft={draft}
                    suggestions={r.suggestions}
                    index={i}
                  />
                );
              })}
            </div>

            {/* Pillar compliance overview */}
            <div className="rounded-xl border border-white/5 bg-[#0d1117] p-5">
              <h3 className="mb-1 text-sm font-semibold text-slate-100">
                Pillar Coverage
              </h3>
              <p className="mb-4 text-xs text-slate-500">
                Suggestions generated per pillar
              </p>
              <div className="space-y-2.5">
                {results.map((r) => (
                  <div key={r.pillar} className="flex items-center gap-3">
                    <div className="w-44 shrink-0 truncate text-right text-xs text-slate-400">
                      {r.pillar}
                    </div>
                    <div className="flex-1">
                      <Progress
                        value={(r.suggestions.length / 6) * 100}
                        className="h-1.5"
                        indicatorClassName="bg-amber-400"
                      />
                    </div>
                    <div className="w-16 shrink-0 text-right text-xs text-slate-500">
                      {r.suggestions.length} / 6
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
