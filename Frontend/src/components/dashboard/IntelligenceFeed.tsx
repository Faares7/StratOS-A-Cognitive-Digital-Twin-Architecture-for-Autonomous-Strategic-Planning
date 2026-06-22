"use client";

import React from "react";
import Link from "next/link";
import {
  FileText,
  AlertTriangle,
  Target,
  BarChart3,
  RefreshCw,
  TrendingDown,
  ArrowRight,
} from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import type { Meeting, InsightCard, SimulationResult } from "@/types";

type EventType = "meeting" | "threat" | "opportunity" | "weakness" | "simulation" | "compliance";

interface FeedEvent {
  id:        string;
  type:      EventType;
  title:     string;
  subtitle:  string;
  timestamp: string;
  href?:     string;
}

const EVENT_META: Record<EventType, { Icon: React.ComponentType<{ className?: string }>; color: string; bg: string }> = {
  meeting:    { Icon: FileText,       color: "text-[#8d97b8]",  bg: "bg-[#8d97b8]/10"  },
  threat:     { Icon: AlertTriangle,  color: "text-[#d44452]",  bg: "bg-[#d44452]/10"  },
  opportunity:{ Icon: Target,         color: "text-[#0ea0c0]",  bg: "bg-[#0ea0c0]/10"  },
  weakness:   { Icon: TrendingDown,   color: "text-[#c07824]",  bg: "bg-[#c07824]/10"  },
  simulation: { Icon: BarChart3,      color: "text-[#b8922f]",  bg: "bg-[#b8922f]/10"  },
  compliance: { Icon: RefreshCw,      color: "text-[#1aad74]",  bg: "bg-[#1aad74]/10"  },
};

function buildFeed(
  meetings:           Meeting[],
  threats:            InsightCard[],
  weaknesses:         InsightCard[],
  opportunities:      InsightCard[],
  simulation:         SimulationResult | null,
  complianceUpdated:  string,
): FeedEvent[] {
  const events: FeedEvent[] = [];

  meetings.forEach((m) => {
    events.push({
      id:        `mtg-${m.id}`,
      type:      "meeting",
      title:     m.title,
      subtitle:  `${m.key_decisions.length} decisions · ${m.action_items.filter((a) => !a.is_completed).length} open actions`,
      timestamp: m.date,
      href:      `/meetings/${m.id}`,
    });
  });

  threats.slice(0, 2).forEach((t) => {
    events.push({
      id:        `thr-${t.id}`,
      type:      "threat",
      title:     t.title,
      subtitle:  `${t.impact_level} impact · ${t.confidence_score}% confidence`,
      timestamp: t.created_at,
      href:      "/swot",
    });
  });

  weaknesses.slice(0, 1).forEach((w) => {
    events.push({
      id:        `wk-${w.id}`,
      type:      "weakness",
      title:     w.title,
      subtitle:  `${w.impact_level} impact · ${w.confidence_score}% confidence`,
      timestamp: w.created_at,
      href:      "/swot",
    });
  });

  opportunities.slice(0, 2).forEach((o) => {
    events.push({
      id:        `opp-${o.id}`,
      type:      "opportunity",
      title:     o.title,
      subtitle:  `${o.impact_level} impact · ${o.confidence_score}% confidence`,
      timestamp: o.created_at,
      href:      "/swot",
    });
  });

  if (simulation) {
    events.push({
      id:        "sim-1",
      type:      "simulation",
      title:     `Scenario: "${simulation.query}"`,
      subtitle:  `${simulation.iterations.toLocaleString()} iterations · ${simulation.confidence}% confidence`,
      timestamp: simulation.simulated_at,
    });
  }

  events.push({
    id:        "compliance-refresh",
    type:      "compliance",
    title:     "Compliance data refreshed",
    subtitle:  "12 pillars scored via NAQAAE framework",
    timestamp: complianceUpdated,
    href:      "/gap-analysis",
  });

  return events
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 8);
}

export function IntelligenceFeed({
  meetings,
  threats,
  weaknesses,
  opportunities,
  simulation,
  complianceUpdated,
}: {
  meetings:          Meeting[];
  threats:           InsightCard[];
  weaknesses:        InsightCard[];
  opportunities:     InsightCard[];
  simulation:        SimulationResult | null;
  complianceUpdated: string;
}) {
  const events = buildFeed(meetings, threats, weaknesses, opportunities, simulation, complianceUpdated);

  return (
    <div className="flex flex-col rounded-xl border border-white/[0.07] bg-[#0f1422]">

      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <div>
          <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-[#e0e4ef]">
            Intelligence Feed
          </h3>
          <p className="text-[11px] text-[#505672]">Events across all agents — newest first</p>
        </div>
        <span className="flex items-center gap-1.5 rounded bg-[#1aad74]/10 px-2 py-0.5 text-[10px] font-semibold text-[#1aad74]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#1aad74]" />
          Live
        </span>
      </div>

      {/* Event list */}
      <div className="flex flex-col divide-y divide-white/[0.05]">
        {events.map((event) => {
          const { Icon, color, bg } = EVENT_META[event.type];

          const inner = (
            <div className="flex items-start gap-3 px-4 py-3">
              <div
                className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${bg}`}
              >
                <Icon className={`h-3.5 w-3.5 ${color}`} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium text-[#8d97b8]">{event.title}</p>
                <p className="text-[10px] text-[#505672]">{event.subtitle}</p>
              </div>
              <span className="shrink-0 text-[10px] text-[#2b2f45]">
                {formatRelativeTime(event.timestamp)}
              </span>
            </div>
          );

          return event.href ? (
            <Link
              key={event.id}
              href={event.href}
              className="group transition-colors duration-150 hover:bg-[#171e30]"
            >
              {inner}
            </Link>
          ) : (
            <div key={event.id}>{inner}</div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="border-t border-white/[0.06] px-4 py-2.5">
        <Link
          href="/swot"
          className="flex items-center gap-1 text-[12px] text-[#b8922f] transition-colors duration-150 hover:text-[#c9a84c]"
        >
          View all intelligence
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
