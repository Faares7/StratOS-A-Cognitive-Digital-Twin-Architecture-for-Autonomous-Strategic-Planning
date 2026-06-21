"""
Persist consolidation candidates to `swot_consolidation_candidates`
(migrations/003_swot_consolidation.sql).

One row per canonical item per consolidation run — KEPT and CUT alike — with the full
factor breakdown (features) + reviewer columns left at their defaults, so the human gate
and later weight-tuning read from the same persisted data. References no existing table;
`member_item_ids` is a soft uuid[] (no FK).
"""

from __future__ import annotations

import os
import uuid

import psycopg2
from psycopg2.extras import Json

from . import config

_INSERT = """
    INSERT INTO swot_consolidation_candidates
        (candidate_id, consolidation_run_id, branch, type, pillar_id, pillar_name,
         title, description, member_item_ids, contributing_agents, snapshot_count,
         factor_breakdown, salience_score, scoring_config, lifecycle_state,
         selected, selection_reason)
    VALUES
        (%s, %s, %s, %s, %s, %s,
         %s, %s, %s::uuid[], %s, %s,
         %s, %s, %s, %s,
         %s, %s)
"""


def _scoring_config() -> dict:
    """Snapshot of the weights/thresholds used this run (audit / reproducibility)."""
    return {
        "window_snapshots": config.WINDOW_SNAPSHOTS,
        "w_corroboration": config.W_CORROBORATION,
        "w_severity": config.W_SEVERITY,
        "agreement_boost": config.AGREEMENT_BOOST,
        "recency_lambda": config.RECENCY_LAMBDA,
        "lifecycle_match_threshold": config.LIFECYCLE_MATCH_THRESHOLD,
        "select_min": config.SELECT_MIN_PER_GROUP,
        "select_max": config.SELECT_MAX_PER_GROUP,
        "select_threshold": config.SELECT_THRESHOLD,
    }


def _member_ids(c: dict) -> list[str]:
    return [m["item_id"] for m in c.get("members", []) if m.get("item_id")]


def _agents(c: dict) -> list[str]:
    return sorted({m.get("agent_id") for m in c.get("members", []) if m.get("agent_id")})


def _snapshot_count(c: dict) -> int | None:
    idxs = {m.get("snapshot_index") for m in c.get("members", []) if m.get("snapshot_index") is not None}
    return len(idxs) if idxs else None


def save_candidates(consolidation_run_id: str, candidates: list[dict]) -> int:
    """Insert all candidates for one consolidation run. Returns the row count written
    (0 if the DB is not configured)."""
    dsn = os.getenv("DB_CONNECTION_STRING", "")
    if not dsn:
        print("[swot-consolidation] No DB_CONNECTION_STRING — skipping persistence.")
        return 0

    cfg = Json(_scoring_config())
    conn = psycopg2.connect(dsn)
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            for c in candidates:
                cur.execute(_INSERT, (
                    str(uuid.uuid4()),
                    consolidation_run_id,
                    c["branch"],
                    c["type"],
                    c.get("pillar_id"),
                    c.get("pillar_name"),
                    c.get("title"),
                    c.get("description", ""),
                    _member_ids(c),
                    _agents(c),
                    _snapshot_count(c),
                    Json(c.get("factor_breakdown", {})),
                    float(c.get("salience_score", 0.0)),
                    cfg,
                    c["lifecycle_state"],
                    bool(c.get("selected", False)),
                    c.get("selection_reason"),
                ))
        conn.commit()
        print(f"[swot-consolidation] saved {len(candidates)} candidate(s) for "
              f"consolidation_run_id={consolidation_run_id}")
        return len(candidates)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
