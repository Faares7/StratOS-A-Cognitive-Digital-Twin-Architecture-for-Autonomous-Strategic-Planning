"""
End-to-end test for the StratOS Action Plan agent.

Connects to the live Supabase database, finds the most recent strategy run whose
plan_status == 'final', runs the action planner against it, and prints the budget
reconciliation and any ceiling warnings.

Usage:
    python test_action_plan_e2e.py            # use the latest finalized run
    python test_action_plan_e2e.py <run_id>   # target a specific run
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
import psycopg2

ROOT = Path(__file__).parent.resolve()
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

AGENT_PATH = ROOT / "Agents" / "action_planner" / "action_planner.py"


def load_agent():
    spec = importlib.util.spec_from_file_location("action_plan_agent", AGENT_PATH)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["action_plan_agent"] = mod
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


def latest_final_run(dsn: str):
    conn = psycopg2.connect(dsn)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT run_id, run_timestamp
                FROM agent_runs
                WHERE structured_data->>'plan_status' = 'final'
                ORDER BY run_timestamp DESC
                LIMIT 1
                """
            )
            row = cur.fetchone()
            return (str(row[0]), row[1]) if row else (None, None)
    finally:
        conn.close()


def latest_run_with_objectives(dsn: str):
    """Latest run (any plan_status) that actually has goals + objectives."""
    conn = psycopg2.connect(dsn)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT r.run_id, r.run_timestamp
                FROM agent_runs r
                WHERE EXISTS (SELECT 1 FROM strategic_goals g WHERE g.run_id = r.run_id)
                  AND EXISTS (
                      SELECT 1 FROM strategic_objectives o
                      JOIN strategic_goals g ON o.goal_id = g.goal_id
                      WHERE g.run_id = r.run_id
                  )
                ORDER BY r.run_timestamp DESC
                LIMIT 1
                """
            )
            row = cur.fetchone()
            return (str(row[0]), row[1]) if row else (None, None)
    finally:
        conn.close()


def main() -> None:
    dsn = os.getenv("DB_CONNECTION_STRING", "")
    if not dsn:
        print("DB_CONNECTION_STRING is not set in .env — cannot run.")
        return

    args = [a for a in sys.argv[1:]]
    allow_draft = "--allow-draft" in args
    positional = [a for a in args if not a.startswith("--")]
    run_id = positional[0] if positional else None

    require_final = not allow_draft
    if not run_id:
        if allow_draft:
            run_id, ts = latest_run_with_objectives(dsn)
            if not run_id:
                print("No run with goals + objectives was found.")
                return
            print(f"[--allow-draft] Latest run with objectives: {run_id}  ({ts})")
            print("Lifecycle gate BYPASSED for testing (require_final=False).")
        else:
            run_id, ts = latest_final_run(dsn)
            if not run_id:
                print("No agent_runs row with plan_status='final' was found.\n"
                      "Either approve a plan first, or re-run with --allow-draft to "
                      "test against the latest draft run.")
                return
            print(f"Latest finalized run: {run_id}  ({ts})")

    mod = load_agent()
    print(f"\nRunning the action planner for run_id={run_id} ...")
    print("(one Gemini call per objective — this can take a minute)\n")

    result = mod.compile_and_run(run_id, require_final=require_final)

    if result.get("error"):
        print("ERROR:", result["error"])
        return

    b = result["budget"]
    print("================ SUMMARY ================")
    print(f"objectives processed : {result['objectives_processed']}")
    print(f"actions created      : {result['actions_created']} (replaced {result['actions_replaced']})")
    print(f"horizon              : {result['horizon']}")
    print(f"faculty OpEx total   : {b['faculty_opex_total_egp']:,.0f} EGP")
    print(f"central CapEx total  : {b['central_capex_total_egp']:,.0f} EGP")

    print("\n================ PER-YEAR ENVELOPE ================")
    for y in b["per_year"]:
        flag = "OK  " if y["within_envelope"] else "OVER"
        print(f"  {y['year']}  [{flag}]  spend {y['faculty_opex_spend_egp']:>14,.0f}  "
              f"/  ceiling {y['ceiling_egp']:>14,.0f} EGP")

    if b["warnings"]:
        print("\n================ CEILING WARNINGS ================")
        for w in b["warnings"]:
            print("  " + w)
    else:
        print("\nNo ceiling warnings — plan fits the envelope every year.")

    out = ROOT / "test_action_plan_result.json"
    out.write_text(json.dumps(result, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    print(f"\nFull result written to {out}")


if __name__ == "__main__":
    main()
