"""
agent.py – LangGraph orchestrator for the Workforce Agent.
===========================================================
Implements a three-node, strictly sequential StateGraph:

    load_data_node  →  calculate_metrics_node  →  extract_insights_node

Each node has a single responsibility, enforcing the clean separation
of data loading, metric calculation, and LLM interpretation.

Usage (standalone)
------------------
    python -m zone2_monitoring.workforce_agent.agent

Usage (import)
--------------
    from zone2_monitoring.workforce_agent import app

    result = app.invoke({})
    for insight in result["insights"]:
        print(insight)
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, TypedDict

from dotenv import load_dotenv
from langgraph.graph import END, START, StateGraph
from core.llm import local_brain
from core.persistence import build_envelope, save_envelope

from .prompts import WORKFORCE_ANALYSIS_PROMPT
from .schema import WorkforceInsights
from .tools import calculate_all_hr_metrics

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

load_dotenv()  # Loads GOOGLE_API_KEY (or OPENAI_API_KEY) from .env

# Path to the mock data file — resolved from the project root's Data/ folder.
# __file__ = GRAD/Agents/monitoring/Workforce_agent/agent.py
# .parent×4 = GRAD/
_DEFAULT_DATA_PATH: Path = (
    Path(__file__).parent.parent.parent.parent / "Data" / "real_workforce_data.json"
)


# ---------------------------------------------------------------------------
# State definition
# ---------------------------------------------------------------------------

class WorkforceState(TypedDict):
    """
    Shared state that flows through every node of the LangGraph pipeline.

    Attributes
    ----------
    raw_data : dict
        The parsed content of ``mock_workforce_data.json``.
    calculated_metrics : dict
        The consolidated output of ``calculate_all_hr_metrics()``.
    insights : list[dict]
        The structured HR insights produced by the LLM node.
    data_path : str | None
        Optional override for the JSON data file location.
    """

    raw_data: dict[str, Any]
    calculated_metrics: dict[str, Any]
    insights: list[dict[str, Any]]
    data_path: str | None  # optional runtime override


# ---------------------------------------------------------------------------
# Node 1: Load raw data
# ---------------------------------------------------------------------------

def load_data_node(state: WorkforceState) -> dict[str, Any]:
    """
    Read the workforce JSON file from disk and store it in ``raw_data``.

    The file path is resolved in this priority order:
      1. ``state["data_path"]`` if provided at invocation time.
      2. The ``WORKFORCE_DATA_PATH`` environment variable.
      3. The default sibling path ``../../mock_workforce_data.json``.

    Raises
    ------
    FileNotFoundError
        If the resolved path does not exist on disk.
    """
    path_str: str | None = (
        state.get("data_path")
        or os.getenv("WORKFORCE_DATA_PATH")
        or str(_DEFAULT_DATA_PATH)
    )

    data_path = Path(path_str)  # type: ignore[arg-type]

    if not data_path.exists():
        raise FileNotFoundError(
            f"[load_data_node] Workforce data file not found: {data_path}\n"
            "Set the WORKFORCE_DATA_PATH environment variable or pass "
            "'data_path' when invoking the graph."
        )

    with data_path.open("r", encoding="utf-8") as fh:
        raw_data: dict[str, Any] = json.load(fh)

    print(f"📥 [LOAD] Loaded HR data successfully from {data_path}")
    return {"raw_data": raw_data}


# ---------------------------------------------------------------------------
# Node 2: Calculate metrics (pure Python, no LLM)
# ---------------------------------------------------------------------------

def calculate_metrics_node(state: WorkforceState) -> dict[str, Any]:
    """
    Run all HR metric calculators against ``state["raw_data"]`` and
    store the consolidated results in ``calculated_metrics``.

    This node is LLM-free; it performs only deterministic arithmetic.
    """
    raw_data = state["raw_data"]
    metrics = calculate_all_hr_metrics(raw_data)

    print(f"🧮 [MATH] Calculated HR metrics for report_date={metrics.get('report_date', 'unknown')}")
    return {"calculated_metrics": metrics}


# ---------------------------------------------------------------------------
# Node 3: Extract insights via LLM (structured output)
# ---------------------------------------------------------------------------

def extract_insights_node(state: WorkforceState) -> dict[str, Any]:
    """
    Pass the pre-calculated metrics to the LLM and parse the response into
    a ``WorkforceInsights`` object via structured output.

    LLM choice
    ----------
    Uses ``ChatGoogleGenerativeAI`` (Gemini 1.5 Flash) by default.
    Swap for ``ChatOpenAI`` by adjusting the import at the top of this file
    and updating the model name below.

    The chain is:
        WORKFORCE_ANALYSIS_PROMPT | llm.with_structured_output(WorkforceInsights)
    """
    # --- Build chain -------------------------------------------------------
    structured_llm = local_brain.with_structured_output(WorkforceInsights)
    chain = WORKFORCE_ANALYSIS_PROMPT | structured_llm

    # --- Prepare prompt payload --------------------------------------------
    metrics_json: str = json.dumps(state["calculated_metrics"], indent=2, default=str)

    print("🧠 [THINKING] LLM is extracting insights...")

    # --- Invoke chain ------------------------------------------------------
    response: WorkforceInsights = chain.invoke(
        {"calculated_metrics_json": metrics_json}
    )

    insights_as_dicts: list[dict[str, Any]] = [
        insight.model_dump() for insight in response.insights
    ]

    print(f"✅ [DONE] {len(insights_as_dicts)} insight(s) extracted from LLM.")
    return {"insights": insights_as_dicts}


# ---------------------------------------------------------------------------
# Node 4: Categorize S/W and persist via the unified pipeline
# ---------------------------------------------------------------------------

def _build_swot_items_from_insights(insights: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert WorkforceInsights items into the unified SWOT item shape."""
    items: list[dict[str, Any]] = []
    for ins in insights:
        kind = (ins.get("insight_type") or "").lower()
        if kind not in ("strength", "weakness"):
            continue
        items.append({
            "type": kind,
            "title": ins.get("metric_category"),
            "description": ins.get("finding", ""),
            "evidence": [],
            "impact_level": (ins.get("impact_level") or "").lower() or None,
            "source_metadata": {
                "metric_category": ins.get("metric_category"),
            },
        })
    return items


