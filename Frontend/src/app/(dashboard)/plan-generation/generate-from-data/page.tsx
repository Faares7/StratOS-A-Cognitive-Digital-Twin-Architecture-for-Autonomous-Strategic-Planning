"use client";

/**
 * /plan-generation/generate-from-data
 *
 * Three phases in one page:
 *   1. IDLE      — "Generate" button + LLM toggle.
 *   2. RUNNING   — polls /api/jobs/{id} and shows live progress.
 *   3. DONE      — renders the plan with formal-gov Template +
 *                  provenance side-panel; "Open in editor" navigates to /editor.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles, CheckCircle2, AlertCircle, Loader2,
  ArrowLeft, ExternalLink, Info, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Template } from "@/templates/plan/formal-gov/Template";
import { describeProvenance, findBlockProvenance, findBlockHeading } from "@/lib/provenanceUtils";
import type { PlanDocument, Provenance } from "@/types/plan-document";

// ── Types ──────────────────────────────────────────────────────────────────────

type Phase = "idle" | "running" | "done" | "error";

interface JobResult {
  status: "running" | "complete" | "failed";
  result?: { plan_id?: string };
  error?:  string;
}

// ── Provenance side-panel ──────────────────────────────────────────────────────

function ProvenancePanel({
  blockId,
  doc,
  onClose,
}: {
  blockId: string;
  doc:     PlanDocument;
  onClose: () => void;
}) {
  const prov    = findBlockProvenance(doc, blockId);
  const heading = findBlockHeading(doc, blockId);

  if (!prov) return null;

  const sources: Provenance[] =
    prov.kind === "mixed" ? (prov.sources as Provenance[]) : [prov];

  return (
    <div
      className="flex flex-col gap-4 overflow-y-auto rounded-xl border border-white/10 bg-[#0e1120] p-5 shadow-2xl"
      style={{ width: 320, flexShrink: 0 }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            Source · XAI
          </p>
          {heading && (
            <p className="mt-0.5 text-xs font-medium text-slate-300 leading-snug">
              {heading}
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded p-1 text-slate-500 hover:bg-white/5 hover:text-slate-300 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Source list */}
      <div className="flex flex-col gap-3">
        {sources.map((src, i) => (
          <SourceCard key={i} prov={src} />
        ))}
      </div>
    </div>
  );
}

function SourceCard({ prov }: { prov: Provenance }) {
  const [expanded, setExpanded] = useState(false);

  if (prov.kind === "agent_signal") {
    const catColor: Record<string, string> = {
      strength:    "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
      weakness:    "text-rose-400   bg-rose-500/10    border-rose-500/30",
      opportunity: "text-cyan-400   bg-cyan-500/10    border-cyan-500/30",
      threat:      "text-amber-400  bg-amber-500/10   border-amber-500/30",
    };
    const catCls = prov.category ? catColor[prov.category] : "text-violet-400 bg-violet-500/10 border-violet-500/30";

    return (
      <div className="rounded-lg border border-white/8 bg-white/3 p-3 text-xs">
        <div className="flex flex-wrap gap-1.5 mb-2">
          <span className="rounded-full border bg-cyan-500/10 border-cyan-500/20 text-cyan-400 px-2 py-0.5 text-[10px] font-semibold">
            {prov.agent}
          </span>
          {prov.category && (
            <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", catCls)}>
              {prov.category}
            </span>
          )}
          {prov.pillarTag && (
            <span className="rounded-full border border-white/10 bg-white/5 text-slate-400 px-2 py-0.5 text-[10px]">
              {prov.pillarTag}
            </span>
          )}
        </div>
        <p className="text-slate-300 leading-relaxed">
          <span className="text-slate-500 font-medium">Source: </span>
          {prov.source}
        </p>
        <p className="mt-1.5 text-slate-400 leading-relaxed italic">
          &ldquo;{prov.finding}&rdquo;
        </p>
        {prov.evidence && Object.keys(prov.evidence).length > 0 && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="mt-2 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
          >
            {expanded ? "Hide evidence ▲" : "Show evidence ▼"}
          </button>
        )}
        {expanded && prov.evidence && (
          <pre className="mt-2 max-h-40 overflow-y-auto rounded bg-black/20 p-2 text-[10px] text-slate-400 whitespace-pre-wrap">
            {JSON.stringify(prov.evidence, null, 2)}
          </pre>
        )}
      </div>
    );
  }

  if (prov.kind === "reference_plan") {
    return (
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs">
        <p className="font-semibold text-amber-400 mb-1">Reference plan</p>
        <p className="text-slate-300">{prov.planTitle}</p>
        <p className="text-slate-500 mt-0.5">
          &ldquo;{prov.sectionHeading}&rdquo;
          {prov.page ? `, p. ${prov.page}` : ""}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-white/8 bg-white/3 p-3 text-xs text-slate-400">
      {describeProvenance(prov)}
    </div>
  );
}

