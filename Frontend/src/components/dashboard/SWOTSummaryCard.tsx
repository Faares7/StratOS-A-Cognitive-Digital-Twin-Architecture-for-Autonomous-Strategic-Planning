"use client";

import React from "react";
import Link from "next/link";
import { TrendingUp, TrendingDown, Target, AlertTriangle, ArrowRight, FileText, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import type { InsightCard } from "@/types";

const CATEGORY_CONFIG = {
  strength: {
    label:        "Strengths",
    icon:         TrendingUp,
    color:        "text-[#1aad74]",
    bg:           "bg-[#1aad74]/10",
    border:       "border-[#1aad74]/20",
    headerBorder: "border-b-[#1aad74]/20",
  },
  weakness: {
    label:        "Weaknesses",
    icon:         TrendingDown,
    color:        "text-[#c07824]",
    bg:           "bg-[#c07824]/10",
    border:       "border-[#c07824]/20",
    headerBorder: "border-b-[#c07824]/20",
  },
  opportunity: {
    label:        "Opportunities",
    icon:         Target,
    color:        "text-[#0ea0c0]",
    bg:           "bg-[#0ea0c0]/10",
    border:       "border-[#0ea0c0]/20",
    headerBorder: "border-b-[#0ea0c0]/20",
  },
  threat: {
    label:        "Threats",
    icon:         AlertTriangle,
    color:        "text-[#d44452]",
    bg:           "bg-[#d44452]/10",
    border:       "border-[#d44452]/20",
    headerBorder: "border-b-[#d44452]/20",
  },
};

function QuadrantPanel({
  category,
  items,
}: {
  category: keyof typeof CATEGORY_CONFIG;
  items: InsightCard[];
}) {
  const cfg  = CATEGORY_CONFIG[category];
  const Icon = cfg.icon;

  return (
    <div className={cn("flex flex-col rounded-lg border", cfg.border)}>
      <div
        className={cn(
          "flex items-center justify-between border-b px-3 py-2",
          cfg.headerBorder,
          cfg.bg
        )}
      >
        <div className="flex items-center gap-1.5">
          <Icon className={cn("h-3.5 w-3.5", cfg.color)} />
          <span className={cn("text-[11px] font-semibold uppercase tracking-[0.06em]", cfg.color)}>
            {cfg.label}
          </span>
        </div>
        <span className="text-[11px] font-bold text-[#505672]">{items.length}</span>
      </div>

      <div className="flex flex-col divide-y divide-white/[0.05]">
        {items.length === 0 ? (
          <p className="px-3 py-4 text-center text-[11px] text-[#2b2f45]">No data available</p>
        ) : (
          items.slice(0, 5).map((item) => (
            <div key={item.id} className="flex items-center justify-between px-3 py-2">
              <span className="flex-1 truncate text-[12px] font-medium text-[#8d97b8]">
                {item.title}
              </span>
              <div className="ml-2 flex shrink-0 items-center gap-1 text-[#2b2f45]">
                <FileText className="h-3 w-3" />
                <span className="text-[10px]">{item.reference_count}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function SWOTSummaryCard({
  strengths,
  weaknesses,
  opportunities,
  threats,
}: {
  strengths:     InsightCard[];
  weaknesses:    InsightCard[];
  opportunities: InsightCard[];
  threats:       InsightCard[];
}) {
  const allItems = [...strengths, ...weaknesses, ...opportunities, ...threats];
  const hasLive  = allItems.some((i) => i.data_source === "live");

  return (
    <div className="rounded-xl border border-white/[0.07] bg-[#0f1422]">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
        <div>
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-[#e0e4ef]">
            SWOT Analysis
          </h2>
          <p className="mt-0.5 text-[11px] text-[#505672]">Top validated insights</p>
        </div>
        {hasLive ? (
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[#1aad74]" />
            <span className="text-[11px] font-medium text-[#1aad74]">Live</span>
          </div>
        ) : (
          <Link
            href="/swot"
            className="flex items-center gap-1.5 rounded border border-[#b8922f]/22 bg-[#b8922f]/10 px-2.5 py-1 text-[11px] font-medium text-[#b8922f] transition-colors duration-150 hover:bg-[#b8922f]/20"
          >
            <Play className="h-3 w-3" />
            Run agents
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 p-4">
        <QuadrantPanel category="strength"    items={strengths} />
        <QuadrantPanel category="weakness"    items={weaknesses} />
        <QuadrantPanel category="opportunity" items={opportunities} />
        <QuadrantPanel category="threat"      items={threats} />
      </div>

      <div className="border-t border-white/[0.06] px-5 py-3">
        <Link
          href="/swot"
          className="flex items-center gap-1 text-[12px] text-[#b8922f] transition-colors duration-150 hover:text-[#c9a84c]"
        >
          View full analysis
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
