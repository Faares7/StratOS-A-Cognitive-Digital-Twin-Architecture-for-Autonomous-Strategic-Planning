"use client";

import React from "react";
import Link from "next/link";
import { Clock, RefreshCw, Shield } from "lucide-react";
import type { ComplianceSummary, KPIMetric } from "@/types";

function computeHealthScore(compliance: ComplianceSummary, kpis: KPIMetric[]): number {
  const goodCount = kpis.filter((k) => k.status === "good").length;
  const kpiHealth = kpis.length > 0 ? (goodCount / kpis.length) * 100 : 50;
  return Math.round(compliance.overall_score * 0.6 + kpiHealth * 0.4);
}

function healthMeta(score: number): { color: string; label: string } {
  if (score >= 75) return { color: "#1aad74", label: "Healthy" };
  if (score >= 50) return { color: "#c07824", label: "At Risk" };
  return { color: "#d44452", label: "Critical" };
}

function freshnessLabel(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1)  return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function StrategicPulse({
  compliance,
  kpis,
}: {
  compliance: ComplianceSummary;
  kpis: KPIMetric[];
}) {
  const score              = computeHealthScore(compliance, kpis);
  const { color, label }  = healthMeta(score);
  const onTrack            = kpis.filter((k) => k.status === "good").length;
  const atRisk             = kpis.filter((k) => k.status === "warning").length;
  const critical           = kpis.filter((k) => k.status === "critical").length;

  const r     = 30;
  const circ  = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;

  return (
    <div className="flex flex-wrap items-center gap-6 rounded-xl border border-white/[0.07] bg-[#0f1422] px-6 py-5">

      {/* Score ring */}
      <div className="relative flex h-[76px] w-[76px] shrink-0 items-center justify-center">
        <svg viewBox="0 0 72 72" className="h-[76px] w-[76px] -rotate-90">
          <circle cx="36" cy="36" r={r} fill="none" stroke="#171e30" strokeWidth="5" />
          <circle
            cx="36" cy="36" r={r}
            fill="none"
            stroke={color}
            strokeWidth="5"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute flex flex-col items-center leading-none">
          <span className="text-[22px] font-bold tracking-[-0.03em] text-[#e0e4ef]">{score}</span>
          <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.06em]" style={{ color }}>
            {label}
          </span>
        </div>
      </div>

      {/* Label */}
      <div className="min-w-0 shrink-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#b8922f]/70">
          Strategic Health
        </p>
        <p className="mt-0.5 text-[12px] text-[#505672]">
          Composite — compliance, goals & KPIs
        </p>
      </div>

      <div className="hidden h-10 w-px bg-white/[0.06] sm:block" />

      {/* Goal status counters */}
      <div className="flex items-center gap-6">
        <div className="flex flex-col items-center">
          <span className="text-[28px] font-bold leading-none tracking-[-0.04em] text-[#1aad74]">
            {onTrack}
          </span>
          <span className="mt-1 text-[10px] uppercase tracking-[0.06em] text-[#505672]">On Track</span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-[28px] font-bold leading-none tracking-[-0.04em] text-[#c07824]">
            {atRisk}
          </span>
          <span className="mt-1 text-[10px] uppercase tracking-[0.06em] text-[#505672]">At Risk</span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-[28px] font-bold leading-none tracking-[-0.04em] text-[#d44452]">
            {critical}
          </span>
          <span className="mt-1 text-[10px] uppercase tracking-[0.06em] text-[#505672]">Critical</span>
        </div>
      </div>

      <div className="hidden h-10 w-px bg-white/[0.06] sm:block" />

      {/* Compliance score */}
      <div className="flex items-center gap-3">
        <Shield className="h-4 w-4 shrink-0 text-[#b8922f]" />
        <div>
          <p className="text-[10px] uppercase tracking-[0.06em] text-[#505672]">Compliance</p>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="text-[22px] font-bold leading-none tracking-[-0.03em] text-[#e0e4ef]">
              {compliance.overall_score}
            </span>
            <span className="text-[12px] text-[#505672]">/ 100</span>
          </div>
        </div>
      </div>

      <div className="hidden h-10 w-px bg-white/[0.06] sm:block" />

      {/* Next submission countdown */}
      <div className="flex items-center gap-3">
        <Clock className="h-4 w-4 shrink-0 text-[#b8922f]" />
        <div>
          <p className="text-[10px] uppercase tracking-[0.06em] text-[#505672]">Next Submission</p>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="text-[22px] font-bold leading-none tracking-[-0.03em] text-[#e0e4ef]">
              {compliance.days_remaining}
            </span>
            <span className="text-[12px] text-[#505672]">days</span>
          </div>
        </div>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Data freshness + link */}
      <div className="flex shrink-0 flex-col items-end gap-1">
        <div className="flex items-center gap-1.5 text-[10px] text-[#2b2f45]">
          <RefreshCw className="h-3 w-3" />
          Updated {freshnessLabel(compliance.last_updated)}
        </div>
        <Link
          href="/gap-analysis"
          className="text-[11px] text-[#b8922f] transition-colors duration-150 hover:text-[#c9a84c]"
        >
          View pillar breakdown →
        </Link>
      </div>
    </div>
  );
}
