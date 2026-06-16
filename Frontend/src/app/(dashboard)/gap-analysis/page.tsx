"use client";

import React, { useState, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { fetchGapDraft, calculateGap, suggestOne, approveSuggestion } from "@/services/gapAnalysisApi";
import type { PillarDraft, GapCalculationResult, GapSuggestion, SwotItemDetail } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Database,
  Lightbulb,
  Loader2,
  Plus,
  RotateCcw,
  Sparkles,
  ExternalLink,
  X,
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

// ── SWOT item traceability ────────────────────────────────────────────────────

const AGENT_LABELS: Record<string, string> = {
  tech:               "Tech Intelligence",
  workforce:          "Workforce Analysis",
  sentiment_analysis: "Sentiment Analysis",
  social_media:       "Social Media",
};

const IMPACT_STYLES: Record<string, string> = {
  critical: "bg-red-500/15 text-red-400 border-red-500/30",
  high:     "bg-orange-500/15 text-orange-400 border-orange-500/30",
  medium:   "bg-amber-500/15 text-amber-400 border-amber-500/30",
  low:      "bg-slate-500/15 text-slate-400 border-slate-500/30",
};

const SWOT_CHIP_STYLES: Record<string, string> = {
  strength:    "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20",
  weakness:    "border-rose-500/30    bg-rose-500/10    text-rose-300    hover:bg-rose-500/20",
  opportunity: "border-cyan-500/30    bg-cyan-500/10    text-cyan-300    hover:bg-cyan-500/20",
  threat:      "border-orange-500/30  bg-orange-500/10  text-orange-300  hover:bg-orange-500/20",
};

function SwotItemDetailDialog({
  item,
  category,
  open,
  onClose,
}: {
  item: SwotItemDetail;
  category: string;
  open: boolean;
  onClose: () => void;
}) {
  const sm = item.source_metadata as Record<string, unknown> | null;
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold leading-snug">
            {item.title}
          </DialogTitle>
          <DialogDescription className="sr-only">SWOT item detail</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-xs">
          {/* Badges row */}
          <div className="flex flex-wrap gap-2">
            <span className={cn(
              "rounded-full border px-2.5 py-0.5 text-[10px] font-medium capitalize",
              SWOT_CHIP_STYLES[category] ?? ""
            )}>
              {category}
            </span>
            <span className={cn(
              "rounded-full border px-2.5 py-0.5 text-[10px] font-medium capitalize",
              IMPACT_STYLES[item.impact_level] ?? IMPACT_STYLES.medium
            )}>
              {item.impact_level} impact
            </span>
            {item.agent_id && (
              <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-0.5 text-[10px] font-medium text-violet-300">
                {AGENT_LABELS[item.agent_id] ?? item.agent_id}
              </span>
            )}
          </div>

          {/* Description */}
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Description
            </p>
            <p className="leading-relaxed text-slate-300">{item.description}</p>
          </div>

          {/* Pillar */}
          {item.pillar_name && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                NAQAAE Pillar
              </p>
              <p className="text-slate-400">{item.pillar_name}</p>
            </div>
          )}

          {/* Source metadata */}
          {sm && Object.keys(sm).length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Source Data
              </p>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(sm).map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
                    <p className="text-[10px] text-slate-500 capitalize">
                      {k.replace(/_/g, " ")}
                    </p>
                    <p className="mt-0.5 font-medium text-slate-300">{String(v)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SwotItemChip({
  item,
  category,
}: {
  item: SwotItemDetail;
  category: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex items-center gap-1.5 rounded-full border px-2.5 py-1",
          "text-[11px] font-medium transition-colors text-left",
          SWOT_CHIP_STYLES[category] ?? "border-white/10 bg-white/5 text-slate-400"
        )}
      >
        <span className="max-w-[180px] truncate">{item.title}</span>
        <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-60" />
      </button>
      <SwotItemDetailDialog
        item={item}
        category={category}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

/** Renders a list of clickable chips when structured items exist, else falls back to plain text. */
function SwotItemList({
  items,
  fallbackText,
  category,
  textClassName,
}: {
  items?: SwotItemDetail[];
  fallbackText: string;
  category: string;
  textClassName?: string;
}) {
  if (items && items.length > 0) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <SwotItemChip key={item.item_id} item={item} category={category} />
        ))}
      </div>
    );
  }
  if (!fallbackText) return <p className="text-[11px] italic text-slate-600">None identified.</p>;
  return (
    <p className={cn("text-xs leading-relaxed", textClassName ?? "text-slate-400")}>
      {fallbackText}
    </p>
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
            <SwotItemList
              items={draft.strength_items}
              fallbackText={draft.strengths}
              category="strength"
            />
          </div>
          <div>
            <FieldLabel>Current Weaknesses</FieldLabel>
            <SwotItemList
              items={draft.weakness_items}
              fallbackText={draft.weaknesses}
              category="weakness"
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
  onSuggestionAdded,
}: {
  draft: PillarDraft;
  suggestions: GapCalculationResult[number]["suggestions"];
  index: number;
  onSuggestionAdded: (suggestion: GapSuggestion) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/5 bg-[#0d1117]">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-white/5 p-4">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-cyan-500/10 text-[11px] font-bold text-cyan-400">
          {index + 1}
        </span>
        <h3 className="text-sm font-semibold text-slate-100">{draft.pillar}</h3>
        {draft.swot_source === "live" && (
          <span className="ml-auto rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
            live data
          </span>
        )}
      </div>

      <div className="grid gap-0 md:grid-cols-2">
        {/* Left: compact input summary */}
        <div className="space-y-3 border-b border-white/5 p-4 md:border-b-0 md:border-r">
          <div>
            <FieldLabel>Target State</FieldLabel>
            <div className="relative max-h-72 overflow-y-auto rounded-lg border border-white/5 bg-white/[0.02] p-3 [scrollbar-width:thin] [scrollbar-color:#334155_transparent]">
              <ReactMarkdown
                components={{
                  h3: ({ children }) => (
                    <h3 className="mb-1 mt-3 text-[11px] font-semibold tracking-wide text-cyan-400 first:mt-0">
                      {children}
                    </h3>
                  ),
                  p: ({ children }) => (
                    <p className="mb-1.5 text-[11px] leading-relaxed text-slate-400">
                      {children}
                    </p>
                  ),
                  strong: ({ children }) => (
                    <strong className="font-semibold text-slate-300">
                      {children}
                    </strong>
                  ),
                  ul: ({ children }) => (
                    <ul className="mb-2 space-y-0.5 pl-3">{children}</ul>
                  ),
                  li: ({ children }) => (
                    <li className="flex gap-1.5 text-[11px] leading-relaxed text-slate-400">
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-slate-600" />
                      <span>{children}</span>
                    </li>
                  ),
                  hr: () => (
                    <hr className="my-2.5 border-white/5" />
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="mt-2 rounded border-l-2 border-amber-500/40 bg-amber-500/5 py-1.5 pl-3 text-[11px] leading-relaxed text-amber-300/70 italic">
                      {children}
                    </blockquote>
                  ),
                }}
              >
                {draft.target_state}
              </ReactMarkdown>
            </div>
          </div>
          <div>
            <FieldLabel>Strengths</FieldLabel>
            <SwotItemList
              items={draft.strength_items}
              fallbackText={draft.strengths}
              category="strength"
            />
          </div>
          <div>
            <FieldLabel>Weaknesses</FieldLabel>
            <SwotItemList
              items={draft.weakness_items}
              fallbackText={draft.weaknesses}
              category="weakness"
            />
          </div>
          {(draft.opportunity_items?.length || draft.opportunities) ? (
            <div>
              <FieldLabel>Opportunities</FieldLabel>
              <SwotItemList
                items={draft.opportunity_items}
                fallbackText={draft.opportunities ?? ""}
                category="opportunity"
              />
            </div>
          ) : null}
          {(draft.threat_items?.length || draft.threats) ? (
            <div>
              <FieldLabel>Threats</FieldLabel>
              <SwotItemList
                items={draft.threat_items}
                fallbackText={draft.threats ?? ""}
                category="threat"
              />
            </div>
          ) : null}
        </div>

        {/* Right: LLM suggestions + HITL add panel */}
        <div className="p-4">
          <div className="mb-3 flex items-center gap-1.5">
            <Lightbulb className="h-3.5 w-3.5 text-amber-400" />
            <FieldLabel>Improvement Suggestions</FieldLabel>
          </div>
          {suggestions.length === 0 ? (
            <p className="text-xs italic text-slate-600">No suggestions generated.</p>
          ) : (
            <ul className="space-y-4">
              {suggestions.map((s, i) => (
                <li
                  key={i}
                  className={cn(
                    "rounded-lg border p-3 text-xs",
                    s.is_user_added
                      ? "border-cyan-500/20 bg-cyan-500/5"
                      : "border-white/5 bg-white/[0.02]",
                  )}
                >
                  <div className="mb-1.5 flex items-center gap-2">
                    <p className="font-medium leading-relaxed text-slate-100">
                      {s.suggestion}
                    </p>
                    {s.is_user_added && (
                      <span className="shrink-0 rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium text-cyan-400">
                        You added
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed italic text-slate-500">
                    Gap: {s.gap_identified}
                  </p>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
                    {s.reasoning}
                  </p>
                </li>
              ))}
            </ul>
          )}

          <AddSuggestionPanel draft={draft} onApproved={onSuggestionAdded} />
        </div>
      </div>
    </div>
  );
}

// ── HITL: user-initiated suggestion panel ────────────────────────────────────

type AddPhase = "idle" | "generating" | "preview";

function AddSuggestionPanel({
  draft,
  onApproved,
}: {
  draft: PillarDraft;
  onApproved: (suggestion: GapSuggestion) => void;
}) {
  const [expanded, setExpanded]   = useState(false);
  const [phase, setPhase]         = useState<AddPhase>("idle");
  const [query, setQuery]         = useState("");
  const [pollTick, setPollTick]   = useState(0);
  const [generated, setGenerated] = useState<GapSuggestion | null>(null);
  const [error, setError]         = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!query.trim()) return;
    setPhase("generating");
    setPollTick(0);
    setError(null);
    try {
      const result = await suggestOne(draft, query.trim(), () =>
        setPollTick((t) => t + 1),
      );
      setGenerated(result);
      setPhase("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("idle");
    }
  };

  const handleApprove = async () => {
    if (!generated) return;
    try {
      await approveSuggestion({
        pillar_name:    draft.pillar,
        user_query:     query,
        suggestion:     generated.suggestion,
        reasoning:      generated.reasoning,
        gap_identified: generated.gap_identified,
      });
      onApproved({ ...generated, is_user_added: true });
      setQuery("");
      setGenerated(null);
      setPhase("idle");
      setExpanded(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDiscard = () => {
    setGenerated(null);
    setPhase("idle");
    setError(null);
  };

  return (
    <div className="mt-4 border-t border-white/5 pt-4">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setExpanded((p) => !p)}
        className="w-full justify-between border-dashed border-white/10 text-slate-400 hover:border-cyan-500/40 hover:text-cyan-400"
      >
        <span className="flex items-center gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add your own suggestion
        </span>
        {expanded
          ? <ChevronUp className="h-3.5 w-3.5" />
          : <ChevronDown className="h-3.5 w-3.5" />}
      </Button>

      {expanded && (
        <div className="mt-3 space-y-3">
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Describe your improvement intent
            </p>
            <textarea
              rows={3}
              disabled={phase === "generating"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`e.g. "We should implement a mid-semester feedback loop between faculty and students"`}
              className={cn(
                "w-full resize-none rounded-lg border border-white/10 bg-[#0d1117] px-3 py-2.5",
                "text-xs text-slate-200 placeholder-slate-600 outline-none",
                "transition-colors focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            />
          </div>

          {phase !== "preview" && (
            <Button
              size="sm"
              disabled={phase === "generating" || !query.trim()}
              onClick={handleGenerate}
            >
              {phase === "generating" ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Generating… (poll #{pollTick})
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  Generate suggestion
                </>
              )}
            </Button>
          )}

          {error && (
            <p className="text-[11px] text-rose-400">{error}</p>
          )}

          {phase === "preview" && generated && (
            <div className="space-y-2 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3 text-xs">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-cyan-400">
                Review before approving
              </p>
              <p className="font-medium leading-relaxed text-slate-100">
                {generated.suggestion}
              </p>
              <p className="text-[11px] leading-relaxed italic text-slate-500">
                Gap: {generated.gap_identified}
              </p>
              <p className="text-[11px] leading-relaxed text-slate-400">
                {generated.reasoning}
              </p>
              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={handleApprove}>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Approve &amp; save
                </Button>
                <Button size="sm" variant="outline" onClick={handleDiscard}>
                  <X className="h-3.5 w-3.5" />
                  Discard
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
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

  // ── Append a user-added suggestion to the correct pillar in results ──────────
  const handleSuggestionAdded = useCallback(
    (pillar: string, suggestion: GapSuggestion) => {
      setResults((prev) =>
        prev.map((r) =>
          r.pillar === pillar
            ? { ...r, suggestions: [...r.suggestions, suggestion] }
            : r,
        ),
      );
    },
    [],
  );

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
                    onSuggestionAdded={(s) => handleSuggestionAdded(r.pillar, s)}
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
