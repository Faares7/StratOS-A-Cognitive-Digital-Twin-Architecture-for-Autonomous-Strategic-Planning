"use client";

import React, { useState, useCallback } from "react";
import Link from "next/link";
import { MessageSquare, ArrowRight, Loader2, Play, Target, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { runAgentAndWait } from "@/services/agentApi";
import { useAgentResults } from "@/contexts/AgentResultsContext";
import type { InsightCard } from "@/types";

export function SocialMediaWidget() {
  const { results, addInsights, setSocialMeta } = useAgentResults();
  const { socialMeta } = results;

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const result = await runAgentAndWait("social", { intervalMs: 3_000 }) as {
        insights?: InsightCard[];
        total_posts_analyzed?: number;
        opportunities?: number;
        threats?: number;
      };
      if (result?.insights && result.insights.length > 0) {
        addInsights(result.insights);
      }
      setSocialMeta({
        postsAnalyzed: result?.total_posts_analyzed ?? 0,
        opportunities: result?.opportunities ?? 0,
        threats: result?.threats ?? 0,
        lastRun: new Date().toISOString(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Social media agent failed");
    } finally {
      setRunning(false);
    }
  }, [addInsights, setSocialMeta]);

  const lastRunLabel = socialMeta
    ? new Date(socialMeta.lastRun).toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : null;

  return (
    <div className="flex flex-col rounded-xl border border-white/5 bg-[#0d1117]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">Social Media Intel</h3>
          <p className="text-[10px] text-slate-500">Facebook student group sentiment · Groq NLP</p>
        </div>
        <MessageSquare className="h-4 w-4 text-slate-600" />
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        {socialMeta ? (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20 px-3 py-2">
                <Target className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                <div>
                  <p className="text-lg font-bold text-cyan-400">{socialMeta.opportunities}</p>
                  <p className="text-[10px] text-slate-500">Opportunities</p>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                <div>
                  <p className="text-lg font-bold text-rose-400">{socialMeta.threats}</p>
                  <p className="text-[10px] text-slate-500">Threats</p>
                </div>
              </div>
            </div>

            {/* Posts analyzed */}
            <div className="rounded-lg bg-white/5 px-3 py-2 text-center">
              <p className="text-xl font-bold text-slate-100">{socialMeta.postsAnalyzed}</p>
              <p className="text-[10px] text-slate-500">posts analyzed</p>
            </div>

            {/* Last run */}
            <p className="text-center text-[10px] text-slate-600">Last run: {lastRunLabel}</p>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center py-4 text-center">
            <MessageSquare className="h-6 w-6 text-slate-700 mb-2" />
            <p className="text-xs text-slate-500">No analysis yet</p>
            <p className="text-[10px] text-slate-700 mt-0.5">Run to analyze Facebook group posts</p>
          </div>
        )}

        {/* Run button */}
        <button
          onClick={run}
          disabled={running}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-all",
            running
              ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
              : "border-white/10 bg-white/5 text-slate-400 hover:border-cyan-500/30 hover:text-slate-200 disabled:opacity-40"
          )}
        >
          {running ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" />Analyzing…</>
          ) : (
            <><Play className="h-3.5 w-3.5" />{socialMeta ? "Re-run Analysis" : "Run Analysis"}</>
          )}
        </button>

        {error && (
          <p className="text-center text-[10px] text-rose-400">{error}</p>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-white/5 px-4 py-2.5">
        <Link
          href="/swot"
          className="flex items-center gap-1 text-xs text-cyan-400 transition-colors hover:text-cyan-300"
        >
          View SWOT insights
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
