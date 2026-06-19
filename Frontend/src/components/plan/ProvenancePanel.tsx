"use client";

import { X, Cpu, BookOpen, User, Layers, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { Provenance, AgentProvenance, ReferencePlanProvenance } from "@/types/plan-document";

// ── Describe helper (also exported for template-preview) ─────────────────────

export function describeProvenance(p: Provenance): string {
  switch (p.kind) {
    case "agent_signal":
      return (
        `From the ${p.agent} agent via ${p.source}: "${p.finding}"` +
        (p.confidence != null ? ` (confidence ${p.confidence}%)` : "")
      );
    case "reference_plan":
      return (
        `Based on ${p.planTitle} — "${p.sectionHeading}"` +
        (p.page ? `, p.${p.page}` : "")
      );
    case "human":
      return "Written by you";
    case "mixed":
      return `Synthesised from ${p.sources.length} source${p.sources.length !== 1 ? "s" : ""}`;
  }
}

// ── Individual provenance type renderers ─────────────────────────────────────

function AgentDetail({ p }: { p: AgentProvenance }) {
  const [expanded, setExpanded] = useState(false);
  const catColor: Record<string, string> = {
    strength: "text-emerald-400",
    weakness: "text-amber-400",
    opportunity: "text-cyan-400",
    threat: "text-rose-400",
  };

  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.03] p-3 space-y-2">
      <div className="flex items-start gap-2">
        <Cpu className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-400" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-300 capitalize">{p.agent} Agent</span>
            {p.category && (
              <span className={`text-[10px] font-medium uppercase tracking-wide ${catColor[p.category] ?? "text-slate-400"}`}>
                {p.category}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-300 leading-relaxed">"{p.finding}"</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-[10px] text-slate-500">
        <span>Source: <span className="text-slate-400">{p.source}</span></span>
        {p.confidence != null && (
          <span>Confidence: <span className="text-slate-400">{p.confidence}%</span></span>
        )}
        {p.pillarTag && (
          <span className="text-slate-400">{p.pillarTag}</span>
        )}
      </div>

      {p.evidence && Object.keys(p.evidence).length > 0 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Raw evidence
        </button>
      )}
      {expanded && p.evidence && (
        <pre className="text-[10px] text-slate-400 bg-black/20 rounded p-2 overflow-x-auto">
          {JSON.stringify(p.evidence, null, 2)}
        </pre>
      )}
    </div>
  );
}

function RefPlanDetail({ p }: { p: ReferencePlanProvenance }) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.03] p-3 space-y-1">
      <div className="flex items-start gap-2">
        <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-400" />
        <div className="min-w-0">
          <span className="text-xs font-semibold text-slate-300">{p.planTitle}</span>
          <p className="mt-0.5 text-xs text-slate-400">
            "{p.sectionHeading}"{p.page ? `, p. ${p.page}` : ""}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

interface ProvenancePanelProps {
  provenance: Provenance | null;
  blockId?: string | null;
  onClose?: () => void;
}

export function ProvenancePanel({ provenance, blockId, onClose }: ProvenancePanelProps) {
  return (
    <aside className="flex w-72 shrink-0 flex-col border-s border-white/5 bg-[#0b0e1a]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
          Source / XAI
        </span>
        {onClose && (
          <button
            onClick={onClose}
            className="flex h-5 w-5 items-center justify-center rounded text-slate-600 hover:text-slate-400 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {!provenance ? (
          <div className="mt-8 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-white/5">
              <Layers className="h-5 w-5 text-slate-600" />
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Click any block in the document to trace its source.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {blockId && (
              <p className="text-[10px] font-mono text-slate-600 truncate">{blockId}</p>
            )}

            {/* Quick summary */}
            <div className="rounded-lg bg-white/[0.04] p-3">
              <p className="text-xs text-slate-300 leading-relaxed">
                {describeProvenance(provenance)}
              </p>
            </div>

            {/* Detail by type */}
            {provenance.kind === "agent_signal" && (
              <AgentDetail p={provenance} />
            )}
            {provenance.kind === "reference_plan" && (
              <RefPlanDetail p={provenance} />
            )}
            {provenance.kind === "human" && (
              <div className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.03] p-3">
                <User className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="text-xs text-slate-400">Written by you</span>
              </div>
            )}
            {provenance.kind === "mixed" && (
              <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">
                  {provenance.sources.length} sources
                </p>
                {provenance.sources.map((s, i) => (
                  <div key={i}>
                    {s.kind === "agent_signal" && <AgentDetail p={s} />}
                    {s.kind === "reference_plan" && <RefPlanDetail p={s} />}
                    {s.kind === "human" && (
                      <div className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.03] p-3">
                        <User className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className="text-xs text-slate-400">Written by you</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
