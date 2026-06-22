"use client";

import React from "react";
import { useDashboard } from "@/hooks/useDashboard";
import { useMeetings } from "@/hooks/useMeetings";
import { useAgentResults } from "@/contexts/AgentResultsContext";
import { Header } from "@/components/layout/Header";
import { IntelligenceFeed } from "@/components/dashboard/IntelligenceFeed";
import { AttentionRequired } from "@/components/dashboard/AttentionRequired";
import { MeetingSummaries } from "@/components/dashboard/MeetingSummaries";
import { SWOTSummaryCard } from "@/components/dashboard/SWOTSummaryCard";

function Skeleton({ className }: { className?: string }) {
  return <div className={`skeleton rounded-xl ${className ?? ""}`} />;
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-5 p-6 animate-fade-in">
      {/* Feed + Attention */}
      <div className="grid grid-cols-3 gap-5">
        <div className="col-span-2">
          <Skeleton className="h-[360px]" />
        </div>
        <Skeleton className="h-[360px]" />
      </div>
      {/* Meetings + SWOT */}
      <div className="grid grid-cols-2 gap-5">
        <Skeleton className="h-[280px]" />
        <Skeleton className="h-[280px]" />
      </div>
    </div>
  );
}

export default function CommandCenterPage() {
  const { data, loading, error } = useDashboard();
  const { meetings } = useMeetings();
  const { insights: liveInsights, results } = useAgentResults();

  const swot = {
    strengths:     liveInsights.filter((i) => i.category === "strength"),
    weaknesses:    liveInsights.filter((i) => i.category === "weakness"),
    opportunities: liveInsights.filter((i) => i.category === "opportunity"),
    threats:       liveInsights.filter((i) => i.category === "threat"),
  };

  // Fall back to mock data for threats/opportunities if agents haven't run yet
  const threats      = swot.threats.length      > 0 ? swot.threats      : (data?.swot_summary.threats      ?? []);
  const weaknesses   = swot.weaknesses.length   > 0 ? swot.weaknesses   : (data?.swot_summary.weaknesses   ?? []);
  const opportunities = swot.opportunities.length > 0 ? swot.opportunities : (data?.swot_summary.opportunities ?? []);
  const strengths    = swot.strengths.length    > 0 ? swot.strengths    : (data?.swot_summary.strengths    ?? []);

  return (
    <div className="flex min-h-full flex-col">
      <Header
        title="Command Center"
        subtitle="Strategic overview — all intelligence in one place."
      />

      {loading && <LoadingSkeleton />}

      {error && (
        <div className="m-6 rounded-xl border border-[#d44452]/20 bg-[#d44452]/10 p-4 text-sm text-[#d44452]">
          Failed to load dashboard: {error}
        </div>
      )}

      {data && (
        <div className="flex flex-col gap-5 p-6 animate-fade-in">

          {/* Row 1: Intelligence feed (2/3) + Attention required (1/3) */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <IntelligenceFeed
                meetings={meetings.length > 0 ? meetings : data.recent_meetings}
                threats={threats}
                weaknesses={weaknesses}
                opportunities={opportunities}
                simulation={data.last_simulation}
                complianceUpdated={data.compliance.last_updated}
              />
            </div>
            <AttentionRequired
              meetings={meetings.length > 0 ? meetings : data.recent_meetings}
              threats={threats}
            />
          </div>

          {/* Row 4: Meeting summaries (1/2) + SWOT summary (1/2) */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <MeetingSummaries meetings={meetings.length > 0 ? meetings.slice(0, 3) : data.recent_meetings} />
            <SWOTSummaryCard
              strengths={strengths}
              weaknesses={weaknesses}
              opportunities={opportunities}
              threats={threats}
            />
          </div>

        </div>
      )}
    </div>
  );
}
