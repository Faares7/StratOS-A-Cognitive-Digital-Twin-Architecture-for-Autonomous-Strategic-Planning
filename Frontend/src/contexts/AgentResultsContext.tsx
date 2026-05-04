"use client";

import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
} from "react";
import type { InsightCard, ResearchIntelligence } from "@/types";

// ── Shape ─────────────────────────────────────────────────────────────────────

interface SocialMeta {
  postsAnalyzed: number;
  opportunities: number;
  threats: number;
  lastRun: string;
}

interface AgentResults {
  insights: InsightCard[];
  research: ResearchIntelligence | null;
  socialMeta: SocialMeta | null;
}

interface ContextValue {
  results: AgentResults;
  addInsights: (newInsights: InsightCard[]) => void;
  setResearch: (data: ResearchIntelligence) => void;
  setSocialMeta: (meta: SocialMeta) => void;
  clearAll: () => void;
}

// ── Reducer ───────────────────────────────────────────────────────────────────

type Action =
  | { type: "ADD_INSIGHTS"; insights: InsightCard[] }
  | { type: "SET_RESEARCH"; data: ResearchIntelligence }
  | { type: "SET_SOCIAL_META"; meta: SocialMeta }
  | { type: "LOAD"; results: AgentResults }
  | { type: "CLEAR" };

const DEFAULT: AgentResults = { insights: [], research: null, socialMeta: null };
const STORAGE_KEY = "stratos_agent_results_v2";

function reducer(state: AgentResults, action: Action): AgentResults {
  switch (action.type) {
    case "ADD_INSIGHTS": {
      const liveIds = new Set(action.insights.map((i) => i.id));
      const base = state.insights.filter((i) => !liveIds.has(i.id));
      return { ...state, insights: [...base, ...action.insights] };
    }
    case "SET_RESEARCH":
      return { ...state, research: action.data };
    case "SET_SOCIAL_META":
      return { ...state, socialMeta: action.meta };
    case "LOAD":
      return { ...DEFAULT, ...action.results };
    case "CLEAR":
      return DEFAULT;
    default:
      return state;
  }
}

// ── Context ───────────────────────────────────────────────────────────────────

const AgentResultsContext = createContext<ContextValue>({
  results: DEFAULT,
  addInsights: () => {},
  setResearch: () => {},
  setSocialMeta: () => {},
  clearAll: () => {},
});

// ── Provider ──────────────────────────────────────────────────────────────────

export function AgentResultsProvider({ children }: { children: React.ReactNode }) {
  const [results, dispatch] = useReducer(reducer, DEFAULT);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: AgentResults = JSON.parse(raw);
        if (parsed.insights || parsed.research || parsed.socialMeta) {
          dispatch({ type: "LOAD", results: parsed });
        }
      }
    } catch {
      // Corrupted storage — ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(results));
    } catch {
      // Storage full or unavailable — ignore
    }
  }, [results]);

  const addInsights = useCallback((newInsights: InsightCard[]) => {
    dispatch({ type: "ADD_INSIGHTS", insights: newInsights });
  }, []);

  const setResearch = useCallback((data: ResearchIntelligence) => {
    dispatch({ type: "SET_RESEARCH", data });
  }, []);

  const setSocialMeta = useCallback((meta: SocialMeta) => {
    dispatch({ type: "SET_SOCIAL_META", meta });
  }, []);

  const clearAll = useCallback(() => {
    dispatch({ type: "CLEAR" });
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }, []);

  return (
    <AgentResultsContext.Provider value={{ results, addInsights, setResearch, setSocialMeta, clearAll }}>
      {children}
    </AgentResultsContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAgentResults() {
  return useContext(AgentResultsContext);
}
