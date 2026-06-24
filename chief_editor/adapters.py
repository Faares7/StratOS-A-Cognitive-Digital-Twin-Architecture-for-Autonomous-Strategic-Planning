"""
Source adapters — read all raw data needed by the builders.

v1 carryover source: Data/carryover_sections_en.json
v1 agent sources:    Supabase tables via psycopg2

Swapping the carryover source later (JSON → strategic_plan_sections table) is
isolated to load_carryover() only.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import psycopg2
import psycopg2.extras


# ── Paths ─────────────────────────────────────────────────────────────────────

_ROOT         = Path(__file__).parent.parent
_CARRYOVER    = _ROOT / "Data" / "carryover_sections_en.json"


# ── DB helpers ────────────────────────────────────────────────────────────────

def get_conn():
    """Open a fresh psycopg2 connection (caller is responsible for closing)."""
    dsn = os.getenv("DB_CONNECTION_STRING", "")
    if not dsn:
        raise RuntimeError("DB_CONNECTION_STRING not set")
    conn = psycopg2.connect(dsn, connect_timeout=15)
    conn.autocommit = True
    return conn


def _q(conn, sql: str, params: tuple = ()) -> list[dict]:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, params)
        return [dict(r) for r in cur.fetchall()]


# ── Carryover ─────────────────────────────────────────────────────────────────

def load_carryover() -> dict[str, dict]:
    """Return {section_key: section_data} from carryover_sections_en.json.
    Replace this function body when switching to the DB table."""
    raw = json.loads(_CARRYOVER.read_text(encoding="utf-8"))
    return {s["section_key"]: s for s in raw.get("sections", [])}


# ── Org ───────────────────────────────────────────────────────────────────────

def fetch_org(conn, org_id: str) -> dict[str, Any]:
    rows = _q(conn, "SELECT * FROM organizations WHERE id = %s LIMIT 1", (org_id,))
    if not rows:
        raise ValueError(f"Organization '{org_id}' not found")
    return rows[0]


# ── SWOT ─────────────────────────────────────────────────────────────────────

def fetch_swot_items_all_types(conn) -> list[dict]:
    """Fetch approved SWOT consolidation candidates — same query as /api/gap-analysis/draft.
    Returns [] (with a warning) if no approved consolidation run exists."""
    rows = _q(conn, """
        SELECT candidate_id::text AS item_id,
               type, title, description,
               pillar_id, pillar_name,
               salience_score,
               approved_at AS created_at
        FROM   swot_consolidation_candidates
        WHERE  approved = true
          AND  description  IS NOT NULL
          AND  description  != ''
        ORDER  BY pillar_id NULLS LAST, type, salience_score DESC
    """)
    if not rows:
        print("[chief_editor] WARNING: no approved SWOT consolidation run found — "
              "approve a consolidation run before generating a plan.")
    return rows


# ── Gap analysis ─────────────────────────────────────────────────────────────

def fetch_gap_run_id(conn) -> str | None:
    """Latest agent_run that produced gap_analysis_items."""
    rows = _q(conn, """
        SELECT ar.run_id
        FROM   agent_runs ar
        WHERE  EXISTS (
            SELECT 1 FROM gap_analysis_items g WHERE g.run_id = ar.run_id
        )
        ORDER  BY ar.run_timestamp DESC
        LIMIT  1
    """)
    if not rows:
        # Fallback: any run_id in gap_analysis_items
        rows = _q(conn, "SELECT DISTINCT run_id FROM gap_analysis_items LIMIT 1")
    return rows[0]["run_id"] if rows else None


def fetch_gap_items(conn, run_id: str) -> list[dict]:
    return _q(conn,
        "SELECT * FROM gap_analysis_items WHERE run_id = %s ORDER BY position, pillar_id",
        (run_id,))


def fetch_gap_input_pillars(conn, run_id: str) -> dict[str, dict]:
    """Return {pillar_name: pillar_dict} from agent_runs.structured_data.input_pillars.
    The stored key for pillar name is 'pillar' (not 'pillar_name')."""
    rows = _q(conn,
        "SELECT structured_data FROM agent_runs WHERE run_id = %s LIMIT 1",
        (run_id,))
    if not rows or not rows[0].get("structured_data"):
        return {}
    sd = rows[0]["structured_data"]
    if isinstance(sd, str):
        sd = json.loads(sd)
    # Key is "pillar"; map to pillar name for lookup
    return {p["pillar"]: p for p in (sd.get("input_pillars") or [])}


def fetch_gap_pillar_summaries(conn) -> dict[str, dict]:
    """Return {pillar_name: {pillar_id, summary, naqaae_hash}} from gap_pillar_summaries.
    Empty dict if the table has no rows yet."""
    rows = _q(conn,
        "SELECT pillar_id, pillar_name, summary, naqaae_hash FROM gap_pillar_summaries")
    return {r["pillar_name"]: r for r in rows}


# ── Goals ─────────────────────────────────────────────────────────────────────

def fetch_goals_run_id(conn) -> str | None:
    """Latest successful goals_planner run."""
    rows = _q(conn, """
        SELECT run_id FROM agent_runs
        WHERE  agent_id = 'goals_planner' AND status = 'success'
        ORDER  BY run_timestamp DESC LIMIT 1
    """)
    if not rows:
        rows = _q(conn, "SELECT DISTINCT run_id FROM strategic_goals LIMIT 1")
    return rows[0]["run_id"] if rows else None


def fetch_goals(conn, run_id: str) -> list[dict]:
    return _q(conn,
        "SELECT * FROM strategic_goals WHERE run_id = %s ORDER BY position",
        (run_id,))


def fetch_objectives(conn, goal_ids: list[str]) -> list[dict]:
    if not goal_ids:
        return []
    ph = ",".join(["%s"] * len(goal_ids))
    return _q(conn,
        f"SELECT * FROM strategic_objectives WHERE goal_id IN ({ph}) ORDER BY goal_id, position",
        tuple(goal_ids))


# ── Exec (operational audit) ──────────────────────────────────────────────────

def fetch_exec_run_id(conn) -> str | None:
    """Latest agent_run that produced strategic_actions."""
    rows = _q(conn, """
        SELECT ar.run_id
        FROM   agent_runs ar
        WHERE  EXISTS (
            SELECT 1 FROM strategic_actions sa WHERE sa.run_id = ar.run_id
        )
        ORDER  BY ar.run_timestamp DESC LIMIT 1
    """)
    if not rows:
        rows = _q(conn, "SELECT DISTINCT run_id FROM strategic_actions LIMIT 1")
    return rows[0]["run_id"] if rows else None


def fetch_actions(conn, run_id: str) -> list[dict]:
    return _q(conn,
        "SELECT * FROM strategic_actions WHERE run_id = %s ORDER BY position",
        (run_id,))
