"""
Node 5 — validate
Deterministic checks on the LLM draft.  No LLM.

Rules enforced:
  1. Goal title must be non-empty.
  2. Every objective's pair_id must reference a known pair from Node 1.
  3. Objective text must be ≥ SMART_MIN_WORDS words.
  4. source_swot_ids must be non-empty (populated by drafting.py enrichment).

On validation failure the graph retries drafting (≤ MAX_RETRIES).
After MAX_RETRIES the best available draft is accepted and saved anyway.
"""

from __future__ import annotations

from .config import SMART_MIN_WORDS


def validate_draft(goals: list[dict], pairs: list[dict]) -> list[str]:
    """
    Returns a list of human-readable error strings.
    An empty list means the draft passes.
    """
    valid_pair_ids = {p["pair_id"] for p in pairs}
    errors: list[str] = []

    for goal in goals:
        title = (goal.get("title") or "").strip()
        cid   = goal.get("cluster_id", "?")

        if not title:
            errors.append(f"cluster_id={cid}: goal has an empty title.")

        for obj in goal.get("objectives", []):
            # An objective may synthesise several pairs (pillar-merge); validate them all.
            pids       = obj.get("pair_ids") or [obj.get("pair_id", "")]
            pid        = pids[0] if pids else ""
            text       = obj.get("text") or ""
            word_count = len(text.split())

            unknown = [p for p in pids if p not in valid_pair_ids]
            if unknown:
                errors.append(
                    f"cluster_id={cid}: objective references unknown "
                    f"pair_id(s)={unknown!r}."
                )

            if word_count < SMART_MIN_WORDS:
                errors.append(
                    f"cluster_id={cid} pair_id={pid!r}: objective text is "
                    f"{word_count} word(s) (min {SMART_MIN_WORDS}): {text!r}"
                )

            if not obj.get("source_swot_ids"):
                errors.append(
                    f"cluster_id={cid} pair_id={pid!r}: source_swot_ids is empty."
                )

    return errors
