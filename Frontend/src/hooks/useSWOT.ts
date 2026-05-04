"use client";

import { useState, useCallback } from "react";
import { runAgentAndWait, type AgentName } from "@/services/agentApi";
import { useAgentResults } from "@/contexts/AgentResultsContext";
import type { InsightCard, SwotCategory, NaqaaePillar } from "@/types";

export type SwotAgentName = Extract<AgentName, "tech" | "workforce" | "sentiment" | "social">;

export function useSWOT() {
  const [categoryFilter, setCategoryFilter] = useState<SwotCategory | "all">("all");
  const [pillarFilter, setPillarFilter] = useState<NaqaaePillar | "all">("all");
  const [agentRunning, setAgentRunning] = useState<SwotAgentName | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);

  const { results, addInsights, setSocialMeta } = useAgentResults();

  const runAgent = useCallback(async (agentName: SwotAgentName) => {
    setAgentRunning(agentName);
    setAgentError(null);
    try {
      const result = await runAgentAndWait(agentName, { intervalMs: 3_000 }) as {
        insights?: InsightCard[];
        total_posts_analyzed?: number;
        opportunities?: number;
        threats?: number;
      };
      if (result?.insights && result.insights.length > 0) {
        addInsights(result.insights);
      }
      if (agentName === "social" && result?.total_posts_analyzed != null) {
        setSocialMeta({
          postsAnalyzed: result.total_posts_analyzed,
          opportunities: result.opportunities ?? 0,
          threats: result.threats ?? 0,
          lastRun: new Date().toISOString(),
        });
      }
    } catch (err) {
      setAgentError(
        err instanceof Error ? err.message : `${agentName} agent failed`
      );
    } finally {
      setAgentRunning(null);
    }
  }, [addInsights, setSocialMeta]);

  const filtered = results.insights.filter((i) => {
    const matchCat = categoryFilter === "all" || i.category === categoryFilter;
    const matchPillar = pillarFilter === "all" || i.pillar_tag === pillarFilter;
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
    loading: false,
    error: null,
    categoryFilter,
    setCategoryFilter,
    pillarFilter,
    setPillarFilter,
    runAgent,
    agentRunning,
    agentError,
  };
}
