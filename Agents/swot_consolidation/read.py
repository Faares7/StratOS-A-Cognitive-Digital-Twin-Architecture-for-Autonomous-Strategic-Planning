"""
Read layer for the SWOT consolidation pipeline.

Reads the accumulated history from the existing `swot_items` table (this pipeline
adds NO new ingestion — it is a read over what the agents already persist), applies
the decision-#1 window, and splits into the internal (S/W) and external (O/T) pools.

Window rules (docs/SWOT_PIPELINE.md §4 run-determinism principle):
  • Static-input agents  → latest run only (re-runs are identical copies).
  • Changing-input agents → last WINDOW_SNAPSHOTS DISTINCT snapshots. A "snapshot"
    collapses runs that emitted an identical set of items, so the ~2-run refresh
    cadence and the higher-volume social source cannot inflate a theme. Detected at
    READ TIME — no `input_hash`, no schema change.
"""

from __future__ import annotations

import os
from collections import defaultdict
from typing import Any

import psycopg2
import psycopg2.extras

from Agents.categorizer import categorize_swot_items

from .config import CHANGING_AGENTS, WINDOW_SNAPSHOTS

_SELECT = """
    SELECT item_id::text   AS item_id,
           run_id::text     AS run_id,
           agent_id,
           type,
           title,
           description,
           evidence,
           impact_level,
           pillar_id,
           pillar_name,
           source_metadata,
           created_at
    FROM swot_items
    WHERE description IS NOT NULL AND description != ''
    ORDER BY created_at DESC
"""


def _fetch_rows() -> list[dict[str, Any]]:
    dsn = os.getenv("DB_CONNECTION_STRING", "")
    if not dsn:
        print("[swot-consolidation] No DB_CONNECTION_STRING — returning no rows.")
        return []
    conn = psycopg2.connect(dsn)
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(_SELECT)
            return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


def _run_fingerprint(items: list[dict]) -> frozenset[str]:
    """Identity of a run's *content*: the set of its normalized descriptions. Two runs
    with the same fingerprint are the same input snapshot (re-run on static data)."""
    return frozenset((it.get("description") or "").strip().lower() for it in items)


def _group_runs(rows: list[dict]) -> dict[str, dict[str, dict]]:
    """agent_id → run_id → {items, ts}. `ts` is the max created_at seen for that run."""
    by_agent: dict[str, dict[str, dict]] = defaultdict(lambda: defaultdict(lambda: {"items": [], "ts": None}))
    for r in rows:
        slot = by_agent[r["agent_id"]][r["run_id"]]
        slot["items"].append(r)
        ts = r.get("created_at")
        if slot["ts"] is None or (ts is not None and ts > slot["ts"]):
            slot["ts"] = ts
    return by_agent


def _windowed_items(rows: list[dict]) -> list[dict]:
    """Apply the per-agent window and tag each surviving item with snapshot metadata."""
    by_agent = _group_runs(rows)
    kept: list[dict] = []

    for agent_id, runs in by_agent.items():
        # runs newest-first
        ordered = sorted(runs.items(), key=lambda kv: (kv[1]["ts"] is not None, kv[1]["ts"]), reverse=True)

        if agent_id not in CHANGING_AGENTS:
            # Static-input agent → latest run only; it is one snapshot.
            if not ordered:
                continue
            run_id, slot = ordered[0]
            for it in slot["items"]:
                kept.append({**it, "snapshot_id": run_id, "snapshot_ts": slot["ts"], "snapshot_index": 0})
            continue

        # Changing-input agent → collapse identical-content runs, keep last N snapshots.
        seen: set[frozenset[str]] = set()
        snap_idx = 0
        for run_id, slot in ordered:
            fp = _run_fingerprint(slot["items"])
            if fp in seen:
                continue                      # same snapshot as a newer run → skip
            seen.add(fp)
            for it in slot["items"]:
                kept.append({**it, "snapshot_id": run_id, "snapshot_ts": slot["ts"], "snapshot_index": snap_idx})
            snap_idx += 1
            if snap_idx >= WINDOW_SNAPSHOTS:
                break

    return kept


def load_pools() -> tuple[list[dict], list[dict]]:
    """
    Return (internal_items, external_items) after windowing.

    internal = strengths/weaknesses (pillar-namespaced); external = opportunities/
    threats (flat). Split on `type` (ground truth) rather than pillar_id, so a S/W
    whose categorization happened to fail still lands in the internal pool.
    """
    rows = _fetch_rows()
    if not rows:
        return [], []
    items = _windowed_items(rows)
    internal = [i for i in items if i["type"] in ("strength", "weakness")]
    external = [i for i in items if i["type"] in ("opportunity", "threat")]

    # Fix 4 — safety net: any internal S/W that arrived without a pillar (categorizer
    # failed or the producer bypassed it) is categorized now, so it lands in a real
    # pillar namespace instead of the "Pillar None" bucket.
    uncategorized = [i for i in internal if i.get("pillar_id") is None]
    if uncategorized:
        categorize_swot_items(uncategorized)   # mutates pillar_id / pillar_name in place
        still_null = sum(1 for i in uncategorized if i.get("pillar_id") is None)
        print(f"[swot-consolidation] read: categorized {len(uncategorized) - still_null}/"
              f"{len(uncategorized)} null-pillar internal items (Fix 4).")

    print(f"[swot-consolidation] read: {len(internal)} internal (S/W), "
          f"{len(external)} external (O/T) items after windowing.")
    return internal, external
