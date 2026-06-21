"""
Fast snapshot generator for clustering experiments.

Runs ONLY the first two pipeline stages — pairing + grounding — against the live
DB/Neo4j, then writes debug_output/grounded_pairs_latest.json. It deliberately
skips clustering, drafting, the LLM, and all DB writes, so you get a frozen set of
real grounded pairs in a couple of minutes and can then iterate on
leiden_clustering_test.py offline as many times as you like.

Usage (from project root, with Ollama + .env configured):
    python -m Agents.goals_planner.experiments.make_pairs_snapshot
    python -m Agents.goals_planner.experiments.make_pairs_snapshot --run-id <swot_run_id>
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:
        pass

ROOT = pathlib.Path(__file__).resolve().parents[3]
load_dotenv(ROOT / ".env", override=True)

import os

from Agents.goals_planner.grounding import ground_pairs
from Agents.goals_planner.pairing import build_pairs

OUT = pathlib.Path(__file__).resolve().parents[1] / "debug_output" / "grounded_pairs_latest.json"

_LATEST_PER_AGENT = """
WITH latest_runs AS (
    SELECT DISTINCT ON (agent_id) agent_id, run_id
    FROM swot_items
    ORDER BY agent_id, created_at DESC
)
SELECT si.*
FROM swot_items si
JOIN latest_runs lr ON si.run_id = lr.run_id
ORDER BY si.created_at
"""


def fetch_swot(run_id: str | None) -> list[dict]:
    dsn = os.getenv("DB_CONNECTION_STRING", "")
    if not dsn:
        raise SystemExit("DB_CONNECTION_STRING not set in .env")
    conn = psycopg2.connect(dsn)
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            if run_id:
                cur.execute("SELECT * FROM swot_items WHERE run_id = %s ORDER BY created_at", (run_id,))
            else:
                cur.execute(_LATEST_PER_AGENT)
            return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-id", default=None, help="restrict to one SWOT run_id (default: latest per agent)")
    args = ap.parse_args()

    print("[1/3] fetching SWOT items…")
    swot = fetch_swot(args.run_id)
    print(f"      {len(swot)} items")

    print("[2/3] building TOWS pairs (pairing.build_pairs)…")
    pairs = build_pairs(swot)
    print(f"      {len(pairs)} pairs")

    print("[3/3] grounding pairs in Neo4j (grounding.ground_pairs)…")
    pairs = ground_pairs(pairs)

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(pairs, ensure_ascii=False, default=str, indent=2), encoding="utf-8")
    print(f"\n✓ snapshot written → {OUT}  ({len(pairs)} grounded pairs)")
    print("  now run:  python -m Agents.goals_planner.experiments.leiden_clustering_test")


if __name__ == "__main__":
    main()
