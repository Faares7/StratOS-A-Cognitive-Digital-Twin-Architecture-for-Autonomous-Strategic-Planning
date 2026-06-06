"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { runAgentAndWait, fetchLatestResults, type AgentName } from "@/services/agentApi";
import { useAgentResults } from "@/contexts/AgentResultsContext";
import type { InsightCard, SwotCategory, NaqaaePillar } from "@/types";

export type SwotAgentName = Extract<AgentName, "tech" | "workforce" | "sentiment" | "social">;

// Maps frontend agent names to the agent_id values stored in the DB
const AGENT_ID_MAP: Record<SwotAgentName, string> = {
  tech:       "tech",
  workforce:  "workforce",
  sentiment:  "sentiment_analysis",
  social:     "social_media",
};

export function useSWOT() {
  const [categoryFilter, setCategoryFilter] = useState<SwotCategory | "all">("all");
  const [pillarFilter, setPillarFilter]     = useState<NaqaaePillar | "all">("all");
  const [agentRunning, setAgentRunning]     = useState<SwotAgentName | null>(null);
  const [agentError, setAgentError]         = useState<string | null>(null);
  const [dbLoading, setDbLoading]           = useState(false);

  const { insights: allInsights, setAgentInsights, setSocialMeta, clearAll } = useAgentResults();

  // Tracks whether the user has triggered a live run this session.
  // First run wipes the board so DB-loaded data never mixes with fresh results.
  const hasStartedFreshRun = useRef(false);

  // ── Live agent run — clears board on first run, then fills slot ───────────
  const runAgent = useCallback(async (agentName: SwotAgentName) => {
    setAgentRunning(agentName);
    setAgentError(null);

    // First live run of the session: wipe DB-loaded data for a clean slate
    if (!hasStartedFreshRun.current) {
      hasStartedFreshRun.current = true;
      clearAll();
    }

    try {
      const result = await runAgentAndWait(agentName, { intervalMs: 3_000 }) as {
        insights?: InsightCard[];
        total_posts_analyzed?: number;
        opportunities?: number;
        threats?: number;
      };

      if (result?.insights && result.insights.length > 0) {
        const tagged = result.insights.map((i) => ({
          ...i,
          source_agent: AGENT_ID_MAP[agentName],
        }));
        setAgentInsights(AGENT_ID_MAP[agentName], tagged);
      }

      if (agentName === "social" && result?.total_posts_analyzed != null) {
        setSocialMeta({
          postsAnalyzed: result.total_posts_analyzed,
          opportunities: result.opportunities ?? 0,
          threats:       result.threats       ?? 0,
          lastRun:       new Date().toISOString(),
        });
      }
    } catch (err) {
      setAgentError(
        err instanceof Error ? err.message : `${agentName} agent failed`
      );
    } finally {
      setAgentRunning(null);
    }
  }, [setAgentInsights, setSocialMeta]);

  // ── DB load — fills each agent's slot from the last stored run ───────────
  const loadFromDb = useCallback(async () => {
    setDbLoading(true);
    setAgentError(null);
    try {
      const { insights } = await fetchLatestResults();

      // Group by source_agent and set each slot independently
      const byAgent: Record<string, InsightCard[]> = {};
      for (const insight of insights) {
        const agent = insight.source_agent ?? "unknown";
        if (!byAgent[agent]) byAgent[agent] = [];
        byAgent[agent].push(insight);
      }
      for (const [agent, agentInsights] of Object.entries(byAgent)) {
        setAgentInsights(agent, agentInsights);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load from database";
      console.error("[useSWOT] loadFromDb failed:", msg);
      setAgentError(msg);
    } finally {
      setDbLoading(false);
    }
  }, [setAgentInsights]);

  // Auto-load on mount
  useEffect(() => { loadFromDb(); }, [loadFromDb]);

  // ── Filtering ─────────────────────────────────────────────────────────────
  const filtered = allInsights.filter((i) => {
    const matchCat    = categoryFilter === "all" || i.category    === categoryFilter;
    const matchPillar = pillarFilter   === "all" || i.pillar_tag  === pillarFilter;
    return matchCat && matchPillar;
  });

  const byCategory = {
    strength:    filtered.filter((i) => i.category === "strength"),
    weakness:    filtered.filter((i) => i.category === "weakness"),
    opportunity: filtered.filter((i) => i.category === "opportunity"),
    threat:      filtered.filter((i) => i.category === "threat"),
  };

  return {
    insights: filtered,
    byCategory,
    loading:  dbLoading,
    error:    null,
    categoryFilter,  setCategoryFilter,
    pillarFilter,    setPillarFilter,
    runAgent,
    agentRunning,
    agentError,
    dbLoading,
  };
}
