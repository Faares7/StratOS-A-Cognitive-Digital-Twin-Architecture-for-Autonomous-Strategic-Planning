"""
============================================================
  Cognitive Digital Twin (CDT) — Zone 2: External Scout Squad
  Tech Intelligence Cluster — LangGraph Multi-Agent Workflow
  Nile University | College of IT & Computer Science
============================================================

ARCHITECTURE:
    ┌─────────────────────────────────────────────────────┐
    │              Tech Intelligence Cluster               │
    │                                                     │
    │   [Developer Scout] [Cyber Scout] [Market Scout]    │
    │         ↓                ↓              ↓           │
    │         └────────────────┴──────────────┘           │
    │                          ↓                          │
    │              [Tech Intelligence Lead]               │
    │                          ↓                          │
    │             {Opportunities + Threats JSON}           │
    └─────────────────────────────────────────────────────┘

DEPENDENCIES:
    pip install langgraph langchain-core langchain-google-genai requests python-dotenv

API KEYS REQUIRED (in .env file or environment):
    GITHUB_TOKEN    — optional, increases rate limit (unauthenticated: 60 req/hr)
    SERPAPI_KEY     — required for Market Scout (https://serpapi.com)
    GEMINI_API_KEY  — required for Lead Agent synthesis
"""

import os
import json
import logging
import requests
from datetime import datetime
from typing import TypedDict, Annotated, Optional
from dotenv import load_dotenv

# LangGraph & LangChain imports
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langchain_core.messages import HumanMessage, AIMessage
from typing import TypedDict, Annotated, Optional, List, Literal
from pydantic import BaseModel, Field
from core.llm import JSON_GUARDRAIL, local_brain
from core.persistence import build_envelope, save_envelope

# ─── Logging Setup ──────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s │ %(levelname)-8s │ %(name)s │ %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("CDT.TechCluster")

# ─── Environment Variables ────────────────────────────────────────────────────
load_dotenv()

GITHUB_TOKEN  = os.getenv("GITHUB_TOKEN",  "")          # optional
SERPAPI_KEY   = os.getenv("SERPAPI_KEY",   "")          # required for real data
# ══════════════════════════════════════════════════════════════════════════════
#  1.5 PYDANTIC SCHEMAS (The Strict Grading Rubric)
# ══════════════════════════════════════════════════════════════════════════════

class StrategicOpportunity(BaseModel):
    id: str
    title: str
    signal_sources: List[str]
    description: str
    recommended_action: str
    priority: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"] = Field(
        description="HIGH: Immediate market demand. MEDIUM: Future tech trend (GitHub) with no immediate jobs. LOW: Niche trend."
    )
    time_horizon: str

class StrategicThreat(BaseModel):
    id: str
    title: str
    signal_sources: List[str]
    description: str
    recommended_action: str
    priority: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"] = Field(
        description="CRITICAL: Immediate active exploit threatening university infrastructure. HIGH: Serious vulnerability."
    )
    time_horizon: str

class StrategicOutput(BaseModel):
    analysis_date: str
    executive_summary: str
    opportunities: List[StrategicOpportunity]
    threats: List[StrategicThreat]
    key_deltas: List[str] = Field(
        description="List the conflicts where GitHub trends do not match local Job Market realities."
    )
    confidence_score: float = Field(
        description="Score 0.0 to 1.0. Deduct 0.1 for every major conflict between GitHub trends and SerpApi data."
    )


# ══════════════════════════════════════════════════════════════════════════════
#  1. GRAPH STATE DEFINITION
# ══════════════════════════════════════════════════════════════════════════════

class TechClusterState(TypedDict):
    """
    Central shared state passed between all nodes in the LangGraph.

    Each Scout writes its output to a dedicated key.
    The Lead agent reads all three keys and writes to `final_strategic_output`.
    """
    # ── Scout Outputs (filled in parallel) ──────────────────────────────────
    developer_scout_output: Optional[dict]   # GitHub trending → emerging tech stacks
    cyber_scout_output:     Optional[dict]   # CISA KEV feed   → critical vulnerabilities
    market_scout_output:    Optional[dict]   # SerpApi Jobs    → local hiring trends

    # ── Lead Agent Final Output ──────────────────────────────────────────────
    final_strategic_output: Optional[dict]   # {opportunities: [...], threats: [...]}

    # ── Metadata ─────────────────────────────────────────────────────────────
    run_timestamp: str
    errors: Annotated[list[str], lambda a, b: (a or []) + (b or [])]  # non-fatal errors accumulate here