def save_node(state: WorkforceState) -> dict[str, Any]:
    """Categorize S/W against the 7 NAQAAE pillars and persist to Supabase."""
    print("☁️ [Database Node] Categorizing S/W and saving to Supabase...")
    envelope = build_envelope(
        agent_id="workforce",
        swot_items=_build_swot_items_from_insights(state.get("insights", [])),
        structured_data={"calculated_metrics": state.get("calculated_metrics", {})},
    )
    save_envelope(envelope)
    return {}


# ---------------------------------------------------------------------------
# Graph construction
# ---------------------------------------------------------------------------

def build_graph() -> StateGraph:
    """
    Assemble the three-node sequential StateGraph and return the
    *compiled* runnable application.

    Graph topology
    --------------
    START → load_data_node → calculate_metrics_node → extract_insights_node → save_node → END
    """
    graph = StateGraph(WorkforceState)

    # Register nodes
    graph.add_node("load_data", load_data_node)
    graph.add_node("calculate_metrics", calculate_metrics_node)
    graph.add_node("extract_insights", extract_insights_node)
    graph.add_node("save", save_node)

    # Wire edges – strictly sequential
    graph.add_edge(START, "load_data")
    graph.add_edge("load_data", "calculate_metrics")
    graph.add_edge("calculate_metrics", "extract_insights")
    graph.add_edge("extract_insights", "save")
    graph.add_edge("save", END)

    return graph


# Compile the graph into the public `app` object
app = build_graph().compile()


def compile_and_run(data_path: str | None = None) -> dict:
    """
    Normalized entry point for API integration.
    Returns calculated HR metrics and LLM-extracted insights as a dictionary.
    """
    initial_state: WorkforceState = {
        "raw_data": {},
        "calculated_metrics": {},
        "insights": [],
        "data_path": data_path,
    }
    result = app.invoke(initial_state)
    return {
        "calculated_metrics": result["calculated_metrics"],
        "insights": result["insights"],
        "error": None,
    }


# ---------------------------------------------------------------------------
# Standalone entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import pprint

    print("=" * 60)
    print("  Cognitive Digital Twin – Zone 2: Workforce Agent")
    print("=" * 60)

    # Optional: override data path via env or pass directly
    initial_state: WorkforceState = {
        "raw_data": {},
        "calculated_metrics": {},
        "insights": [],
        "data_path": None,  # uses _DEFAULT_DATA_PATH
    }

    final_state: WorkforceState = app.invoke(initial_state)

    print("\n--- EXTRACTED HR INSIGHTS ---")
    for i, insight in enumerate(final_state["insights"], start=1):
        tag = (
            "✅ [STRENGTH]" if insight["insight_type"] == "Strength"
            else "🚨 [WEAKNESS]"
        )
        print(f"\n[{i}] {tag}  |  Impact: {insight['impact_level']}")
        print(f"    Category : {insight['metric_category']}")
        print(f"    Finding  : {insight['finding']}")

    print("\n--- RAW CALCULATED METRICS ---")
    pprint.pprint(final_state["calculated_metrics"])