// ── Step indicator ─────────────────────────────────────────────────────────────

const STEPS = [
  "Loading source data",
  "Building carryover sections",
  "Building environmental analysis (SWOT + Gap)",
  "Building strategic goals",
  "Building implementation plan",
  "Generating section intros (LLM)",
  "Assembling & storing document",
];

function StepIndicator({ elapsed }: { elapsed: number }) {
  const step = Math.min(Math.floor(elapsed / 8), STEPS.length - 1);
  return (
    <div className="flex flex-col gap-2 w-full max-w-md">
      {STEPS.map((label, i) => {
        const done    = i < step;
        const current = i === step;
        return (
          <div key={i} className="flex items-center gap-3">
            <div className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition-colors",
              done    ? "bg-emerald-500/20 text-emerald-400" :
              current ? "bg-[#b8922f]/20 text-[#b8922f] ring-1 ring-[#b8922f]/40" :
                        "bg-white/5 text-slate-600",
            )}>
              {done ? "✓" : i + 1}
            </div>
            <span className={cn(
              "text-xs transition-colors",
              done    ? "text-emerald-500" :
              current ? "text-slate-200"  : "text-slate-600",
            )}>
              {label}
            </span>
            {current && (
              <Loader2 className="h-3 w-3 text-[#b8922f] animate-spin ml-auto" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function GenerateFromDataPage() {
  const router = useRouter();

  const [phase,   setPhase]   = useState<Phase>("idle");
  const [useLlm,  setUseLlm]  = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [plan,    setPlan]     = useState<PlanDocument | null>(null);
  const [planId,  setPlanId]   = useState<string | null>(null);
  const [elapsed, setElapsed]  = useState(0);
  const [selBlock, setSelBlock] = useState<string | null>(null);

  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopAll = () => {
    if (timerRef.current)  { clearInterval(timerRef.current);  timerRef.current  = null; }
    if (pollRef.current)   { clearInterval(pollRef.current);   pollRef.current   = null; }
  };
  useEffect(() => () => stopAll(), []);

  // ── Generate ──────────────────────────────────────────────────────────────

  const startGeneration = useCallback(async () => {
    stopAll();
    setPhase("running");
    setError(null);
    setPlan(null);
    setPlanId(null);
    setElapsed(0);
    setSelBlock(null);

    // Elapsed timer for the step indicator
    timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);

    let jobId: string;
    try {
      const res = await fetch("/api/plan-generation/generate", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ use_llm: useLlm }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      ({ job_id: jobId } = await res.json());
    } catch (err: unknown) {
      stopAll();
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
      return;
    }

    // Poll the job
    pollRef.current = setInterval(async () => {
      try {
        const job: JobResult = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" })
          .then(r => r.json());

        if (job.status === "complete") {
          stopAll();
          const pid = job.result?.plan_id ?? null;
          if (!pid) { setError("Job completed but no plan_id returned"); setPhase("error"); return; }
          setPlanId(pid);
          // Load the document
          const planRes = await fetch(`/api/plan-generation/${pid}`, { cache: "no-store" });
          if (!planRes.ok) throw new Error(`Plan fetch failed: ${planRes.status}`);
          const row = await planRes.json();
          if (!row.document?.chapters) throw new Error("Invalid document received");
          setPlan(row.document as PlanDocument);
          setPhase("done");
        } else if (job.status === "failed") {
          stopAll();
          setError(job.error ?? "Generation failed");
          setPhase("error");
        }
      } catch (err: unknown) {
        // Transient poll error — keep polling
        console.warn("[generate] poll error:", err);
      }
    }, 2500);
  }, [useLlm]);

  // ── Open in editor ────────────────────────────────────────────────────────

  const openInEditor = () => {
    if (!planId || !plan) return;
    try {
      // Store the plan document in localStorage so the editor picks it up
      localStorage.setItem(`stratos-plan-draft-v2-en`, JSON.stringify(plan));
      sessionStorage.setItem("plan-editor-init", JSON.stringify({ kind: "recent", lang: "en" }));
    } catch { /* ignore quota errors */ }
    router.push("/plan-generation/editor");
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#0b0e1a]">

      {/* Top bar */}
      <div className="shrink-0 flex items-center gap-3 border-b border-white/5 bg-[#080a16] px-6 py-3">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <div className="h-4 w-px bg-white/10" />
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[#b8922f]" />
          <span className="text-sm font-semibold text-slate-200">Generate Plan from Agent Data</span>
        </div>

        {phase === "done" && planId && (
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={openInEditor}
              className="flex items-center gap-1.5 rounded-lg bg-[#b8922f]/15 border border-[#b8922f]/30 px-3 py-1.5 text-xs font-semibold text-[#b8922f] hover:bg-[#b8922f]/25 transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open in editor
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── IDLE ── */}
        {phase === "idle" && (
          <div className="flex flex-1 items-center justify-center p-12">
            <div className="flex flex-col items-center gap-8 max-w-md text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#b8922f]/10 border border-[#b8922f]/20">
                <Sparkles className="h-8 w-8 text-[#b8922f]" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">
                  Generate Strategic Plan
                </h2>
                <p className="text-sm text-slate-500 leading-relaxed">
                  Assembles a complete PlanDocument from SWOT, Gap Analysis, Goals,
                  and Implementation Plan agent data — with full provenance on every block.
                </p>
              </div>

              {/* LLM toggle */}
              <label className="flex items-center gap-3 cursor-pointer group">
                <div
                  onClick={() => setUseLlm(v => !v)}
                  className={cn(
                    "relative h-5 w-9 rounded-full transition-colors",
                    useLlm ? "bg-[#b8922f]" : "bg-white/10",
                  )}
                >
                  <div className={cn(
                    "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                    useLlm ? "translate-x-4" : "translate-x-0.5",
                  )} />
                </div>
                <span className="text-sm text-slate-400 group-hover:text-slate-300 transition-colors">
                  LLM section intros (Gemini 2.5 Flash)
                </span>
              </label>

              <div className="flex items-start gap-2 rounded-lg border border-white/5 bg-white/3 p-4 text-left">
                <Info className="h-4 w-4 shrink-0 text-slate-500 mt-0.5" />
                <p className="text-xs text-slate-500 leading-relaxed">
                  The pipeline always completes even if the LLM is unavailable — agent
                  data is assembled deterministically first.
                </p>
              </div>

              <button
                onClick={startGeneration}
                className="flex items-center gap-2 rounded-xl bg-[#b8922f] px-8 py-3 text-sm font-semibold text-[#0b0e1a] hover:bg-[#c9a340] transition-colors shadow-lg shadow-[#b8922f]/20"
              >
                <Sparkles className="h-4 w-4" />
                Generate Plan
              </button>
            </div>
          </div>
        )}

        {/* ── RUNNING ── */}
        {phase === "running" && (
          <div className="flex flex-1 items-center justify-center p-12">
            <div className="flex flex-col items-center gap-8 max-w-md w-full">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#b8922f]/10 border border-[#b8922f]/20">
                <Loader2 className="h-6 w-6 text-[#b8922f] animate-spin" />
              </div>
              <div className="text-center">
                <h2 className="text-base font-semibold text-slate-100 mb-1">
                  Building your plan…
                </h2>
                <p className="text-xs text-slate-500">
                  {elapsed < 10
                    ? "Fetching agent data from the database"
                    : elapsed < 60
                    ? "Assembling sections and provenance"
                    : "Running LLM intro passes (may take a moment)"}
                </p>
              </div>
              <StepIndicator elapsed={elapsed} />
            </div>
          </div>
        )}

        {/* ── ERROR ── */}
        {phase === "error" && (
          <div className="flex flex-1 items-center justify-center p-12">
            <div className="flex flex-col items-center gap-6 max-w-lg text-center">
              <AlertCircle className="h-12 w-12 text-rose-500" />
              <div>
                <h2 className="text-base font-semibold text-slate-100 mb-2">Generation failed</h2>
                <pre className="text-xs text-rose-400 bg-rose-500/5 border border-rose-500/20 rounded-lg p-4 text-left whitespace-pre-wrap max-h-60 overflow-y-auto">
                  {error}
                </pre>
              </div>
              <button
                onClick={() => setPhase("idle")}
                className="rounded-lg border border-white/10 px-5 py-2 text-xs text-slate-300 hover:bg-white/5 transition-colors"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {/* ── DONE — plan viewer ── */}
        {phase === "done" && plan && (
          <>
            {/* Plan canvas */}
            <div className="relative flex-1 overflow-y-auto bg-[#f5f4ef]">
              <div className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 border-b border-emerald-500/20">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                <p className="text-xs text-emerald-400 font-medium">
                  Plan generated successfully · Click any block to inspect its source
                </p>
              </div>
              <Template
                doc={plan}
                mode="view"
                onSelectBlock={id => setSelBlock(prev => prev === id ? null : id)}
              />
            </div>

            {/* Provenance panel */}
            {selBlock && (
              <div className="shrink-0 overflow-y-auto border-l border-white/5 p-4 bg-[#0b0e1a]"
                   style={{ width: 340 }}>
                <ProvenancePanel
                  blockId={selBlock}
                  doc={plan}
                  onClose={() => setSelBlock(null)}
                />
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
}
