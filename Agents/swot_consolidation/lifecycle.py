"""
Lifecycle matching against the previous strategic plan (decision #5).

Loads the old plan's SWOT from `Data/` JSON, re-categorizes its S/W from the 12-standard
scheme into the 7 NAQAAE pillars via the EXISTING categorizer (so old and current items
are namespaced by identical logic), then semantic-matches each current canonical cluster:

  • persistent      — matches a previous-plan item AND is still present  → priority boost
  • new             — no previous-plan match
  • carried_forward — a previous-plan item with NO current match. RETAINED by default and
                      surfaced for awareness, but NEVER auto-proposed for dropping: absence
                      from a sparse agent window means "not measured", not "addressed".
                      (True `resolved` — drop pending human confirm, decision #3 — is
                      reserved for positive-evidence cases, a later enhancement.)

IDs/text are never stable across runs, so matching is cosine-only on concept_text.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import numpy as np

from Agents.categorizer import categorize_swot_items

from .config import LIFECYCLE_MATCH_THRESHOLD, PREV_PLAN_EXTERNAL, PREV_PLAN_INTERNAL
from .dedup import _embed
from .normalize import normalize_items

# Repo root (…/Agents/swot_consolidation/lifecycle.py → parents[2]) so relative Data/
# paths resolve regardless of the process CWD (the API may launch from elsewhere).
_ROOT = Path(__file__).resolve().parents[2]
# The previous plan is STATIC; normalizing + embedding its ~147 items every run is the
# main cost (and timeout source) of a consolidation. Cache it, keyed by the source files'
# content hash, so it is computed once and reused until Data/*.json change.
_CACHE_FILE = Path(__file__).resolve().parent / ".prev_plan_cache.json"

_TYPE_FROM_KEY = {
    "strengths": "strength", "weaknesses": "weakness",
    "opportunities": "opportunity", "threats": "threat",
}


def _resolve(path: str) -> str:
    p = Path(path)
    return str(p if p.is_absolute() else _ROOT / p)


def _load_json(path: str) -> dict:
    full = _resolve(path)
    if not os.path.exists(full):
        print(f"[swot-consolidation] previous-plan file missing: {full} — treating as empty.")
        return {}
    with open(full, encoding="utf-8") as f:
        return json.load(f)


def _flatten_internal(doc: dict) -> list[dict]:
    items: list[dict] = []
    for crit in doc.get("criteria", []) or []:
        for key in ("strengths", "weaknesses"):
            for text in crit.get(key, []) or []:
                if text and str(text).strip():
                    items.append({"type": _TYPE_FROM_KEY[key], "description": str(text).strip()})
    return items


def _flatten_external(doc: dict) -> list[dict]:
    items: list[dict] = []
    for key in ("opportunities", "threats"):
        for text in doc.get(key, []) or []:
            if text and str(text).strip():
                items.append({"type": _TYPE_FROM_KEY[key], "description": str(text).strip()})
    return items


def _source_hash() -> str:
    h = hashlib.sha256()
    for path in (PREV_PLAN_INTERNAL, PREV_PLAN_EXTERNAL):
        full = _resolve(path)
        if os.path.exists(full):
            with open(full, "rb") as f:
                h.update(f.read())
    return h.hexdigest()


def _load_cache(expected_hash: str) -> tuple[list[dict], list[dict]] | None:
    if not _CACHE_FILE.exists():
        return None
    try:
        with open(_CACHE_FILE, encoding="utf-8") as f:
            blob = json.load(f)
        if blob.get("source_hash") != expected_hash:
            return None  # Data/*.json changed → recompute

        def _hydrate(rows: list[dict]) -> list[dict]:
            for it in rows:
                it["embedding"] = np.asarray(it["embedding"], dtype=float)
            return rows

        return _hydrate(blob["internal"]), _hydrate(blob["external"])
    except Exception as exc:
        print(f"[swot-consolidation] prev-plan cache unreadable ({exc}); recomputing.")
        return None


def _write_cache(source_hash: str, prev_internal: list[dict], prev_external: list[dict]) -> None:
    def _dump(rows: list[dict]) -> list[dict]:
        return [{
            "type": it["type"],
            "description": it["description"],
            "pillar_id": it.get("pillar_id"),
            "pillar_name": it.get("pillar_name"),
            "embedding": np.asarray(it["embedding"], dtype=float).tolist(),
        } for it in rows]
    try:
        with open(_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump({"source_hash": source_hash,
                       "internal": _dump(prev_internal),
                       "external": _dump(prev_external)}, f)
    except Exception as exc:
        print(f"[swot-consolidation] could not write prev-plan cache ({exc}).")


def load_previous_plan() -> tuple[list[dict], list[dict]]:
    """Return (prev_internal, prev_external), each item carrying an `embedding`.
    Cached by source-file hash — normalization/categorization/embedding only run when the
    Data/*.json change. This is the main cost of a consolidation run, so caching it makes
    re-runs fast (and avoids the front-end timeout)."""
    src_hash = _source_hash()
    cached = _load_cache(src_hash)
    if cached is not None:
        print(f"[swot-consolidation] previous plan: {len(cached[0])} internal, "
              f"{len(cached[1])} external items (cached — skipped LLM normalization).")
        return cached

    prev_internal = _flatten_internal(_load_json(PREV_PLAN_INTERNAL))
    prev_external = _flatten_external(_load_json(PREV_PLAN_EXTERNAL))

    if prev_internal:
        categorize_swot_items(prev_internal)          # adds pillar_id / pillar_name (S/W only)
        normalize_items(prev_internal)                # concept_text, so old prose matches current metrics
        for it, emb in zip(prev_internal, _embed(prev_internal)):
            it["embedding"] = emb
    if prev_external:
        normalize_items(prev_external)
        for it, emb in zip(prev_external, _embed(prev_external)):
            it["embedding"] = emb

    _write_cache(src_hash, prev_internal, prev_external)
    print(f"[swot-consolidation] previous plan: {len(prev_internal)} internal, "
          f"{len(prev_external)} external items loaded (cached for next run).")
    return prev_internal, prev_external


def _match(clusters: list[dict], prev_items: list[dict], key_fn, label: str = "") -> set[int]:
    """Annotate each cluster's lifecycle_state by best cosine to a same-namespace prev
    item (namespace = key_fn(item)). Returns the set of prev-item indices that were
    matched (i.e. NOT resolved)."""
    matched: set[int] = set()
    best_sims: list[float] = []   # Fix 0 diagnostic
    for cl in clusters:
        ns = key_fn(cl)
        best_sim, best_j = 0.0, -1
        for j, prev in enumerate(prev_items):
            if key_fn(prev) != ns:
                continue
            sim = float(np.dot(cl["embedding"], prev["embedding"]))
            if sim > best_sim:
                best_sim, best_j = sim, j
        best_sims.append(best_sim)
        if best_sim >= LIFECYCLE_MATCH_THRESHOLD:
            cl["lifecycle_state"] = "persistent"
            matched.add(best_j)
        else:
            cl["lifecycle_state"] = "new"
    _diag(label, best_sims)
    return matched


def _diag(label: str, sims: list[float]) -> None:
    """Print the distribution of best-match cosines so we can tell an altitude gap
    (uniformly low) from a join/embedding bug (zeros that should match)."""
    if not sims:
        return
    s = sorted(sims)
    n = len(s)
    above = sum(1 for x in s if x >= LIFECYCLE_MATCH_THRESHOLD)
    print(f"[swot-consolidation] lifecycle match cosines [{label}]: "
          f"min={s[0]:.3f} p50={s[n // 2]:.3f} max={s[-1]:.3f} "
          f"| >={LIFECYCLE_MATCH_THRESHOLD}: {above}/{n}")


def assign_lifecycle(internal_clusters: list[dict], external_clusters: list[dict]) -> list[dict]:
    """Set `lifecycle_state` on every current cluster (in place) and return the
    CARRIED_FORWARD candidates (previous-plan items with no current match — retained,
    never auto-dropped)."""
    prev_internal, prev_external = load_previous_plan()

    matched_int = _match(internal_clusters, prev_internal,
                         key_fn=lambda it: (it.get("pillar_id"), it.get("type")), label="internal")
    matched_ext = _match(external_clusters, prev_external,
                         key_fn=lambda it: it.get("type"), label="external")

    carried: list[dict] = []
    for j, prev in enumerate(prev_internal):
        if j not in matched_int:
            carried.append(_carried_candidate(prev, branch="internal"))
    for j, prev in enumerate(prev_external):
        if j not in matched_ext:
            carried.append(_carried_candidate(prev, branch="external"))

    persistent = sum(1 for c in internal_clusters + external_clusters
                     if c.get("lifecycle_state") == "persistent")
    print(f"[swot-consolidation] lifecycle: {persistent} persistent, "
          f"{len(carried)} carried_forward (retained, not dropped).")
    return carried


def _carried_candidate(prev: dict, branch: str) -> dict:
    return {
        "branch": branch,
        "type": prev["type"],
        "pillar_id": prev.get("pillar_id"),
        "pillar_name": prev.get("pillar_name"),
        "title": None,
        "description": prev["description"],
        "members": [],
        "lifecycle_state": "carried_forward",
    }
