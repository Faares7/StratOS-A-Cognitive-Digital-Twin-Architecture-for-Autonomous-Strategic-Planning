"use client";

import React from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KPIMetric } from "@/types";

const STATUS_LEFT_BORDER: Record<string, string> = {
  good:     "border-l-[#1aad74]",
  warning:  "border-l-[#c07824]",
  critical: "border-l-[#d44452]",
  neutral:  "border-l-[#2b2f45]",
};

const STATUS_VALUE_COLOR: Record<string, string> = {
  good:     "text-[#1aad74]",
  warning:  "text-[#c07824]",
  critical: "text-[#d44452]",
  neutral:  "text-[#e0e4ef]",
};

function KPICard({ metric }: { metric: KPIMetric }) {
  const leftBorder  = STATUS_LEFT_BORDER[metric.status ?? "neutral"];
  const trendColor  = STATUS_VALUE_COLOR[metric.status ?? "neutral"];

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-xl border border-white/[0.07] bg-[#0f1422] p-4 border-l-2 transition-colors duration-150",
        leftBorder
      )}
    >
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-[#505672]">
          {metric.label}
        </p>
        {metric.data_source === "mock" && (
          <span className="rounded bg-white/[0.04] px-1 py-0.5 text-[9px] text-[#2b2f45]">
            Mock
          </span>
        )}
      </div>

      <div className="flex items-end gap-1.5">
        <span className="text-[26px] font-bold leading-none tracking-[-0.03em] text-[#e0e4ef]">
          {metric.value}
        </span>
        {metric.unit && (
          <span className="mb-0.5 text-sm font-normal text-[#505672]">{metric.unit}</span>
        )}
      </div>

      {metric.trend && (
        <div className={cn("flex items-center gap-1 text-[11px]", trendColor)}>
          {metric.trend === "up" ? (
            <TrendingUp className="h-3 w-3" />
          ) : metric.trend === "down" ? (
            <TrendingDown className="h-3 w-3" />
          ) : (
            <Minus className="h-3 w-3" />
          )}
          {metric.trend_value !== undefined && (
            <span>
              {metric.trend === "up" ? "+" : metric.trend === "down" ? "−" : ""}
              {metric.trend_value}
              {metric.unit ?? ""}
            </span>
          )}
          <span className="text-[#2b2f45]">vs prior</span>
        </div>
      )}
    </div>
  );
}

export function KPIGrid({ metrics }: { metrics: KPIMetric[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {metrics.map((m) => (
        <KPICard key={m.id} metric={m} />
      ))}
    </div>
  );
}
