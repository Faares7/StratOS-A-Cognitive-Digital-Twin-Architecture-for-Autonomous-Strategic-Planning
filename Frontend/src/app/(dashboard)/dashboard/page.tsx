"use client";

import React from "react";
import { useDashboard } from "@/hooks/useDashboard";
import { useAgentResults } from "@/contexts/AgentResultsContext";
import { Header } from "@/components/layout/Header";
import { ComplianceHeader } from "@/components/dashboard/ComplianceHeader";
import { KPIGrid } from "@/components/dashboard/KPIGrid";
import { SWOTSummaryCard } from "@/components/dashboard/SWOTSummaryCard";
import { MeetingSummaries } from "@/components/dashboard/MeetingSummaries";
import { ScenarioWidget } from "@/components/dashboard/ScenarioWidget";
import { CompetitiveIntelWidget } from "@/components/dashboard/CompetitiveIntelWidget";
import { SocialMediaWidget } from "@/components/dashboard/SocialMediaWidget";

function Skeleton({ className }: { className?: string }) {
  return <div className={`skeleton rounded-xl ${className ?? ""}`} />;
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-5 p-6 animate-fade-in">
      <Skeleton className="h-28" />
      <div className="grid grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
      </div>
      <div className="grid grid-cols-3 gap-5">
        <div className="col-span-2"><Skeleton className="h-72" /></div>
        <Skeleton className="h-72" />
      </div>
      <div className="grid grid-cols-3 gap-5">
        <Skeleton className="h-52" />
        <Skeleton className="h-52" />
        <Skeleton className="h-52" />
      </div>
    </div>
  );
}

export default function CommandCenterPage() {
  const { data, loading, error } = useDashboard();

  // Pull live agent results from the global persistent context.
  // If agents have been run (on any page), their insights appear here automatically.
  const { results } = useAgentResults();
  const liveInsights = results.insights;
  const researchData = results.research;

  // Always use live agent results — show empty state until agents are run
  const swotSummary = {
    strengths:     liveInsights.filter((i) => i.category === "strength"),
    weaknesses:    liveInsights.filter((i) => i.category === "weakness"),
    opportunities: liveInsights.filter((i) => i.category === "opportunity"),
    threats:       liveInsights.filter((i) => i.category === "threat"),
  };

  return (
    <div className="flex min-h-full flex-col">
      <Header
        title="Command Center"
        subtitle="Welcome back, Dr. Sarah Chen. Here's your strategic overview."
      />

      {loading && <LoadingSkeleton />}

      {error && (
        <div className="m-6 rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-400">
          Failed to load dashboard: {error}
        </div>
      )}

      {data && (
        <div className="flex flex-col gap-5 p-6 animate-fade-in">
          <ComplianceHeader compliance={data.compliance} />
          <KPIGrid metrics={data.kpis} />

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <SWOTSummaryCard
                strengths={swotSummary.strengths}
                weaknesses={swotSummary.weaknesses}
                opportunities={swotSummary.opportunities}
                threats={swotSummary.threats}
              />
            </div>
            <MeetingSummaries meetings={data.recent_meetings} />
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <CompetitiveIntelWidget data={researchData} />
            <ScenarioWidget simulation={data.last_simulation} />
            <SocialMediaWidget />
          </div>
        </div>
      )}
    </div>
  );
}
