"""
Ranking + debug — NO algorithmic cut (architectural update: stages 6 & 7 merged).

The pipeline no longer drops anything. Every canonical item is RANKED by salience within
its namespace (internal = (pillar, type); external = type) and passed through with
`selected=True` (default-included). The HUMAN is the sole keep/cut filter, via the review
UI (`reviewer_decision`). carried_forward items are passed through too with
`selected=False` — informational, never part of the new SWOT, never dropped.

Every candidate is still printed and persisted with its full factor breakdown, so the
reviewer sees the ranking rationale and weight-tuning has its (features, label) data.
"""

from __future__ import annotations

from collections import defaultdict


def _rank(group: list[dict]) -> None:
    """Sort one namespace by salience and annotate rank. Nothing is cut."""
    for rank, c in enumerate(sorted(group, key=lambda c: c["salience_score"], reverse=True), start=1):
        c["selected"] = True          # default-included; the human cuts in review, not the AI
        c["selection_reason"] = f"rank {rank} by salience {c['salience_score']:.3f} (pending review)"


def select(internal_clusters: list[dict], external_clusters: list[dict],
           carried: list[dict]) -> list[dict]:
    """Rank every canonical item by salience (no cut), print the full ranked table, and
    return the complete candidate list (ranked clusters + carried_forward) for persistence
    and the human review gate."""
    internal_groups: dict = defaultdict(list)
    for c in internal_clusters:
        internal_groups[(c.get("pillar_id"), c.get("type"))].append(c)
    external_groups: dict = defaultdict(list)
    for c in external_clusters:
        external_groups[c.get("type")].append(c)

    for g in internal_groups.values():
        _rank(g)
    for g in external_groups.values():
        _rank(g)

    for c in carried:                        # carried_forward: retained, never selected/dropped
        c["selected"] = False
        c["selection_reason"] = "carried_forward — retained for awareness, not measured this window"
        c.setdefault("salience_score", 0.0)
        c.setdefault("factor_breakdown", {})

    _print_debug(internal_groups, external_groups, carried)
    return internal_clusters + external_clusters + carried


# -- Debug printer ---------------------------------------------------------------

def _line(c: dict) -> str:
    state = (c.get("lifecycle_state") or "?")[:10]
    text = (c.get("description") or c.get("title") or "")[:70]
    return (f"  {c['salience_score']:.3f} ({state:<10}) {text}\n"
            f"        factors={c.get('factor_breakdown', {})}")


def _print_debug(internal_groups: dict, external_groups: dict, carried: list[dict]) -> None:
    print("\n" + "=" * 78)
    print("  SWOT CONSOLIDATION — ALL CANDIDATES, RANKED (no cut; human is sole filter)")
    print("=" * 78)

    print("\n-- INTERNAL (S/W) — per (pillar, type) --")
    for key in sorted(internal_groups, key=lambda x: (x[0] is None, x[0], x[1])):
        pillar_id, typ = key
        group = sorted(internal_groups[key], key=lambda c: c["salience_score"], reverse=True)
        name = next((c.get("pillar_name") for c in group if c.get("pillar_name")), None)
        print(f"\n  Pillar {pillar_id} ({name or 'uncategorized'}) — {typ}:")
        for c in group:
            print(_line(c))

    print("\n-- EXTERNAL (O/T) — per type --")
    for t in sorted(external_groups):
        group = sorted(external_groups[t], key=lambda c: c["salience_score"], reverse=True)
        print(f"\n  {t.upper()}:")
        for c in group:
            print(_line(c))

    if carried:
        print(f"\n-- CARRIED_FORWARD ({len(carried)} previous-plan items, retained — not dropped) --")
        print("  (previous concerns with no current agent signal this window; shown for awareness)")

    total = sum(len(g) for g in (*internal_groups.values(), *external_groups.values()))
    print("\n" + "-" * 78)
    print(f"  {total} canonical items ranked (all passed to human review) · "
          f"{len(carried)} carried_forward")
    print("=" * 78 + "\n")
