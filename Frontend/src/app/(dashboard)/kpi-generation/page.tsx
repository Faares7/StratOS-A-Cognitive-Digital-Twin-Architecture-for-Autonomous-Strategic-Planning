"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Gauge,
  Loader2,
  Sparkles,
  Target,
  Building2,
  GraduationCap,
  CalendarRange,
  AlertTriangle,
  CheckCircle2,
  Clock,
  UserCog,
  ListChecks,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ── Backend contract ────────────────────────────────────────────────────────────

const BACKEND = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
).replace(/\/$/, "");

const POLL_INTERVAL_MS = 5_000; // poll /api/jobs every 5 seconds
const POLL_TIMEOUT_MS = 180_000; // give up after 3 minutes

interface KPIItem {
  standard_id: string;
  kpi_name: string;
  target_description: string;
  responsible_entity: string;
  timeframe: string;
}

interface KPIMetadata {
  program: string;
  college: string;
  university: string;
  planning_horizon: string;
  kpis_per_standard: number;
  total_kpis: number;
  standards_covered: string[];
}

interface KPIResult {
  kpis: KPIItem[];
  metadata: KPIMetadata;
}

type Phase = "idle" | "running" | "complete" | "failed";

// ── The 7 NAQAAE Programmatic Standards ─────────────────────────────────────────

const STANDARDS: Record<string, { ar: string; en: string }> = {
  "1": { ar: "رسالة وإدارة البرنامج", en: "Mission & Management" },
  "2": { ar: "تصميم البرنامج", en: "Program Design" },
  "3": { ar: "التعليم والتعلم والتقييم", en: "Teaching, Learning & Assessment" },
  "4": { ar: "الطلاب والخريجون", en: "Students & Graduates" },
  "5": { ar: "أعضاء هيئة التدريس والهيئة المعاونة", en: "Faculty & Supporting Staff" },
  "6": { ar: "الموارد ومصادر التعلم والتسهيلات الداعمة", en: "Resources & Facilities" },
  "7": { ar: "ضمان الجودة وتقييم البرنامج", en: "Quality Assurance & Evaluation" },
};

const STANDARD_ORDER = ["1", "2", "3", "4", "5", "6", "7"];

// ── Section label ───────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
      {children}
    </p>
  );
}

// ── 1. Configuration Panel ──────────────────────────────────────────────────────

interface ConfigPanelProps {
  kpisPerStandard: number;
  setKpisPerStandard: (v: number) => void;
  program: string;
  setProgram: (v: string) => void;
  college: string;
  setCollege: (v: string) => void;
  university: string;
  setUniversity: (v: string) => void;
  planningHorizon: string;
  setPlanningHorizon: (v: string) => void;
  onGenerate: () => void;
  isRunning: boolean;
}

