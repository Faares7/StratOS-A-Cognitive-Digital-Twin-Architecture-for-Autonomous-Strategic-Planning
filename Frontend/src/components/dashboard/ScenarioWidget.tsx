"use client";

import React from "react";
import Link from "next/link";
import { MessageSquare, ArrowRight, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SimulationResult } from "@/types";

function OutcomeBar({
  label,
  change,
  probability,
}: {
  label:       string;
  change:      number;
  probability: number;
}) {
  const isPositive = change >= 0;
  const isNeutral  = Math.abs(change) < 2;

  const barColor  = isNeutral ? "bg-[#505672]" : isPositive ? "bg-[#1aad74]" : "bg-[#d44452]";
  const textColor = isNeutral ? "text-[#505672]" : isPositive ? "text-[#1aad74]" : "text-[#d44452]";
  const Icon      = isPositive ? TrendingUp : isNeutral ? Minus : TrendingDown;

  return (
    <div className="flex items-center gap-2">
      <Icon className={cn("h-3 w-3 shrink-0", textColor)} />
      <span className="w-20 shrink-0 text-[11px] text-[#505672]">{label}</span>
      <div className="flex-1 overflow-hidden rounded-full bg-[#171e30] h-1">
        <div
          className={cn("h-1 rounded-full transition-all", barColor)}
          style={{ width: `${Math.min(100, Math.abs(change) * 2)}%` }}
        />
      </div>
      <span className={cn("w-12 shrink-0 text-right text-[11px] font-medium tabular-nums", textColor)}>
        {change >= 0 ? "+" : ""}
        {change}%
      </span>
      <span className="w-10 shrink-0 text-right text-[10px] text-[#2b2f45]">
        ({Math.round(probability * 100)}%)
      </span>
    </div>
  );
}

export function ScenarioWidget({ simulation }: { simulation: SimulationResult | null }) {
  if (!simulation) {
    return (
      <div className="flex flex-col rounded-xl border border-white/[0.07] bg-[#0f1422]">
        <div className="border-b border-white/[0.06] px-4 py-3">
          <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-[#e0e4ef]">
            Scenario Simulator
          </h3>
          <p className="text-[11px] text-[#505672]">Monte Carlo projections</p>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <MessageSquare className="h-8 w-8 text-[#2b2f45]" />
          <p className="text-[12px] text-[#505672]">No simulation run yet.</p>
          <Link href="/simulator" className="text-[12px] text-[#b8922f] hover:text-[#c9a84c] transition-colors duration-150">
            Run your first simulation →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col rounded-xl border border-white/[0.07] bg-[#0f1422]">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <div>
          <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-[#e0e4ef]">
            Scenario Simulator
          </h3>
          <p className="text-[11px] text-[#505672]">Monte Carlo projections</p>
        </div>
        <MessageSquare className="h-4 w-4 text-[#2b2f45]" />
      </div>

      <div className="flex flex-col gap-3 p-4">
        <div className="rounded-lg bg-[#171e30] px-3 py-2">
          <p className="text-[10px] text-[#505672]">Last simulation query</p>
          <p className="mt-0.5 text-[12px] italic text-[#8d97b8]">&quot;{simulation.query}&quot;</p>
        </div>

        <div className="flex flex-col gap-2">
          {simulation.outcomes.map((o) => (
            <OutcomeBar
              key={o.label}
              label={o.label}
              change={o.percentage_change}
              probability={o.probability}
            />
          ))}
        </div>

        <p className="text-[10px] text-[#2b2f45]">
          {simulation.iterations.toLocaleString()} iterations · Confidence: {simulation.confidence}%
        </p>
      </div>

      <div className="border-t border-white/[0.06] px-4 py-2.5">
        <Link
          href="/simulator"
          className="flex items-center gap-1 text-[12px] text-[#b8922f] transition-colors duration-150 hover:text-[#c9a84c]"
        >
          Run new simulation
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
