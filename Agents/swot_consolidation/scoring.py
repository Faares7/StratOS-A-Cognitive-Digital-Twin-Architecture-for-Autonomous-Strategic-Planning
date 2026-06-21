"""
Salience scoring — two scorers (docs/SWOT_PIPELINE.md §4).

Internal S/W (corroboration-driven, NO frequency — static-input agents make run-count
meaningless):
    salience_int = W_CORROBORATION·corroboration + W_SEVERITY·severity + W_PERSISTENCE·persistence

External O/T (agreement-driven — only 2 sources, so cross-source agreement beats raw count):
    salience_ext = base_priority·recency_weight + agreement_boost + persistence_boost

Every scorer returns a `factor_breakdown` dict (the raw features) alongside the final
score. That breakdown is BOTH printed to the terminal (decision #6) and persisted
(decision #2), so weights can be tuned from reviewer keep/cut later.

Internal S/W uses corroboration + severity only; lifecycle persistence is a display
badge, not a scoring boost. External O/T uses recency + agreement only.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone

from .config import (
    AGREEMENT_BOOST,
    IMPACT_MAP,
    RECENCY_LAMBDA,
    SENTIMENT_COUNT_FULL,
    SOCIAL_REF_FULL,
    W_CORROBORATION,
    W_SEVERITY,
    WINDOW_SNAPSHOTS,
)


def _distinct_agents(cluster: dict) -> list[str]:
    return sorted({m.get("agent_id") for m in cluster["members"] if m.get("agent_id")})


def _severity(cluster: dict) -> float:
    """Best [0,1] magnitude across members, by producer:
      • social_media → `reference_count` (Fix A': how many grouped posts back the theme;
        a 1-post theme is an anecdote → ~0.2). The social agent already aggregates posts.
      • sentiment    → absolute `count` (Fix 3, not the bimodal share-of-comments).
      • else (tech/audit/workforce) → producer `impact_level`.
    Neutral 0.5 if none present. Max over members."""
    best = 0.0
    seen = False
    for m in cluster["members"]:
        meta = m.get("source_metadata") or {}
        refs = meta.get("reference_count")
        if refs is not None:
            try:
                best = max(best, min(float(refs) / SOCIAL_REF_FULL, 1.0)); seen = True; continue
            except (TypeError, ValueError):
                pass
        cnt = meta.get("count")
        if cnt is not None:
            try:
                best = max(best, min(float(cnt) / SENTIMENT_COUNT_FULL, 1.0)); seen = True; continue
            except (TypeError, ValueError):
                pass
        lvl = (m.get("impact_level") or "").lower()
        if lvl in IMPACT_MAP:
            best = max(best, IMPACT_MAP[lvl]); seen = True
    return best if seen else 0.5


def _max_reference_count(cluster: dict) -> int | None:
    """Largest social reference_count among members (surfaced for the reviewer)."""
    vals = []
    for m in cluster["members"]:
        r = (m.get("source_metadata") or {}).get("reference_count")
        if r is not None:
            try:
                vals.append(int(r))
            except (TypeError, ValueError):
                pass
    return max(vals) if vals else None


def _recency_weight(cluster: dict) -> float:
    """exp(-λ · days) using the most recent member snapshot timestamp."""
    latest = None
    for m in cluster["members"]:
        ts = m.get("snapshot_ts")
        if ts is not None and (latest is None or ts > latest):
            latest = ts
    if latest is None:
        return 1.0
    now = datetime.now(timezone.utc)
    if latest.tzinfo is None:
        latest = latest.replace(tzinfo=timezone.utc)
    days = max((now - latest).total_seconds() / 86400.0, 0.0)
    return math.exp(-RECENCY_LAMBDA * days)


def _snapshot_count(cluster: dict) -> int:
    return len({m.get("snapshot_index") for m in cluster["members"] if m.get("snapshot_index") is not None}) or 1


def score_internal(cluster: dict, n_internal_agents: int) -> tuple[float, dict]:
    agents = _distinct_agents(cluster)
    corroboration = len(agents) / max(n_internal_agents, 1)        # [0,1]
    severity = _severity(cluster)

    score = W_CORROBORATION * corroboration + W_SEVERITY * severity   # Fix B: no persistence term

    breakdown = {
        "corroboration": round(corroboration, 4),
        "distinct_agents": agents,
        "severity": round(severity, 4),
        "persistent": cluster.get("lifecycle_state") == "persistent",   # display tag only
    }
    refs = _max_reference_count(cluster)
    if refs is not None:
        breakdown["reference_count"] = refs
    return round(score, 4), breakdown


def score_external(cluster: dict) -> tuple[float, dict]:
    agents = _distinct_agents(cluster)
    snapshots = _snapshot_count(cluster)

    # base_priority: producer impact_level if any, else normalized recurrence.
    impacts = [IMPACT_MAP[(m.get("impact_level") or "").lower()]
               for m in cluster["members"] if (m.get("impact_level") or "").lower() in IMPACT_MAP]
    if impacts:
        base_priority = max(impacts)
        base_source = "impact_level"
    else:
        base_priority = min(snapshots / WINDOW_SNAPSHOTS, 1.0)
        base_source = "recurrence_fallback"

    recency = _recency_weight(cluster)
    agreement = AGREEMENT_BOOST if {"tech", "social_media"}.issubset(set(agents)) else 0.0

    score = base_priority * recency + agreement                      # Fix B: no persistence term

    breakdown = {
        "base_priority": round(base_priority, 4),
        "base_source": base_source,
        "recency": round(recency, 4),
        "agreement": agreement,
        "persistent": cluster.get("lifecycle_state") == "persistent",   # display tag only
        "snapshot_count": snapshots,
        "distinct_agents": agents,
    }
    refs = _max_reference_count(cluster)
    if refs is not None:
        breakdown["reference_count"] = refs
    return round(score, 4), breakdown
