"use client";

import React from "react";
import Link from "next/link";
import { AlertTriangle, Square, ArrowRight, CheckSquare2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Meeting, InsightCard, ImpactLevel } from "@/types";

const IMPACT_ORDER: ImpactLevel[] = ["critical", "high", "medium", "low"];

const IMPACT_BADGE: Record<ImpactLevel, string> = {
  critical: "border-[#d44452]/30 bg-[#d44452]/10 text-[#d44452]",
  high:     "border-[#c07824]/30 bg-[#c07824]/10 text-[#c07824]",
  medium:   "border-white/[0.08] bg-white/[0.04] text-[#8d97b8]",
  low:      "border-white/[0.06] bg-transparent text-[#505672]",
};

export function AttentionRequired({
  meetings,
  threats,
}: {
  meetings: Meeting[];
  threats: InsightCard[];
}) {
  const openActions = meetings
    .flatMap((m) =>
      m.action_items
        .filter((a) => !a.is_completed)
        .map((a) => ({ ...a, meetingTitle: m.title, meetingId: m.id }))
    )
    .slice(0, 4);

  const topThreats = [...threats]
    .sort((a, b) => {
      const diff = IMPACT_ORDER.indexOf(a.impact_level) - IMPACT_ORDER.indexOf(b.impact_level);
      return diff !== 0 ? diff : b.confidence_score - a.confidence_score;
    })
    .slice(0, 3);

  const totalItems = openActions.length + topThreats.length;

  return (
    <div className="flex flex-col rounded-xl border border-white/[0.07] bg-[#0f1422]">

      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <div>
          <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-[#e0e4ef]">
            Attention Required
          </h3>
          <p className="text-[11px] text-[#505672]">Open actions & active risks</p>
        </div>
        {totalItems > 0 && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#d44452]/15 text-[10px] font-bold text-[#d44452]">
            {totalItems}
          </span>
        )}
      </div>

      {/* Open actions */}
      <div className="border-b border-white/[0.06] px-4 py-3">
        <p className="mb-2 text-[9px] font-semibold uppercase tracking-[0.1em] text-[#b8922f]/60">
          Open Actions
        </p>
        {openActions.length === 0 ? (
          <p className="text-[12px] text-[#2b2f45]">No open action items</p>
        ) : (
          <div className="flex flex-col gap-1">
            {openActions.map((action) => (
              <Link
                key={action.id}
                href={`/meetings/${action.meetingId}`}
                className="group flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors duration-150 hover:bg-[#171e30]"
              >
                <Square className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#c07824]" />
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-medium text-[#8d97b8] transition-colors duration-150 group-hover:text-[#e0e4ef]">
                    {action.description}
                  </p>
                  <p className="text-[10px] text-[#505672]">
                    {action.assignee} · {action.meetingTitle}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Active threats */}
      <div className="flex-1 px-4 py-3">
        <p className="mb-2 text-[9px] font-semibold uppercase tracking-[0.1em] text-[#b8922f]/60">
          Active Threats
        </p>
        {topThreats.length === 0 ? (
          <div className="flex flex-col items-center py-3 text-center">
            <p className="text-[12px] text-[#2b2f45]">No threats detected</p>
            <Link
              href="/swot"
              className="mt-1 text-[11px] text-[#b8922f] transition-colors duration-150 hover:text-[#c9a84c]"
            >
              Run SWOT agents →
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {topThreats.map((threat) => (
              <div key={threat.id} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#d44452]" />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-medium leading-snug text-[#8d97b8]">
                    {threat.title}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <span
                      className={cn(
                        "rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                        IMPACT_BADGE[threat.impact_level]
                      )}
                    >
                      {threat.impact_level}
                    </span>
                    <span className="text-[10px] text-[#505672]">
                      {threat.confidence_score}% confidence
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-white/[0.06] px-4 py-2.5">
        <Link
          href="/swot"
          className="flex items-center gap-1 text-[12px] text-[#b8922f] transition-colors duration-150 hover:text-[#c9a84c]"
        >
          View all risks
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
