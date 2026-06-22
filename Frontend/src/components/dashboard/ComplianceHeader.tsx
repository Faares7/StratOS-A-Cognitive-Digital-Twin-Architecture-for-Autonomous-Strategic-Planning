"use client";

import React from "react";
import { ShieldCheck, Clock, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ComplianceSummary } from "@/types";

function ScoreRing({ score }: { score: number }) {
  const radius       = 36;
  const circumference = 2 * Math.PI * radius;
  const progress     = circumference - (score / 100) * circumference;
  const color =
    score >= 80 ? "#1aad74" : score >= 60 ? "#c07824" : "#d44452";

  return (
    <div className="relative flex h-24 w-24 items-center justify-center">
      <svg className="-rotate-90" width="96" height="96">
        {/* Track */}
        <circle cx="48" cy="48" r={radius} stroke="#171e30" strokeWidth="7" fill="none" />
        {/* Progress */}
        <circle
          cx="48" cy="48" r={radius}
          stroke={color}
          strokeWidth="7"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={progress}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 1s ease-in-out" }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-[22px] font-bold leading-none tracking-[-0.03em] text-[#e0e4ef]">
          {score}%
        </span>
        <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-[#505672]">
          Score
        </span>
      </div>
    </div>
  );
}

export function ComplianceHeader({ compliance }: { compliance: ComplianceSummary }) {
  const scoreColor =
    compliance.overall_score >= 80
      ? "text-[#1aad74]"
      : compliance.overall_score >= 60
      ? "text-[#c07824]"
      : "text-[#d44452]";

  const urgency =
    compliance.days_remaining < 30
      ? "critical"
      : compliance.days_remaining < 90
      ? "warning"
      : "safe";

  return (
    <div className="flex items-center gap-6 rounded-xl border border-white/[0.07] bg-[#0f1422] p-5">
      <ScoreRing score={compliance.overall_score} />

      <div className="flex-1">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[#b8922f]" />
          <span className="text-[13px] font-medium text-[#8d97b8]">
            NAQAAE Compliance Score
          </span>
          {compliance.data_source === "mock" && (
            <span className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[9px] text-[#2b2f45]">
              Mock
            </span>
          )}
        </div>
        <p className={cn("mt-1 text-[32px] font-bold leading-none tracking-[-0.03em]", scoreColor)}>
          {compliance.overall_score}
          <span className="ml-1 text-base font-normal text-[#505672]">/100</span>
        </p>
        <p className="mt-1 text-[11px] text-[#505672]">
          Updated{" "}
          {new Date(compliance.last_updated).toLocaleString("en-US", {
            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
          })}
        </p>
      </div>

      <div className="flex flex-col items-end gap-2">
        <div
          className={cn(
            "flex items-center gap-1.5 rounded-lg border px-3 py-1.5",
            urgency === "critical"
              ? "border-[#d44452]/20 bg-[#d44452]/10"
              : urgency === "warning"
              ? "border-[#c07824]/20 bg-[#c07824]/10"
              : "border-[#1aad74]/20 bg-[#1aad74]/10"
          )}
        >
          {urgency !== "safe" ? (
            <AlertTriangle
              className={cn(
                "h-3.5 w-3.5",
                urgency === "critical" ? "text-[#d44452]" : "text-[#c07824]"
              )}
            />
          ) : (
            <Clock className="h-3.5 w-3.5 text-[#1aad74]" />
          )}
          <span
            className={cn(
              "text-[12px] font-medium",
              urgency === "critical"
                ? "text-[#d44452]"
                : urgency === "warning"
                ? "text-[#c07824]"
                : "text-[#1aad74]"
            )}
          >
            {compliance.days_remaining} days remaining
          </span>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-[#505672]">Next Submission</p>
          <p className="text-[13px] font-medium text-[#8d97b8]">
            {new Date(compliance.next_submission_date).toLocaleDateString("en-US", {
              month: "long", day: "numeric", year: "numeric",
            })}
          </p>
        </div>
      </div>
    </div>
  );
}