function ConfigPanel({
  kpisPerStandard,
  setKpisPerStandard,
  program,
  setProgram,
  college,
  setCollege,
  university,
  setUniversity,
  planningHorizon,
  setPlanningHorizon,
  onGenerate,
  isRunning,
}: ConfigPanelProps) {
  const clamp = (n: number) => Math.min(7, Math.max(1, n));

  return (
    <div className="flex flex-col gap-5 rounded-xl border border-white/5 bg-[#0d1117] p-5">
      <div>
        <h3 className="text-sm font-semibold text-slate-200">KPI Configuration</h3>
        <p className="mt-0.5 text-xs text-slate-500">
          Draft NAQAAE-aligned KPIs across all 7 programmatic standards.
        </p>
      </div>

      {/* KPIs per standard — slider + numeric */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <SectionLabel>KPIs per Standard</SectionLabel>
          <span className="text-xs font-medium text-slate-400">
            {kpisPerStandard * 7} total
          </span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={7}
            step={1}
            value={kpisPerStandard}
            onChange={(e) => setKpisPerStandard(clamp(Number(e.target.value)))}
            disabled={isRunning}
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-white/10 accent-cyan-500 disabled:opacity-50"
          />
          <Input
            type="number"
            min={1}
            max={7}
            value={kpisPerStandard}
            disabled={isRunning}
            onChange={(e) => setKpisPerStandard(clamp(Number(e.target.value)))}
            className="w-16 text-center"
          />
        </div>
        <p className="text-[11px] leading-relaxed text-slate-600">
          Generates {kpisPerStandard} KPI{kpisPerStandard === 1 ? "" : "s"} for each of
          the 7 standards.
        </p>
      </div>

      {/* Program context */}
      <div className="space-y-3 border-t border-white/5 pt-4">
        <SectionLabel>Program Context</SectionLabel>

        <div className="space-y-1.5">
          <span className="text-[10px] text-slate-500">Program</span>
          <Input
            dir="rtl"
            value={program}
            disabled={isRunning}
            onChange={(e) => setProgram(e.target.value)}
            placeholder="علوم الحاسب"
          />
        </div>

        <div className="space-y-1.5">
          <span className="text-[10px] text-slate-500">College</span>
          <Input
            dir="rtl"
            value={college}
            disabled={isRunning}
            onChange={(e) => setCollege(e.target.value)}
            placeholder="كلية تكنولوجيا المعلومات وعلوم الحاسب"
          />
        </div>

        <div className="space-y-1.5">
          <span className="text-[10px] text-slate-500">University</span>
          <Input
            dir="rtl"
            value={university}
            disabled={isRunning}
            onChange={(e) => setUniversity(e.target.value)}
            placeholder="جامعة النيل الأهلية"
          />
        </div>

        <div className="space-y-1.5">
          <span className="text-[10px] text-slate-500">Planning Horizon</span>
          <Input
            value={planningHorizon}
            disabled={isRunning}
            onChange={(e) => setPlanningHorizon(e.target.value)}
            placeholder="2025-2028"
          />
        </div>
      </div>

      <Button
        onClick={onGenerate}
        disabled={isRunning}
        className="mt-auto w-full gap-2 font-semibold"
      >
        {isRunning ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Generating…
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" />
            Generate KPIs
          </>
        )}
      </Button>
    </div>
  );
}

// ── 2. Metadata summary header ──────────────────────────────────────────────────

