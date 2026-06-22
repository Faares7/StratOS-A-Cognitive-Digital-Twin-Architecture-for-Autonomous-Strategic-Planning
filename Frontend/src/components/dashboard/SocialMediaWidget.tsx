"use client";

import React, { useState, useCallback } from "react";
import Link from "next/link";
import { MessageSquare, ArrowRight, Loader2, Play, Target, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { runAgentAndWait } from "@/services/agentApi";
import { useAgentResults } from "@/contexts/AgentResultsContext";
import type { InsightCard } from "@/types";

export function SocialMediaWidget() {
  const { results, setAgentInsights, setSocialMeta } = useAgentResults();
  const { socialMeta } = results;

  const [running, setRunning] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const result = await runAgentAndWait("social", { intervalMs: 3_000 }) as {
        insights?:              InsightCard[];
        total_posts_analyzed?:  number;
        opportunities?:         number;
        threats?:               number;
      };
      if (result?.insights && result.insights.length > 0) {
        const tagged = result.insights.map((i) => ({ ...i, source_agent: "social_media" }));
        setAgentInsights("social_media", tagged);
      }
      setSocialMeta({
        postsAnalyzed: result?.total_posts_analyzed ?? 0,
        opportunities: result?.opportunities ?? 0,
        threats:       result?.threats ?? 0,
        lastRun:       new Date().toISOString(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Social media agent failed");
    } finally {
      setRunning(false);
    }
  }, [setAgentInsights, setSocialMeta]);

  const lastRunLabel = socialMeta
    ? new Date(socialMeta.lastRun).toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : null;

  return (
    <div className="flex flex-col rounded-xl border border-white/[0.07] bg-[#0f1422]">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <div>
          <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-[#e0e4ef]">
            Social Media Intel
          </h3>
          <p className="text-[11px] text-[#505672]">Facebook student group sentiment · Groq NLP</p>
        </div>
        <MessageSquare className="h-4 w-4 text-[#2b2f45]" />
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        {socialMeta ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-2 rounded-lg border border-[#0ea0c0]/20 bg-[#0ea0c0]/10 px-3 py-2">
                <Target className="h-3.5 w-3.5 text-[#0ea0c0] shrink-0" />
                <div>
                  <p className="text-[18px] font-bold tabular-nums leading-none text-[#0ea0c0]">
                    {socialMeta.opportunities}
                  </p>
                  <p className="mt-0.5 text-[10px] text-[#505672]">Opportunities</p>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-[#d44452]/20 bg-[#d44452]/10 px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 text-[#d44452] shrink-0" />
                <div>
                  <p className="text-[18px] font-bold tabular-nums leading-none text-[#d44452]">
                    {socialMeta.threats}
                  </p>
                  <p className="mt-0.5 text-[10px] text-[#505672]">Threats</p>
                </div>
              </div>
            </div>

            <div className="rounded-lg bg-[#171e30] px-3 py-2 text-center">
              <p className="text-[22px] font-bold tabular-nums leading-none text-[#e0e4ef]">
                {socialMeta.postsAnalyzed}
              </p>
              <p className="mt-0.5 text-[10px] text-[#505672]">posts analyzed</p>
            </div>

            <p className="text-center text-[10px] text-[#2b2f45]">Last run: {lastRunLabel}</p>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center py-4 text-center">
            <MessageSquare className="mb-2 h-6 w-6 text-[#2b2f45]" />
            <p className="text-[12px] text-[#505672]">No analysis yet</p>
            <p className="mt-0.5 text-[10px] text-[#2b2f45]">Run to analyze Facebook group posts</p>
          </div>
        )}

        <button
          onClick={run}
          disabled={running}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-medium transition-all duration-150",
            running
              ? "border-[#b8922f]/30 bg-[#b8922f]/10 text-[#b8922f]"
              : "border-white/[0.08] bg-white/[0.03] text-[#505672] hover:border-[#b8922f]/25 hover:text-[#8d97b8] disabled:opacity-40"
          )}
        >
          {running ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" />Analyzing…</>
          ) : (
            <><Play className="h-3.5 w-3.5" />{socialMeta ? "Re-run Analysis" : "Run Analysis"}</>
          )}
        </button>

        {error && (
          <p className="text-center text-[10px] text-[#d44452]">{error}</p>
        )}
      </div>

      <div className="border-t border-white/[0.06] px-4 py-2.5">
        <Link
          href="/swot"
          className="flex items-center gap-1 text-[12px] text-[#b8922f] transition-colors duration-150 hover:text-[#c9a84c]"
        >
          View SWOT insights
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
