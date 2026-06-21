"""
One-time script: summarise NAQAAE standard target-state documents into 3-5
concise bullet points and persist results to the gap_pillar_summaries table.

How it works
------------
For each pillar in the latest gap run's structured_data.input_pillars:
  1. Detect whether target_state is a raw NAQAAE standards document.
  2. If yes → call Gemini 2.5 Flash to condense it to 3-5 bullets.
  3. UPSERT into gap_pillar_summaries (pillar_id, pillar_name, summary, naqaae_hash).

At plan-generation time the builder reads from gap_pillar_summaries:
  - hash matches → still original NAQAAE doc → show stored summary
  - hash differs  → user edited the field     → show target_state directly

Run:
    python summarize_target_states.py              # uses latest gap run
    python summarize_target_states.py <run_id>     # specific run
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import sys
from pathlib import Path

# ── Env setup ─────────────────────────────────────────────────────────────────

ROOT = Path(__file__).parent
os.environ.setdefault(
    "DB_CONNECTION_STRING",
    "postgresql://postgres.kncxyanhgpmclrsmlard:Amr01111018668@aws-1-eu-west-1.pooler.supabase.com:5432/postgres",
)
os.environ.setdefault(
    "GOOGLE_APPLICATION_CREDENTIALS",
    str(ROOT / "gcp-credentials-new.json"),
)
os.environ.setdefault("GOOGLE_CLOUD_PROJECT", "caregiver-tutoring-assistant")

sys.path.insert(0, str(ROOT))

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("summarize_target_states")

# ── Detection ─────────────────────────────────────────────────────────────────

_NAQAAE_MARKER = re.compile(r"#\s*Standard\s*\(?\d+\)?", re.IGNORECASE)


def is_naqaae_raw(text: str) -> bool:
    """Return True if text looks like a raw NAQAAE accreditation standards document."""
    return bool(_NAQAAE_MARKER.search((text or "").strip()[:300]))


def content_hash(text: str) -> str:
    """Short MD5 hash of the text — used to detect user edits."""
    return hashlib.md5((text or "").encode("utf-8")).hexdigest()[:12]


# ── LLM summariser ────────────────────────────────────────────────────────────

_TASK_TEMPLATE = """\
TASK: Extract the 3-5 most important TARGET CONDITIONS the faculty must achieve \
for the NAQAAE pillar '{pillar}' based on the accreditation standards below.

OUTPUT FORMAT: a bullet list only (one bullet per line starting with '- '). \
Use concise, active language. Omit standard numbers, indicator codes, and \
measurement thresholds — focus on what the outcome should look like. \
No preamble, no trailing text.

NAQAAE STANDARD DOCUMENT:
{document}\
"""


def summarise_pillar(pillar_name: str, target_state: str) -> str | None:
    """Call Gemini 2.5 Flash via llm._llm_call and return bullet summary, or None."""
    try:
        from chief_editor import llm as _llm  # noqa: PLC0415
        prompt = _TASK_TEMPLATE.format(pillar=pillar_name, document=target_state)
        result = _llm._llm_call(
            prompt=prompt,
            job_id="summarise_target_states",
            model="gemini-2.5-flash",
            max_output_tokens=2048,
        )
        return result.strip() if result else None
    except Exception as exc:
        logger.warning("LLM call failed for '%s': %s", pillar_name, exc)
        return None


# ── DB helpers ─────────────────────────────────────────────────────────────────

def get_conn():
    import psycopg2
    return psycopg2.connect(os.environ["DB_CONNECTION_STRING"], connect_timeout=15)


def fetch_run(conn, run_id: str | None) -> tuple[str, dict]:
    """Return (run_id, structured_data) for the specified or latest gap run."""
    import psycopg2.extras

    if run_id:
        sql = "SELECT run_id, structured_data FROM agent_runs WHERE run_id = %s LIMIT 1"
        params = (run_id,)
    else:
        sql = """
            SELECT ar.run_id, ar.structured_data
            FROM   agent_runs ar
            WHERE  EXISTS (SELECT 1 FROM gap_analysis_items g WHERE g.run_id = ar.run_id)
            ORDER  BY ar.run_timestamp DESC
            LIMIT  1
        """
        params = ()

    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, params)
        row = cur.fetchone()

    if not row:
        raise RuntimeError("No gap run found in agent_runs")

    sd = row["structured_data"]
    if isinstance(sd, str):
        sd = json.loads(sd)
    return str(row["run_id"]), sd or {}


def get_pillar_id_map(conn, run_id: str) -> dict[str, int]:
    """Return {pillar_name: pillar_id} by reading gap_analysis_items for this run."""
    import psycopg2.extras
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT DISTINCT pillar_name, pillar_id FROM gap_analysis_items "
            "WHERE run_id = %s AND pillar_id IS NOT NULL",
            (run_id,),
        )
        return {r["pillar_name"]: r["pillar_id"] for r in cur.fetchall()}


def fetch_existing_summaries(conn) -> dict[str, str]:
    """Return {pillar_name: naqaae_hash} for rows already in gap_pillar_summaries."""
    import psycopg2.extras
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT pillar_name, naqaae_hash FROM gap_pillar_summaries")
        return {r["pillar_name"]: r["naqaae_hash"] for r in cur.fetchall()}


def upsert_summary(conn, pillar_id: int, pillar_name: str, summary: str, naqaae_hash: str) -> None:
    """UPSERT one row into gap_pillar_summaries."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO gap_pillar_summaries (pillar_id, pillar_name, summary, naqaae_hash, updated_at)
            VALUES (%s, %s, %s, %s, now())
            ON CONFLICT (pillar_id) DO UPDATE
              SET pillar_name  = EXCLUDED.pillar_name,
                  summary      = EXCLUDED.summary,
                  naqaae_hash  = EXCLUDED.naqaae_hash,
                  updated_at   = now()
            """,
            (pillar_id, pillar_name, summary, naqaae_hash),
        )
    conn.commit()


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    run_id_arg = sys.argv[1] if len(sys.argv) > 1 else None

    conn = get_conn()
    conn.autocommit = False

    try:
        run_id, sd = fetch_run(conn, run_id_arg)
        logger.info("Processing gap run: %s", run_id)

        pillars: list[dict] = sd.get("input_pillars") or []
        if not pillars:
            logger.warning("No input_pillars found in structured_data — nothing to do.")
            return

        pillar_id_map     = get_pillar_id_map(conn, run_id)
        existing_hashes   = fetch_existing_summaries(conn)

        changed = 0
        for pillar in pillars:
            pname       = pillar.get("pillar") or pillar.get("pillar_name") or "?"
            target_text = pillar.get("target_state") or ""

            if not is_naqaae_raw(target_text):
                logger.info("  [%s] not a NAQAAE doc — skipping", pname)
                continue

            h = content_hash(target_text)

            # Skip if already stored in the table with the same hash
            if existing_hashes.get(pname) == h:
                logger.info("  [%s] already in table — skipping", pname)
                continue

            pillar_id = pillar_id_map.get(pname)
            if not pillar_id:
                logger.warning("  [%s] no pillar_id found in gap_analysis_items — skipping", pname)
                continue

            logger.info("  [%s] summarising …", pname)
            summary = summarise_pillar(pname, target_text)

            if summary:
                upsert_summary(conn, pillar_id, pname, summary, h)
                changed += 1
                logger.info("  [%s] done (%d chars)", pname, len(summary))
            else:
                logger.warning("  [%s] summarisation failed — not stored", pname)

        logger.info("Done. %d pillar(s) written to gap_pillar_summaries.", changed)

    finally:
        conn.close()


if __name__ == "__main__":
    main()