import random



# ══════════════════════════════════════════════════════════════════════════════
#  2. SCOUT AGENTS (Parallel Nodes)
# ══════════════════════════════════════════════════════════════════════════════
# Strategic Keyword Taxonomy for Nile University
SEARCH_TAXONOMY = {
    "market_roles": [
        "Cloud Architect", "DevOps Engineer", "Machine Learning Engineer", 
        "Cybersecurity Analyst", "Full Stack Developer", "AI Engineer"
    ],
    "github_topics": [
        "LLM", "Agentic AI", "RAG", "WebAssembly", "Zero-Knowledge"
    ],
    "github_languages": [
        "Rust", "TypeScript", "Go", "Zig", "Python"
    ]
}

# ── 2a. Developer Scout — GitHub REST API ─────────────────────────────────────

GITHUB_HEADERS = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    **({"Authorization": f"Bearer {GITHUB_TOKEN}"} if GITHUB_TOKEN else {}),
}


def developer_scout_node(state: TechClusterState) -> TechClusterState:
    """
    TOOL: GitHub REST API — Search for highly-starred repositories created in
    the last 30 days to surface emerging tech stacks.
    """
    logger.info("🔭 [Developer Scout] Starting — querying GitHub Trending ...")

    try:
        # GitHub Search: repos created in last 30 days, sorted by stars
        # Join all topics and languages with " OR "
        all_topics = " OR ".join(SEARCH_TAXONOMY["github_topics"])
        # e.g., "LLM OR Agentic AI OR RAG"
        
        since_date = "2025-03-15"
        
        # Broad query: Find any of these topics, written in any language
        query = f"({all_topics}) created:>{since_date}"
        
        url = "https://api.github.com/search/repositories"
        params = {
            "q": query,
            "sort": "stars",
            "order": "desc",
            "per_page": 30, # Increased from 10 to 30 to capture more data
        }

        resp = requests.get(url, headers=GITHUB_HEADERS, params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()

        top_repos = data.get("items", [])[:10]  # Get top 10 repos to analyze
        stacks = []
        for i, repo in enumerate(top_repos, 1):
            stacks.append({
                "rank": i,
                "name": repo.get("name"),
                "full_name": repo.get("full_name"),
                "stars": repo.get("stargazers_count"),
                "language": repo.get("language"),
                "description": repo.get("description", ""),
                "topics": repo.get("topics", []),
                "url": repo.get("html_url"),
            })

        output = {
            "source": "GitHub REST API (LIVE)",
            "retrieved_at": datetime.utcnow().isoformat(),
            "top_emerging_stacks": stacks,
        }
        logger.info("🔭 [Developer Scout] ✅ Success — %d stacks found.", len(stacks))
        return {"developer_scout_output": output}

    except Exception as exc:
        logger.error("🔭 [Developer Scout] ❌ Error: %s", exc)
        errors = state.get("errors", []) + [f"DeveloperScout: {exc}"]
        return {"developer_scout_output": {}, "errors": errors}


# ── 2b. Cyber Scout — CISA KEV Feed (No Auth Required) ───────────────────────

CISA_KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"

# Keywords that make a CVE relevant to educational/enterprise environments
EDU_ENTERPRISE_KEYWORDS = [
    "microsoft", "windows", "office", "exchange", "sharepoint",
    "cisco", "vmware", "fortinet", "vpn", "ssl", "tls",
    "apache", "nginx", "linux", "kernel",
    "citrix", "oracle", "java", "adobe",
    "remote", "authentication", "privilege", "injection",
    # Added University-Specific Targets:
    "moodle", "active directory", "ransomware", "blackboard", "canvas" 
]


def cyber_scout_node(state: TechClusterState) -> TechClusterState:
    """
    TOOL: CISA KEV (Known Exploited Vulnerabilities) public JSON feed.
    No authentication required. Filters for edu/enterprise-relevant CVEs.
    """
    logger.info("🛡  [Cyber Scout] Starting — fetching CISA KEV feed ...")

    try:
        resp = requests.get(CISA_KEV_URL, timeout=20)
        resp.raise_for_status()
        data = resp.json()

        vulns = data.get("vulnerabilities", [])
        logger.info("🛡  [Cyber Scout] Total KEV entries: %d", len(vulns))

        # Filter: only CVEs relevant to edu/enterprise environments
        relevant = [
            v for v in vulns
            if any(
                kw in (v.get("vendorProject", "") + v.get("product", "") +
                       v.get("shortDescription", "")).lower()
                for kw in EDU_ENTERPRISE_KEYWORDS
            )
        ]

        # Sort by dateAdded descending (most recent first)
        relevant.sort(key=lambda v: v.get("dateAdded", ""), reverse=True)
        top3 = relevant[:3]

        critical_vulns = []
        for i, v in enumerate(top3, 1):
            critical_vulns.append({
                "rank": i,
                "cveID": v.get("cveID"),
                "vendorProject": v.get("vendorProject"),
                "product": v.get("product"),
                "vulnerabilityName": v.get("vulnerabilityName"),
                "dateAdded": v.get("dateAdded"),
                "shortDescription": v.get("shortDescription"),
                "requiredAction": v.get("requiredAction"),
            })

        output = {
            "source": "CISA KEV Feed (LIVE)",
            "retrieved_at": datetime.utcnow().isoformat(),
            "total_kev_entries": len(vulns),
            "edu_enterprise_relevant_count": len(relevant),
            "critical_vulnerabilities": critical_vulns,
        }
        logger.info("🛡  [Cyber Scout] ✅ Success — %d critical CVEs selected.", len(critical_vulns))
        return {"cyber_scout_output": output}

    except Exception as exc:
        logger.error("🛡  [Cyber Scout] ❌ Error: %s", exc)
        errors = state.get("errors", []) + [f"CyberScout: {exc}"]
        return {"cyber_scout_output": {}, "errors": errors}


# ── 2c. Market Scout — SerpApi Google Jobs ────────────────────────────────────

SERPAPI_BASE_URL = "https://serpapi.com/search"


def market_scout_node(state: TechClusterState) -> TechClusterState:
    """
    TOOL: SerpApi — Google Jobs search for Software Engineer / IT roles in Egypt.
    Identifies present-day employer demand signals.
    """
    logger.info("📊 [Market Scout] Starting — querying SerpApi Google Jobs (Egypt) ...")

    try:
        all_jobs = []
        # Loop through every single role
        for role in SEARCH_TAXONOMY["market_roles"]:
            params = {
                "engine": "google_jobs",
                "q": role,            # Search one role at a time
                "location": "Egypt",
                "gl": "eg",
                "num": "30",          # Get 30 jobs for THIS role
                "api_key": SERPAPI_KEY,
            }
            resp = requests.get(SERPAPI_BASE_URL, params=params)
            jobs = resp.json().get("jobs_results", [])
            all_jobs.extend(jobs)     # Add them to our master list

        # ~180 jobs across all 6 roles
        logger.info("📊 [Market Scout] Raw jobs returned: %d", len(all_jobs))

        # ── Aggregate skill frequency ──────────────────────────────────────
        skill_freq: dict[str, int] = {}
        SKILL_KEYWORDS = [
            "Python", "Java", "TypeScript", "Rust", "Go",
            "AWS", "Azure", "GCP", "Docker", "Kubernetes", "Terraform",
            "Machine Learning", "LLM", "Data Science", "DevOps", "CI/CD",
            "Cybersecurity", "Zero Trust", "GraphQL", "Apache Kafka"
        ]
        for job in all_jobs:
            desc = (job.get("description") or "").lower()
            for skill in SKILL_KEYWORDS:
                if skill.lower() in desc:
                    skill_freq[skill] = skill_freq.get(skill, 0) + 1

        top_skills = sorted(skill_freq.items(), key=lambda x: x[1], reverse=True)[:10]

        output = {
            "source": "SerpApi Google Jobs (LIVE)",
            "retrieved_at": datetime.utcnow().isoformat(),
            "market": "Egypt / MENA",
            "total_jobs_analyzed": len(all_jobs),
            "top_demanded_skills": [
                {"rank": i + 1, "skill": s, "job_mentions": c}
                for i, (s, c) in enumerate(top_skills)
            ],
        }
        logger.info("📊 [Market Scout] ✅ Success — top skills extracted.")
        return {"market_scout_output": output}

    except Exception as exc:
        logger.error("📊 [Market Scout] ❌ Error: %s", exc)
        errors = state.get("errors", []) + [f"MarketScout: {exc}"]
        return {"market_scout_output": {}, "errors": errors}


# ══════════════════════════════════════════════════════════════════════════════
#  3. TECH INTELLIGENCE LEAD — Synthesis Node (Fan-In)
# ══════════════════════════════════════════════════════════════════════════════

# ── LLM Setup — uses shared local_brain from core.llm ─────────────────────────


LEAD_SYSTEM_PROMPT = """
You are the Tech Intelligence Lead for a Cognitive Digital Twin (CDT) system serving Nile University's
Chief Strategy Officer. Your role is to synthesize raw intelligence from three parallel scout agents
into a final, executive-quality strategic assessment.

You will receive three intelligence packages:
1. DEVELOPER INTELLIGENCE (GitHub) — What developers globally are building RIGHT NOW (future signals).
2. CYBER INTELLIGENCE (CISA KEV)  — What vulnerabilities adversaries are actively exploiting (threats).
3. MARKET INTELLIGENCE (Job Market) — What Egyptian/MENA enterprises are hiring for TODAY (present demand).

Your synthesis task:
- Identify DELTA signals: technologies trending on GitHub but NOT yet appearing in local job postings.
- Identify ALIGNMENT signals: technologies appearing in BOTH GitHub trends AND local job market.
- Identify INSTITUTIONAL THREATS: vulnerabilities directly relevant to university IT infrastructure.
- Identify CURRICULUM OPPORTUNITIES: skill gaps between what employers want and what likely exists.

Output STRICTLY as a JSON object with this exact schema:
{
  "analysis_date": "<ISO date>",
  "executive_summary": "<2-3 sentence synthesis for the CSO>",
  "opportunities": [
    {
      "id": "OPP-T-01",
      "title": "<short title>",
      "signal_sources": ["github", "market"] or ["github"] etc.,
      "description": "<1-2 sentence strategic opportunity>",
      "recommended_action": "<specific action for Nile University>",
      "priority": "HIGH" | "MEDIUM" | "LOW",
      "time_horizon": "0-1 year" | "1-3 years" | "3-5 years"
    }
  ],
  "threats": [
    {
      "id": "THR-T-01",
      "title": "<short title>",
      "signal_sources": ["cisa", "market"] etc.,
      "description": "<1-2 sentence strategic threat>",
      "recommended_action": "<specific mitigation for Nile University>",
      "priority": "CRITICAL" | "HIGH" | "MEDIUM",
      "time_horizon": "IMMEDIATE" | "0-1 year" | "1-3 years"
    }
  ],
  "key_deltas": [
    "<e.g.: GitHub shows Web3 surge but 0 local job postings — monitor, do not invest yet>"
  ],
  "confidence_score": <0.0 to 1.0 float based on data quality>
}

Return ONLY valid JSON. No markdown fences. No commentary outside the JSON object.
""" + JSON_GUARDRAIL


def tech_intelligence_lead_node(state: TechClusterState) -> TechClusterState:
    """
    SYNTHESIS NODE (Fan-In): Waits for all 3 scouts, then uses Gemini to
    synthesize Opportunities and Threats for Nile University's strategic plan.
    """
    logger.info("🧠 [Tech Intelligence Lead] All scouts complete. Starting synthesis ...")

    dev_data    = state.get("developer_scout_output", {})
    cyber_data  = state.get("cyber_scout_output", {})
    market_data = state.get("market_scout_output", {})

    try:
        structured_llm = local_brain.with_structured_output(StrategicOutput)

        user_message = f"""
        Here are the three intelligence packages from your scout agents. 
        === DEVELOPER INTELLIGENCE ===\n{json.dumps(dev_data, indent=2)}
        === CYBER INTELLIGENCE ===\n{json.dumps(cyber_data, indent=2)}
        === MARKET INTELLIGENCE ===\n{json.dumps(market_data, indent=2)}
        """

        messages = [
            HumanMessage(content=LEAD_SYSTEM_PROMPT),
            HumanMessage(content=user_message),
        ]

        # Invoke the structured LLM directly. It returns a Pydantic object, NOT a string!
        response_obj = structured_llm.invoke(messages)
        
        # Convert the perfect Pydantic object back into a standard dictionary for the LangGraph state
        output = response_obj.model_dump()
        
        logger.info(
            "🧠 [Tech Intelligence Lead] ✅ Synthesis complete. "
            "%d Opportunities, %d Threats identified.",
            len(output.get("opportunities", [])),
            len(output.get("threats", [])),
        )
        return {"final_strategic_output": output}

    except Exception as exc:
        logger.error("🧠 [Tech Intelligence Lead] ❌ Error: %s", exc)
        errors = state.get("errors", []) + [f"LeadAgent: {exc}"]
        return {"final_strategic_output": {}, "errors": errors}


# ══════════════════════════════════════════════════════════════════════════════
#  3b. PERSISTENCE NODE — Save unified envelope (O/T, no pillar tagging)
# ══════════════════════════════════════════════════════════════════════════════

def _build_swot_items_from_strategic(final_out: dict) -> list[dict]:
    """Convert tech-agent opportunities/threats into the unified SWOT item shape."""
    items: list[dict] = []
    for opp in (final_out or {}).get("opportunities", []) or []:
        items.append({
            "type": "opportunity",
            "title": opp.get("title"),
            "description": opp.get("description", ""),
            "evidence": opp.get("signal_sources", []),
            "impact_level": (opp.get("priority") or "").lower() or None,
            "source_metadata": {
                "id": opp.get("id"),
                "time_horizon": opp.get("time_horizon"),
                "recommended_action": opp.get("recommended_action"),
            },
        })
    for thr in (final_out or {}).get("threats", []) or []:
        items.append({
            "type": "threat",
            "title": thr.get("title"),
            "description": thr.get("description", ""),
            "evidence": thr.get("signal_sources", []),
            "impact_level": (thr.get("priority") or "").lower() or None,
            "source_metadata": {
                "id": thr.get("id"),
                "time_horizon": thr.get("time_horizon"),
                "recommended_action": thr.get("recommended_action"),
            },
        })
    return items


def save_node(state: TechClusterState) -> dict:
    """Persist the tech-cluster run via the unified pipeline (O/T are not pillar-tagged)."""
    logger.info("☁️ [Database Node] Saving tech intelligence run to Supabase ...")
    envelope = build_envelope(
        agent_id="tech",
        swot_items=_build_swot_items_from_strategic(state.get("final_strategic_output") or {}),
        structured_data={
            "developer_scout_output": state.get("developer_scout_output"),
            "cyber_scout_output":     state.get("cyber_scout_output"),
            "market_scout_output":    state.get("market_scout_output"),
            "final_strategic_output": state.get("final_strategic_output"),
            "run_timestamp":          state.get("run_timestamp"),
        },
        errors=state.get("errors", []),
        status="error" if state.get("errors") else "success",
    )
    save_envelope(envelope)
    return {}


# ══════════════════════════════════════════════════════════════════════════════
#  4. LANGGRAPH CONSTRUCTION — Fan-Out → Fan-In
# ══════════════════════════════════════════════════════════════════════════════

def build_tech_cluster_graph() -> StateGraph:
    """
    Constructs the Tech Intelligence Cluster LangGraph.

    Topology:
        START
          │
          ├──► developer_scout ─────┐
          ├──► cyber_scout    ─────►├──► tech_intelligence_lead ──► END
          └──► market_scout   ─────┘
    """
    graph = StateGraph(TechClusterState)

    # ── Register Nodes ────────────────────────────────────────────────────────
    graph.add_node("developer_scout",         developer_scout_node)
    graph.add_node("cyber_scout",             cyber_scout_node)
    graph.add_node("market_scout",            market_scout_node)
    graph.add_node("tech_intelligence_lead",  tech_intelligence_lead_node)
    graph.add_node("save",                    save_node)

    # ── Fan-Out: START → 3 Parallel Scout Nodes ───────────────────────────────
    graph.add_edge(START,              "developer_scout")
    graph.add_edge(START,              "cyber_scout")
    graph.add_edge(START,              "market_scout")

    # ── Fan-In: All 3 Scouts → Lead Agent ────────────────────────────────────
    # LangGraph waits for ALL incoming edges before firing a node.
    graph.add_edge("developer_scout",  "tech_intelligence_lead")
    graph.add_edge("cyber_scout",      "tech_intelligence_lead")
    graph.add_edge("market_scout",     "tech_intelligence_lead")

    # ── Lead Agent → Save → END ───────────────────────────────────────────────
    graph.add_edge("tech_intelligence_lead", "save")
    graph.add_edge("save", END)

    return graph


def compile_and_run() -> dict:
    """
    Compiles the graph, initializes state, and executes the workflow.
    Returns the final state after the full pipeline completes.
    """
    logger.info("=" * 65)
    logger.info("  CDT Zone 2 — Tech Intelligence Cluster")
    logger.info("  Nile University | College of IT & CS")
    logger.info("=" * 65)

    graph    = build_tech_cluster_graph()
    app      = graph.compile()

    # Initial state
    initial_state: TechClusterState = {
        "developer_scout_output": None,
        "cyber_scout_output":     None,
        "market_scout_output":    None,
        "final_strategic_output": None,
        "run_timestamp":          datetime.utcnow().isoformat(),
        "errors":                 [],
    }

    logger.info("🚀 Invoking graph — scouts will run in parallel ...")
    final_state = app.invoke(initial_state)

    return final_state


# ══════════════════════════════════════════════════════════════════════════════
#  5. PRETTY OUTPUT PRINTER
# ══════════════════════════════════════════════════════════════════════════════

def print_strategic_report(state: dict) -> None:
    """
    Renders the final strategic output to the console in a readable format.
    Also dumps the raw JSON to `tech_intelligence_report.json`.
    """
    result = state.get("final_strategic_output", {})
    if not result:
        print("\n⚠  No final output generated.")
        return

    divider = "─" * 65

    print(f"\n{'═' * 65}")
    print("  TECH INTELLIGENCE REPORT — NILE UNIVERSITY CDT")
    print(f"  Analysis Date : {result.get('analysis_date', 'N/A')}")
    print(f"  Confidence    : {result.get('confidence_score', 'N/A')}")
    print(f"{'═' * 65}")

    print(f"\n📌 EXECUTIVE SUMMARY\n{divider}")
    print(result.get("executive_summary", "N/A"))

    print(f"\n✅ OPPORTUNITIES ({len(result.get('opportunities', []))} identified)")
    print(divider)
    for opp in result.get("opportunities", []):
        print(f"\n  [{opp['id']}] {opp['title']}")
        print(f"  Priority    : {opp['priority']}  |  Horizon: {opp['time_horizon']}")
        print(f"  Sources     : {', '.join(opp.get('signal_sources', []))}")
        print(f"  Description : {opp['description']}")
        print(f"  Action      : {opp['recommended_action']}")

    print(f"\n⚠  THREATS ({len(result.get('threats', []))} identified)")
    print(divider)
    for thr in result.get("threats", []):
        print(f"\n  [{thr['id']}] {thr['title']}")
        print(f"  Priority    : {thr['priority']}  |  Horizon: {thr['time_horizon']}")
        print(f"  Sources     : {', '.join(thr.get('signal_sources', []))}")
        print(f"  Description : {thr['description']}")
        print(f"  Action      : {thr['recommended_action']}")

    print(f"\n🔍 KEY DELTA SIGNALS")
    print(divider)
    for delta in result.get("key_deltas", []):
        print(f"  • {delta}")

    if state.get("errors"):
        print(f"\n⚠  NON-FATAL ERRORS DURING RUN")
        print(divider)
        for err in state["errors"]:
            print(f"  • {err}")

    # Dump full JSON report
    output_path = "tech_intelligence_report.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)
    print(f"\n💾 Full JSON report saved → {output_path}")
    print(f"{'═' * 65}\n")


# ══════════════════════════════════════════════════════════════════════════════
#  6. ENTRY POINT
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    final_state = compile_and_run()
    print_strategic_report(final_state)