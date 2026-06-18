"""
Strategy Planner — LangGraph StateGraph

Five deterministic nodes + one LLM node + a retry loop:

  pair_tows → ground_in_graph → cluster_into_goals → draft_goals → validate
                                                            ↑             |
                                                  increment_retries ←─────┘ (on fail, ≤ MAX_RETRIES)
                                                                           |
                                                                         save → END

The graph is compiled once and reused across requests.
"""

from __future__ import annotations

import uuid
from typing import TypedDict

from langgraph.graph import END, StateGraph

from .config import MAX_RETRIES


# ── State definition ──────────────────────────────────────────────────────────

class PlannerState(TypedDict):
    run_id:    str
    swot_items: list[dict]
    pairs:     list[dict]   # filled by pair_tows → ground_in_graph
    clusters:  list[dict]   # filled by cluster_into_goals
    draft:     list[dict]   # filled by draft_goals (enriched goal dicts)
    errors:    list[str]    # set by validate
    retries:   int
    validated: bool


# ── Node functions ────────────────────────────────────────────────────────────

def _pair_tows(state: PlannerState) -> dict:
    from .pairing import build_pairs  # noqa: PLC0415
    return {"pairs": build_pairs(state["swot_items"])}


def _ground_in_graph(state: PlannerState) -> dict:
    from .grounding import ground_pairs  # noqa: PLC0415
    # ground_pairs mutates in place and returns the same list
    return {"pairs": ground_pairs(state["pairs"])}


def _cluster_into_goals(state: PlannerState) -> dict:
    from .clustering import cluster_into_goals  # noqa: PLC0415
    return {"clusters": cluster_into_goals(state["pairs"])}


def _draft_goals(state: PlannerState) -> dict:
    from .drafting import draft_all_goals  # noqa: PLC0415
    return {"draft": draft_all_goals(state["clusters"])}


def _validate(state: PlannerState) -> dict:
    from .validation import validate_draft  # noqa: PLC0415
    errors = validate_draft(state["draft"], state["pairs"])
    return {"validated": len(errors) == 0, "errors": errors}


def _increment_retries(state: PlannerState) -> dict:
    return {"retries": state["retries"] + 1}


def _save(state: PlannerState) -> dict:
    from .persistence import save_draft_goals  # noqa: PLC0415
    save_draft_goals(state["run_id"], state["draft"])
    return {}


# ── Routing ───────────────────────────────────────────────────────────────────

def _route_after_validate(state: PlannerState) -> str:
    if state["validated"]:
        return "save"
    if state["retries"] >= MAX_RETRIES:
        return "save"   # accept best-effort after exhausting retries
    return "increment_retries"


# ── Graph assembly ────────────────────────────────────────────────────────────

def _build_graph():
    g = StateGraph(PlannerState)

    g.add_node("pair_tows",           _pair_tows)
    g.add_node("ground_in_graph",     _ground_in_graph)
    g.add_node("cluster_into_goals",  _cluster_into_goals)
    g.add_node("draft_goals",         _draft_goals)
    g.add_node("validate",            _validate)
    g.add_node("increment_retries",   _increment_retries)
    g.add_node("save",                _save)

    g.set_entry_point("pair_tows")
    g.add_edge("pair_tows",          "ground_in_graph")
    g.add_edge("ground_in_graph",    "cluster_into_goals")
    g.add_edge("cluster_into_goals", "draft_goals")
    g.add_edge("draft_goals",        "validate")
    g.add_conditional_edges(
        "validate",
        _route_after_validate,
        {"save": "save", "increment_retries": "increment_retries"},
    )
    g.add_edge("increment_retries",  "draft_goals")
    g.add_edge("save",               END)

    return g.compile()


_graph = None

# Passed to graph.invoke / graph.stream so recursion_limit is set in one place.
RUN_CONFIG: dict = {"recursion_limit": 50}


def get_graph():
    """Return the compiled StateGraph singleton (built once, reused across requests)."""
    global _graph
    if _graph is None:
        _graph = _build_graph()
    return _graph


def build_initial_state(swot_items: list[dict], run_id: str | None = None) -> PlannerState:
    """
    Build the starting PlannerState without running the graph.
    Useful for streaming: caller does ``get_graph().stream(build_initial_state(...))``.
    """
    return {
        "run_id":     run_id or str(uuid.uuid4()),
        "swot_items": swot_items,
        "pairs":      [],
        "clusters":   [],
        "draft":      [],
        "errors":     [],
        "retries":    0,
        "validated":  False,
    }


def compile_and_run(swot_items: list[dict], run_id: str | None = None) -> dict:
    """
    Run the full strategy-planner pipeline.

    Args:
        swot_items: list of swot_item row dicts (from the swot_items table).
                    Must include at least: item_id, type, description,
                    pillar_id, pillar_name.
        run_id:     agent_runs.run_id for this strategy run (must already exist
                    in the DB before calling so the FK on strategic_goals is satisfied).
                    If None a new UUID is generated (useful for tests without a DB).

    Returns the final PlannerState dict.
    """
    global _graph
    if _graph is None:
        _graph = _build_graph()

    initial = build_initial_state(swot_items, run_id)
    return get_graph().invoke(initial, config=RUN_CONFIG)
