"""
SWOT consolidation pipeline — orchestrator.

End-to-end (docs/SWOT_PIPELINE.md):

    read window  →  dedup per namespace  →  lifecycle vs previous plan
                 →  two scorers  →  hybrid selection (+ debug)  →  persist

Internal namespace = (pillar_id, type); external namespace = type. The whole thing is
a READ over the existing `swot_items` table and a WRITE to the new
`swot_consolidation_candidates` table — no existing table is touched.
"""

from __future__ import annotations

import uuid
from collections import defaultdict

from .dedup import cluster_namespace
from .lifecycle import assign_lifecycle
from .normalize import normalize_items
from .persistence import save_candidates
from .read import load_pools
from .scoring import score_external, score_internal
from .selection import select


def _build_internal_clusters(items: list[dict]) -> list[dict]:
    groups: dict = defaultdict(list)
    for it in items:
        groups[(it.get("pillar_id"), it["type"])].append(it)

    clusters: list[dict] = []
    for (pillar_id, typ), grp in groups.items():
        for cl in cluster_namespace(grp):
            cl.update({
                "branch": "internal",
                "type": typ,
                "pillar_id": pillar_id,
                "pillar_name": next((m.get("pillar_name") for m in cl["members"] if m.get("pillar_name")), None),
            })
            clusters.append(cl)
    return clusters


def _build_external_clusters(items: list[dict]) -> list[dict]:
    groups: dict = defaultdict(list)
    for it in items:
        groups[it["type"]].append(it)

    clusters: list[dict] = []
    for typ, grp in groups.items():
        for cl in cluster_namespace(grp):
            cl.update({"branch": "external", "type": typ, "pillar_id": None, "pillar_name": None})
            clusters.append(cl)
    return clusters


def consolidate(consolidation_run_id: str | None = None, persist: bool = True) -> dict:
    """
    Run the full consolidation. Returns
        {"consolidation_run_id": str, "candidates": list[dict]}.
    Set persist=False for a dry run (debug print only, no DB write).
    """
    run_id = consolidation_run_id or str(uuid.uuid4())
    print(f"[swot-consolidation] starting consolidation_run_id={run_id}")

    internal_items, external_items = load_pools()

    # Fix 1 — normalize raw text to style-neutral concept phrases BEFORE dedup, so
    # cross-agent items about the same concern cluster (which revives corroboration).
    normalize_items(internal_items)
    normalize_items(external_items)

    internal_clusters = _build_internal_clusters(internal_items)
    external_clusters = _build_external_clusters(external_items)
    print(f"[swot-consolidation] dedup: {len(internal_clusters)} internal, "
          f"{len(external_clusters)} external canonical clusters.")

    # Lifecycle BEFORE scoring (the persistence factor reads lifecycle_state).
    carried = assign_lifecycle(internal_clusters, external_clusters)

    n_internal_agents = len({it["agent_id"] for it in internal_items if it.get("agent_id")})
    for cl in internal_clusters:
        cl["salience_score"], cl["factor_breakdown"] = score_internal(cl, n_internal_agents)
    for cl in external_clusters:
        cl["salience_score"], cl["factor_breakdown"] = score_external(cl)

    candidates = select(internal_clusters, external_clusters, carried)

    if persist:
        # Persist everything (incl. carried_forward). The UI hides carried_forward by
        # default (top-K view) and only reveals it under "Display all", so they must be in
        # the DB to be shown on demand. They stay selected=False — never part of the SWOT.
        save_candidates(run_id, candidates)
    else:
        print("[swot-consolidation] dry run — not persisting.")

    return {"consolidation_run_id": run_id, "candidates": candidates}


if __name__ == "__main__":
    import sys
    consolidate(persist="--dry-run" not in sys.argv)