function MetadataHeader({ meta }: { meta: KPIMetadata }) {
  const items = [
    { icon: GraduationCap, label: "Program", value: meta.program, rtl: true },
    { icon: Building2, label: "College", value: meta.college, rtl: true },
    { icon: Target, label: "University", value: meta.university, rtl: true },
    { icon: CalendarRange, label: "Horizon", value: meta.planning_horizon, rtl: false },
  ];

  return (
    <div className="rounded-xl border border-cyan-500/15 bg-gradient-to-br from-cyan-500/[0.07] to-transparent p-5 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/15">
            <CheckCircle2 className="h-5 w-5 text-cyan-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-100">KPI Plan Generated</h3>
            <p className="text-xs text-slate-500">
              Planning phase draft — review before assigning data sources
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="live" className="gap-1.5 px-3 py-1">
            <ListChecks className="h-3.5 w-3.5" />
            {meta.total_kpis} KPIs
          </Badge>
          <Badge variant="default" className="px-3 py-1">
            {meta.standards_covered.length}/7 standards
          </Badge>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {items.map(({ icon: Icon, label, value, rtl }) => (
          <div
            key={label}
            className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2.5"
          >
            <div className="flex items-center gap-1.5">
              <Icon className="h-3 w-3 text-slate-500" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {label}
              </span>
            </div>
            <p
              dir={rtl ? "rtl" : "ltr"}
              className={cn(
                "mt-1 truncate text-sm font-medium text-slate-200",
                rtl && "text-right"
              )}
              title={value}
            >
              {value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 3. KPI card (RTL Arabic content) ────────────────────────────────────────────

function KPICard({ kpi, index }: { kpi: KPIItem; index: number }) {
  return (
    <div
      dir="rtl"
      className="rounded-xl border border-white/5 bg-white/[0.02] p-4 text-right transition-colors hover:border-cyan-500/20"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-cyan-500/10 text-[11px] font-bold text-cyan-400">
          {index}
        </span>
        <p className="flex-1 text-sm font-semibold leading-relaxed text-slate-100">
          {kpi.kpi_name}
        </p>
      </div>

      {/* Target */}
      <div className="mt-3 rounded-lg border border-emerald-500/15 bg-emerald-500/[0.06] px-3 py-2">
        <span className="text-[10px] font-semibold text-emerald-400/80">المستهدف</span>
        <p className="mt-0.5 text-[13px] leading-relaxed text-slate-200">
          {kpi.target_description}
        </p>
      </div>

      {/* Meta row */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/20 bg-violet-500/10 px-2 py-1 text-[11px] font-medium text-violet-300">
          <UserCog className="h-3 w-3" />
          {kpi.responsible_entity}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-blue-500/20 bg-blue-500/10 px-2 py-1 text-[11px] font-medium text-blue-300">
          <Clock className="h-3 w-3" />
          {kpi.timeframe}
        </span>
      </div>
    </div>
  );
}

// ── 4. Results panel (idle / running / complete / failed) ───────────────────────

interface ResultsPanelProps {
  phase: Phase;
  result: KPIResult | null;
  error: string | null;
  elapsed: number;
  kpisPerStandard: number;
}

function ResultsPanel({
  phase,
  result,
  error,
  elapsed,
  kpisPerStandard,
}: ResultsPanelProps) {
  // ── Idle ────────────────────────────────────────────────────────────────────
  if (phase === "idle") {
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center rounded-xl border border-dashed border-white/10 bg-[#0d1117]">
        <div className="flex max-w-sm flex-col items-center gap-3 px-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-500/10">
            <Gauge className="h-7 w-7 text-cyan-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-300">NAQAAE KPI Generator</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              Set your parameters and click{" "}
              <span className="text-slate-500">Generate KPIs</span> to draft
              measurable indicators across all 7 programmatic accreditation standards.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Running ─────────────────────────────────────────────────────────────────
  if (phase === "running") {
    const expected = 48; // Gemini 2.5 Flash ≈ 40–50s
    const pct = Math.min(95, Math.round((elapsed / expected) * 100));
    return (
      <div className="flex flex-col gap-5 rounded-xl border border-white/5 bg-[#0d1117] p-6 animate-fade-in">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />
          <div>
            <p className="text-sm font-semibold text-slate-200">
              Generating KPIs with Gemini 2.5 Flash…
            </p>
            <p className="text-xs text-slate-500">
              This typically takes 40–50 seconds. Please keep this page open.
            </p>
          </div>
        </div>

        {/* Indeterminate-ish progress */}
        <div className="space-y-1.5">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-1000 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {elapsed}s elapsed
            </span>
            <span>Polling every 5s…</span>
          </div>
        </div>

        {/* Skeleton groups */}
        <div className="space-y-3 pt-1">
          {Array.from({ length: Math.min(3, kpisPerStandard) }).map((_, i) => (
            <div
              key={i}
              className="skeleton h-28 rounded-xl"
              style={{ animationDelay: `${i * 0.12}s` }}
            />
          ))}
        </div>
      </div>
    );
  }

  // ── Failed ──────────────────────────────────────────────────────────────────
  if (phase === "failed") {
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center rounded-xl border border-rose-500/20 bg-rose-500/[0.04] p-8 animate-fade-in">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/15">
            <AlertTriangle className="h-7 w-7 text-rose-400" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-100">Generation Failed</h3>
            <p className="mt-1.5 break-words text-sm text-rose-300/90">
              {error ?? "An unknown error occurred."}
            </p>
          </div>
          <p className="text-xs text-slate-600">
            Check that the FastAPI backend is running on {BACKEND}.
          </p>
        </div>
      </div>
    );
  }

  // ── Complete ────────────────────────────────────────────────────────────────
  if (!result) return null;

  const grouped = STANDARD_ORDER.map((id) => ({
    id,
    kpis: result.kpis.filter((k) => String(k.standard_id) === id),
  })).filter((g) => g.kpis.length > 0);

  return (
    <div className="flex flex-col gap-5">
      <MetadataHeader meta={result.metadata} />

      <div className="space-y-5">
        {grouped.map((group) => {
          const std = STANDARDS[group.id];
          return (
            <div key={group.id} className="animate-fade-in">
              {/* Standard header */}
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-sm font-bold text-cyan-400">
                  {group.id}
                </div>
                <div className="min-w-0 flex-1">
                  <p dir="rtl" className="truncate text-right text-sm font-semibold text-slate-200">
                    {std?.ar ?? `المعيار ${group.id}`}
                  </p>
                  <p className="truncate text-[11px] text-slate-500">
                    Standard {group.id} — {std?.en ?? ""}
                  </p>
                </div>
                <Badge variant="mock" className="shrink-0">
                  {group.kpis.length} KPI{group.kpis.length === 1 ? "" : "s"}
                </Badge>
              </div>

              {/* KPI cards */}
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {group.kpis.map((kpi, i) => (
                  <KPICard key={`${group.id}-${i}`} kpi={kpi} index={i + 1} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────────

export default function KPIGenerationPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [kpisPerStandard, setKpisPerStandard] = useState(3);
  const [program, setProgram] = useState("علوم الحاسب");
  const [college, setCollege] = useState("كلية تكنولوجيا المعلومات وعلوم الحاسب");
  const [university, setUniversity] = useState("جامعة النيل الأهلية");
  const [planningHorizon, setPlanningHorizon] = useState("2025-2028");

  const [result, setResult] = useState<KPIResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // Guards against a stale poll loop writing state after a new run / unmount.
  const runIdRef = useRef(0);

  // Elapsed-time ticker while running.
  useEffect(() => {
    if (phase !== "running") return;
    const start = Date.now();
    setElapsed(0);
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  const handleGenerate = async () => {
    const myRun = ++runIdRef.current;
    setPhase("running");
    setResult(null);
    setError(null);

    try {
      const runRes = await fetch(`${BACKEND}/api/agents/kpi/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kpis_per_standard: kpisPerStandard,
          program_name: program,
          college_name: college,
          university_name: university,
          planning_horizon: planningHorizon,
        }),
      });

      if (!runRes.ok) {
        throw new Error(
          `Backend error ${runRes.status} — is the API server running on ${BACKEND}?`
        );
      }
      const { job_id } = (await runRes.json()) as { job_id: string };

      const deadline = Date.now() + POLL_TIMEOUT_MS;

      const poll = async (): Promise<void> => {
        if (myRun !== runIdRef.current) return; // superseded by a newer run

        if (Date.now() > deadline) {
          throw new Error("Timed out after 3 minutes waiting for the KPI agent.");
        }

        const jobRes = await fetch(`${BACKEND}/api/jobs/${job_id}`);
        if (!jobRes.ok) throw new Error("Failed to fetch job status.");
        const job = (await jobRes.json()) as {
          status: string;
          result?: KPIResult;
          error?: string;
        };

        if (job.status === "complete") {
          if (myRun !== runIdRef.current) return;
          if (!job.result || !job.result.kpis?.length) {
            throw new Error("The agent returned no KPIs.");
          }
          setResult(job.result);
          setPhase("complete");
        } else if (job.status === "failed") {
          throw new Error(job.error ?? "KPI generation failed.");
        } else {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          await poll();
        }
      };

      // First check after one interval (job won't be done instantly).
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      await poll();
    } catch (err) {
      if (myRun !== runIdRef.current) return;
      setError(err instanceof Error ? err.message : "Unknown error.");
      setPhase("failed");
    }
  };

  const isRunning = phase === "running";

  const subtitle = useMemo(
    () => "Draft NAQAAE-aligned KPIs across the 7 programmatic standards",
    []
  );

  return (
    <div className="flex min-h-full flex-col">
      <Header title="KPI Generation" subtitle={subtitle} />

      <div className="grid grid-cols-1 gap-5 p-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <ConfigPanel
            kpisPerStandard={kpisPerStandard}
            setKpisPerStandard={setKpisPerStandard}
            program={program}
            setProgram={setProgram}
            college={college}
            setCollege={setCollege}
            university={university}
            setUniversity={setUniversity}
            planningHorizon={planningHorizon}
            setPlanningHorizon={setPlanningHorizon}
            onGenerate={handleGenerate}
            isRunning={isRunning}
          />
        </div>

        <div className="lg:col-span-3">
          <ResultsPanel
            phase={phase}
            result={result}
            error={error}
            elapsed={elapsed}
            kpisPerStandard={kpisPerStandard}
          />
        </div>
      </div>
    </div>
  );
}
