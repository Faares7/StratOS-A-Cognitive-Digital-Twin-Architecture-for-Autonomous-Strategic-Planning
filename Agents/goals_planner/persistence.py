"""
Persist goals-planner draft output to Postgres (testing DB).

Tables written:
  strategic_goals       (migration 002_strategic_goals.sql)
  strategic_objectives  (migration 002_strategic_goals.sql)

Uses DB_CONNECTION_STRING from .env (the same connection used by all agents).

Caller must have already inserted the run_id into agent_runs (FK constraint).
original_title / original_description / original_text are written ONCE here
and never touched by subsequent edits — they are the permanent AI snapshot.
"""

from __future__ import annotations

import json
import os
import uuid

import psycopg2
import psycopg2.extras


def save_draft_goals(run_id: str, goals: list[dict]) -> None:
    """
    Write all goal + objective rows for run_id.
    Deletes any prior draft for this run_id first (idempotent re-run).
    """
    dsn = os.getenv("DB_CONNECTION_STRING", "")
    if not dsn:
        print("[goals_planner] No DB_CONNECTION_STRING — skipping persistence.")
        return

    conn = psycopg2.connect(dsn)
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            # The grounded_indicators/tows_types columns may or may not exist yet —
            # detect and adapt so an un-migrated DB degrades gracefully instead of
            # failing the save.
            cur.execute(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'strategic_objectives'
                  AND column_name = 'grounded_indicators'
                """
            )
            has_multi_indicator = cur.fetchone() is not None
            if not has_multi_indicator:
                print("[goals_planner] NOTE: migration 002 not fully applied — saving "
                      "objectives without grounded_indicators/tows_types. Re-run "
                      "migrations/002_strategic_goals.sql for full tracing.")

            cur.execute("DELETE FROM strategic_goals WHERE run_id = %s", (run_id,))

            for pos, goal in enumerate(goals):
                goal_id     = str(uuid.uuid4())
                pillar_ids  = goal.get("pillar_ids") or []
                title       = goal["title"]
                description = goal.get("description") or ""

                cur.execute(
                    """
                    INSERT INTO strategic_goals
                        (goal_id, run_id, title, description,
                         original_title, original_description,
                         pillar_ids, position)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (goal_id, run_id, title, description,
                     title, description,
                     pillar_ids, pos),
                )

                for obj_pos, obj in enumerate(goal.get("objectives", [])):
                    raw_ids = [str(s) for s in (obj.get("source_swot_ids") or []) if s]
                    src_arr = "{" + ",".join(raw_ids) + "}"
                    text    = obj["text"]

                    if has_multi_indicator:
                        # Full provenance (grounded_indicators/tows_types present).
                        indicators_json = json.dumps(obj.get("grounded_indicators") or [])
                        tows = [str(t) for t in (obj.get("tows_types") or [obj["tows_type"]])]
                        tows_arr = "{" + ",".join(tows) + "}"
                        cur.execute(
                            """
                            INSERT INTO strategic_objectives
                                (objective_id, goal_id, text, original_text,
                                 tows_type, tows_types, alignment,
                                 pillar_id, grounded_indicator_id, grounding_score,
                                 grounded_indicators,
                                 source_swot_ids, improvement_source, position)
                            VALUES (%s, %s, %s, %s, %s, %s::text[], %s, %s, %s, %s,
                                    %s::jsonb, %s::uuid[], %s, %s)
                            """,
                            (
                                str(uuid.uuid4()), goal_id, text, text,
                                obj["tows_type"], tows_arr, obj["alignment"],
                                obj.get("pillar_id"),
                                obj.get("grounded_indicator_id"), obj.get("grounding_score"),
                                indicators_json, src_arr,
                                obj.get("improvement_source"), obj_pos,
                            ),
                        )
                    else:
                        # Legacy schema (grounded_indicators/tows_types columns absent).
                        cur.execute(
                            """
                            INSERT INTO strategic_objectives
                                (objective_id, goal_id, text, original_text,
                                 tows_type, alignment,
                                 pillar_id, grounded_indicator_id, grounding_score,
                                 source_swot_ids, improvement_source, position)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s,
                                    %s::uuid[], %s, %s)
                            """,
                            (
                                str(uuid.uuid4()), goal_id, text, text,
                                obj["tows_type"], obj["alignment"],
                                obj.get("pillar_id"),
                                obj.get("grounded_indicator_id"), obj.get("grounding_score"),
                                src_arr, obj.get("improvement_source"), obj_pos,
                            ),
                        )

        conn.commit()
        print(f"[goals_planner] Saved {len(goals)} goal(s) for run_id={run_id}")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
