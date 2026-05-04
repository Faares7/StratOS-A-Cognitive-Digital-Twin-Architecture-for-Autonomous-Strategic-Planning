"use client";

import React, { useState } from "react";
import { Sparkles, Filter, Loader2, Play } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { useSWOT } from "@/hooks/useSWOT";
import { NAQAAE_PILLARS } from "@/types";
import type { InsightCard, SwotCategory, NaqaaePillar } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Target, AlertTriangle, FileText, Eye } from "lucide-react";

// ── Category config ────────────────────────────────────────────────────────────
const CAT = {
  strength: { label: "Strengths", icon: TrendingUp, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", badge: "strength" as const },
  weakness: { label: "Weaknesses", icon: TrendingDown, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20", badge: "weakness" as const },
  opportunity: { label: "Opportunities", icon: Target, color: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/20", badge: "opportunity" as const },
  threat: { label: "Threats", icon: AlertTriangle, color: "text-rose-400", bg: "bg-rose-500/10", border: "border-rose-500/20", badge: "threat" as const },
};

// ── Evidence dialog ────────────────────────────────────────────────────────────
function EvidenceDialog({ card, open, onClose }: { card: InsightCard; open: boolean; onClose: () => void }) {
  const { evidence } = card;
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Evidence: {card.title}</DialogTitle>
          <DialogDescription>
            AI calculation and source data that generated this insight
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Type badge */}
          <div className="flex items-center gap-2">
            <Badge variant="default" className="capitalize">
              {evidence.type.replace("_", " ")}
            </Badge>
            {evidence.source_document && (
              <span className="flex items-center gap-1 text-xs text-slate-500">
                <FileText className="h-3 w-3" />
                {evidence.source_document}
              </span>
            )}
          </div>

          {/* Formula */}
          {evidence.formula && (
            <div className="rounded-lg bg-slate-900 px-4 py-3 font-mono text-xs text-cyan-300">
              {evidence.formula}
            </div>
          )}

          {/* Explanation */}
          <div className="rounded-lg bg-white/5 px-4 py-3 text-sm text-slate-300 leading-relaxed">
            {evidence.explanation}
          </div>

          {/* Data points */}
          {evidence.data_points && Object.keys(evidence.data_points).length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-slate-500 uppercase tracking-wider">Raw Data Points</p>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(evidence.data_points).map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-white/5 px-3 py-2">
                    <p className="text-[10px] text-slate-500">{k.replace(/_/g, " ")}</p>
                    <p className="font-mono text-sm font-semibold text-slate-200">{String(v)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Confidence */}
          <div className="flex items-center justify-between rounded-lg bg-white/5 px-4 py-2">
            <span className="text-xs text-slate-500">AI Confidence</span>
            <span className="flex items-center gap-1 text-sm font-semibold text-cyan-400">
              <Sparkles className="h-3 w-3" />
              {card.confidence_score}%
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Insight card ───────────────────────────────────────────────────────────────
function InsightCardComponent({ card }: { card: InsightCard }) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const cfg = CAT[card.category];
  const Icon = cfg.icon;
  const impactVariant: Record<string, "critical" | "high" | "medium" | "low"> = {
    critical: "critical", high: "high", medium: "medium", low: "low",
  };

  return (
    <>
      <div
        className={cn(
          "flex flex-col gap-3 rounded-xl border p-4 transition-all hover:shadow-card-hover",
          cfg.border,
          "bg-[#0d1117]"
        )}
      >
        {/* Top row */}
        <div className="flex items-start justify-between gap-2">
          <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", cfg.bg)}>
            <Icon className={cn("h-3.5 w-3.5", cfg.color)} />
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {card.data_source === "mock" && <Badge variant="mock">Mock</Badge>}
            <Badge variant={impactVariant[card.impact_level] ?? "low"} className="capitalize">
              {card.impact_level}
            </Badge>
          </div>
        </div>

        {/* Title & description */}
        <div>
          <h4 className="text-sm font-semibold text-slate-100">{card.title}</h4>
          <p className="mt-1 text-xs text-slate-500 leading-relaxed">{card.description}</p>
        </div>

        {/* Pillar tag */}
        <div className="flex flex-wrap gap-1">
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-slate-500">
            {card.pillar_tag}
          </span>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/5 pt-2">
          <div className="flex items-center gap-3 text-[10px] text-slate-600">
            <span className="flex items-center gap-1">
              <FileText className="h-3 w-3" />
              {card.reference_count} refs
            </span>
            <span className="flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              {card.confidence_score}% confidence
            </span>
          </div>
          <button
            onClick={() => setEvidenceOpen(true)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-cyan-400 transition-colors hover:bg-cyan-500/10"
          >
            <Eye className="h-3 w-3" />
            View Evidence
          </button>
        </div>
      </div>

      <EvidenceDialog card={card} open={evidenceOpen} onClose={() => setEvidenceOpen(false)} />
    </>
  );
}

// ── Column ─────────────────────────────────────────────────────────────────────
function SwotColumn({ category, items }: { category: SwotCategory; items: InsightCard[] }) {
  const cfg = CAT[category];
  const Icon = cfg.icon;

  return (
    <div className="flex flex-col gap-3">
      {/* Column header */}
      <div className={cn("flex items-center gap-2 rounded-lg px-3 py-2", cfg.bg, "border", cfg.border)}>
        <Icon className={cn("h-4 w-4", cfg.color)} />
        <span className={cn("text-sm font-semibold", cfg.color)}>{cfg.label}</span>
        <span className="ml-auto rounded-full bg-black/20 px-2 py-0.5 text-xs font-bold text-slate-400">
          {items.length}
        </span>
      </div>
      {/* Cards */}
      {items.map((card) => (
        <InsightCardComponent key={card.id} card={card} />
      ))}
      {items.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 py-8">
          <p className="text-xs text-slate-600">No insights yet</p>
          <p className="text-[10px] text-slate-700">Run an agent above to generate live insights</p>
        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function SWOTPage() {
  const {
    byCategory, loading, error,
    pillarFilter, setPillarFilter, categoryFilter, setCategoryFilter,
    runAgent, agentRunning, agentError,
  } = useSWOT();

  const totalInsights = Object.values(byCategory).flat().length;

  return (
    <div className="flex min-h-full flex-col">
      <Header title="SWOT Analysis" subtitle="AI-powered strategic insights validated against research data" />

      <div className="flex flex-col gap-5 p-6">
        {/* Live Agent Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              { name: "tech" as const, label: "Tech Intelligence", hint: "GitHub · CISA · Jobs" },
              { name: "workforce" as const, label: "Workforce Analysis", hint: "HR metrics · Gemini" },
              { name: "sentiment" as const, label: "Sentiment Analysis", hint: "Student feedback · Ollama" },
              { name: "social" as const, label: "Social Media Analysis", hint: "Facebook groups · Groq" },
            ] as const
          ).map(({ name, label, hint }) => {
            const running = agentRunning === name;
            return (
              <button
                key={name}
                onClick={() => runAgent(name)}
                disabled={agentRunning !== null}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-all",
                  running
                    ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                    : "border-white/10 bg-white/5 text-slate-400 hover:border-cyan-500/30 hover:text-slate-200 disabled:opacity-40"
                )}
              >
                {running ? (
                  <Loader2 className="h-3 w-3 animate-spin text-cyan-400" />
                ) : (
                  <Play className="h-3 w-3" />
                )}
                <span className="font-medium">{label}</span>
                <span className="text-slate-600">{hint}</span>
              </button>
            );
          })}
        </div>

        {/* Agent error banner */}
        {agentError && (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-xs text-rose-400">
            <span className="font-semibold">Agent error: </span>{agentError}
          </div>
        )}

        {/* Filters + summary bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Summary counts */}
          <div className="flex items-center gap-4">
            {(["strength", "weakness", "opportunity", "threat"] as SwotCategory[]).map((cat) => {
              const cfg = CAT[cat];
              const count = byCategory[cat].length;
              return (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(categoryFilter === cat ? "all" : cat)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 py-2 transition-all",
                    categoryFilter === cat ? cn(cfg.bg, cfg.border) : "border-white/5 bg-[#0d1117] hover:bg-white/5"
                  )}
                >
                  <span className="text-lg font-bold text-slate-100">{count}</span>
                  <div>
                    <p className={cn("text-[10px] font-medium", cfg.color)}>{cfg.label}</p>
                    {count > 0 && (
                      <p className="text-[9px] text-slate-600">
                        {byCategory[cat].filter((i) => i.data_source === "mock").length > 0 ? "Mock" : "Live"}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Pillar filter */}
          <div className="flex items-center gap-2">
            <Filter className="h-3.5 w-3.5 text-slate-500" />
            <Select
              value={pillarFilter}
              onValueChange={(v) => setPillarFilter(v as NaqaaePillar | "all")}
            >
              <SelectTrigger className="w-60">
                <SelectValue placeholder="Filter by Pillar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Pillars ({totalInsights})</SelectItem>
                {NAQAAE_PILLARS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {loading && (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="skeleton h-36 rounded-xl" />
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-400">
            {error}
          </div>
        )}

        {!loading && !error && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(["strength", "weakness", "opportunity", "threat"] as SwotCategory[]).map((cat) => (
              <SwotColumn key={cat} category={cat} items={byCategory[cat]} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
