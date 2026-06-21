"""
Operational Audit — LangGraph StateGraph.

Five deterministic-plus-LLM nodes, run once per audit:

  normalize → categorize → align → diagnose → persist → END

  * normalize  : load plan + reports into the canonical objective spine
  * categorize : tag each objective with its NAQAAE pillar (reuses categorizer)
  * align      : build per-indicator timelines, trends, objective health,
                 and systemic pillar flags
  * diagnose   : one LLM call per objective / systemic flag → swot_items
  * persist    : build_envelope + save_envelope (ONE run, no dedup)

All findings are written under a single run so the goals planner's
DISTINCT ON (agent_id) pick-up keeps the whole batch.
"""
from __future__ import annotations

import uuid
from typing import TypedDict

from langgraph.graph import END, StateGraph

from .config import AGENT_ID, PLAN_FILE, REPORT_FILES


# ── State ───────────────────────────────────────────────────────────────────────

class AuditState(TypedDict):
    run_id: str
    plan_path: str
    report_paths: list[tuple]          # [(period_label, path), ...]
    plan_index: dict                   # {(goal, obj): {...}}
    report_rows: list[dict]
    pillar_map: dict                   # {(goal, obj): {pillar_id, pillar_name}}
    objective_signals: list[dict]
    systemic_flags: list[dict]
    swot_items: list[dict]
    errors: list[str]


# ── Nodes ───────────────────────────────────────────────────────────────────────

def _normalize(state: AuditState) -> dict:
    from .extraction import load_plan, load_reports  # noqa: PLC0415
    plan_index = load_plan(state["plan_path"])
    report_rows = load_reports(state["report_paths"])
    return {"plan_index": plan_index, "report_rows": report_rows}


def _categorize(state: AuditState) -> dict:
    """Assign one NAQAAE pillar per objective, reusing the shared categorizer."""
    from Agents.categorizer import categorize_swot_items  # noqa: PLC0415

    # Union of objectives seen in the plan and/or the reports.
    keys = set(state["plan_index"])
    titles: dict[tuple, str] = {
        k: v.get("objective_title", "") for k, v in state["plan_index"].items()
    }
    for r in state["report_rows"]:
        key = (r["goal"], r["objective"])
        keys.add(key)
        titles.setdefault(key, r["objective_title"])

    ordered = sorted(keys)
    # Pseudo S/W items so the categorizer's S/W path tags them with a pillar.
    items = [
        {"type": "weakness", "title": titles.get(k, ""), "description": titles.get(k, "")}
        for k in ordered
    ]
    categorize_swot_items(items)

    pillar_map = {
        k: {"pillar_id": it.get("pillar_id"), "pillar_name": it.get("pillar_name")}
        for k, it in zip(ordered, items)
    }
    return {"pillar_map": pillar_map}


def _align(state: AuditState) -> dict:
    from .alignment import build_objective_signals, build_systemic_flags  # noqa: PLC0415
    signals = build_objective_signals(
        state["plan_index"], state["report_rows"], state["pillar_map"]
    )
    flags = build_systemic_flags(signals)
    return {"objective_signals": signals, "systemic_flags": flags}


def _diagnose(state: AuditState) -> dict:
    from .diagnosis import diagnose  # noqa: PLC0415
    items = diagnose(state["objective_signals"], state["systemic_flags"])
    return {"swot_items": items}


def _persist(state: AuditState) -> dict:
    from core.persistence import build_envelope, save_envelope  # noqa: PLC0415
    from .extraction import source_hash  # noqa: PLC0415

    status = "success" if not state["errors"] else "partial"
    structured = {
        "objectives_analyzed": len(state["objective_signals"]),
        "systemic_flags": [
            {"pillar_id": f["pillar_id"], "kind": f["kind"]}
            for f in state["systemic_flags"]
        ],
        "n_reports": len({p for _, p in state["report_paths"]}),
        "source_hash": source_hash(state["report_paths"]),
    }
    envelope = build_envelope(
        agent_id=AGENT_ID,
        swot_items=state["swot_items"],
        structured_data=structured,
        status=status,
        errors=state["errors"],
        run_id=state["run_id"],
    )
    save_envelope(envelope)
    return {}


# ── Assembly ────────────────────────────────────────────────────────────────────

def _build_graph():
    g = StateGraph(AuditState)
    g.add_node("normalize", _normalize)
    g.add_node("categorize", _categorize)
    g.add_node("align", _align)
    g.add_node("diagnose", _diagnose)
    g.add_node("persist", _persist)

    g.set_entry_point("normalize")
    g.add_edge("normalize", "categorize")
    g.add_edge("categorize", "align")
    g.add_edge("align", "diagnose")
    g.add_edge("diagnose", "persist")
    g.add_edge("persist", END)
    return g.compile()


_graph = None
RUN_CONFIG: dict = {"recursion_limit": 50}


def get_graph():
    """Return the compiled StateGraph singleton."""
    global _graph
    if _graph is None:
        _graph = _build_graph()
    return _graph


def build_initial_state(
    plan_path=PLAN_FILE,
    reports: list[tuple] | None = None,
    run_id: str | None = None,
) -> AuditState:
    return {
        "run_id": run_id or str(uuid.uuid4()),
        "plan_path": str(plan_path),
        "report_paths": reports if reports is not None else REPORT_FILES,
        "plan_index": {},
        "report_rows": [],
        "pillar_map": {},
        "objective_signals": [],
        "systemic_flags": [],
        "swot_items": [],
        "errors": [],
    }


def compile_and_run(
    plan_path=PLAN_FILE,
    reports: list[tuple] | None = None,
    run_id: str | None = None,
) -> dict:
    """
    Run the full operational-audit pipeline.

    Args:
        plan_path: path to the executive plan JSON.
        reports:   list of (period_label, path) tuples, oldest → newest.
                   Defaults to the three configured reports. Works with 1..3.
        run_id:    optional pre-existing agent_runs.run_id; a UUID is generated
                   if omitted.

    Returns the final AuditState dict.
    """
    initial = build_initial_state(plan_path, reports, run_id)
    return get_graph().invoke(initial, config=RUN_CONFIG)
