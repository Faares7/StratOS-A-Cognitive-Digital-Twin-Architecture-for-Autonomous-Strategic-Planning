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

// Insights are stored per-agent so running agent X replaces only X's slot.
// The displayed board is Object.values(agentInsights).flat().
interface AgentResults {
  agentInsights: Record<string, InsightCard[]>;
  research: ResearchIntelligence | null;
  socialMeta: SocialMeta | null;
}

interface ContextValue {
  results: AgentResults;
  // Flat view used by consumers
  insights: InsightCard[];
  setAgentInsights: (agent: string, insights: InsightCard[]) => void;
  setResearch: (data: ResearchIntelligence) => void;
  setSocialMeta: (meta: SocialMeta) => void;
  clearAll: () => void;
}

// ── Reducer ───────────────────────────────────────────────────────────────────

type Action =
  | { type: "SET_AGENT"; agent: string; insights: InsightCard[] }
  | { type: "SET_RESEARCH"; data: ResearchIntelligence }
  | { type: "SET_SOCIAL_META"; meta: SocialMeta }
  | { type: "LOAD"; results: AgentResults }
  | { type: "CLEAR" };

const DEFAULT: AgentResults = { agentInsights: {}, research: null, socialMeta: null };
const STORAGE_KEY = "stratos_swot_v1";

function reducer(state: AgentResults, action: Action): AgentResults {
  switch (action.type) {
    case "SET_AGENT":
      return {
        ...state,
        agentInsights: { ...state.agentInsights, [action.agent]: action.insights },
      };
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
  insights: [],
  setAgentInsights: () => {},
  setResearch: () => {},
  setSocialMeta: () => {},
  clearAll: () => {},
});

// ── Provider ──────────────────────────────────────────────────────────────────

export function AgentResultsProvider({ children }: { children: React.ReactNode }) {
  const [results, dispatch] = useReducer(reducer, DEFAULT);

  // Restore from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: AgentResults = JSON.parse(raw);
        if (parsed.agentInsights) {
          dispatch({ type: "LOAD", results: parsed });
        }
      }
    } catch {
      // Corrupted storage — ignore
    }
  }, []);

  // Persist to localStorage on every change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(results));
    } catch {
      // Storage full or unavailable — ignore
    }
  }, [results]);

  const setAgentInsights = useCallback((agent: string, insights: InsightCard[]) => {
    dispatch({ type: "SET_AGENT", agent, insights });
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

  // Flat view: all agents' insights combined
  const insights = Object.values(results.agentInsights).flat();

  return (
    <AgentResultsContext.Provider
      value={{ results, insights, setAgentInsights, setResearch, setSocialMeta, clearAll }}
    >
      {children}
    </AgentResultsContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAgentResults() {
  return useContext(AgentResultsContext);
}
