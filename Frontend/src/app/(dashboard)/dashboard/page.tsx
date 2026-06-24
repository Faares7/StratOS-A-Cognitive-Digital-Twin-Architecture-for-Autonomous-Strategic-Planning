"use client";

import React from "react";
import Link from "next/link";
import { BarChart2, ArrowRight } from "lucide-react";
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

          {/* Benchmarking card */}
          <div className="rounded-xl border border-white/[0.07] bg-[#0f1422] px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#b8922f]/10">
                  <BarChart2 className="h-4 w-4 text-[#b8922f]" />
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#505672]">
                    Research Benchmarking
                  </p>
                  <p className="text-sm font-semibold text-[#e0e4ef]">
                    Nile University vs. Egyptian Peers
                  </p>
                </div>
              </div>

              {results.research ? (
                <>
                  <div className="flex items-center gap-8">
                    {[
                      { label: "Rank", value: results.research.nile_university.rank != null ? `#${results.research.nile_university.rank}` : "—" },
                      { label: "Publications", value: results.research.nile_university.publications.toLocaleString() },
                      { label: "H-Index", value: String(results.research.nile_university.h_index) },
                      { label: "Citations", value: results.research.nile_university.total_citations.toLocaleString() },
                    ].map(({ label, value }) => (
                      <div key={label} className="text-center">
                        <p className="text-lg font-bold text-[#e0e4ef]">{value}</p>
                        <p className="text-[10px] uppercase tracking-wider text-[#505672]">{label}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-[#505672]">
                      {results.research.competitors.length} competitors tracked
                      {results.research.data_source === "live" && (
                        <span className="ml-1.5 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] text-emerald-400">Live</span>
                      )}
                    </span>
                    <Link
                      href="/research"
                      className="flex items-center gap-1.5 rounded-lg border border-[#b8922f]/30 bg-[#b8922f]/10 px-3 py-1.5 text-xs font-medium text-[#b8922f] transition-colors hover:bg-[#b8922f]/20"
                    >
                      View Details <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-3">
                  <p className="text-xs text-[#505672]">
                    No benchmark data — run the agent from Research Intelligence
                  </p>
                  <Link
                    href="/research"
                    className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-[#8d97b8] transition-colors hover:border-[#b8922f]/30 hover:text-[#b8922f]"
                  >
                    Go to Research <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              )}
            </div>
          </div>

          {/* Row 1: Intelligence feed (2/3) + Attention required (1/3) */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <IntelligenceFeed
                meetings={meetings.length > 0 ? meetings : data.recent_meetings}
                threats={threats}
                weaknesses={weaknesses}
                opportunities={opportunities}
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
