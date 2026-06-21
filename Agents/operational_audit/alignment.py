"""
Phase 2 — Quantified + systemic signal.

Turns the flat report rows + plan index into:
  * per-objective signals: each indicator's multi-year timeline, its trend, the
    objective's execution-health score, and the objective's NAQAAE pillar.
  * systemic pillar flags: pillars where most indicators are chronic/declining
    (systemic weakness) or improving/stably-done (systemic strength).

Indicator identity across years is resolved by exact English-normalized match
first, then a rapidfuzz token-set fallback for the ~15% that drift in wording.
"""
from __future__ import annotations

import re

from rapidfuzz import fuzz

from .config import (
    FUZZY_THRESHOLD,
    STATUS_BLOCKED,
    STATUS_DONE,
    STATUS_IN_PROGRESS,
    STATUS_NOT_REPORTED,
    STATUS_SCORE,
    SYSTEMIC_MIN_INDICATORS,
    SYSTEMIC_WEAK_FRACTION,
)

_PUNCT_RE = re.compile(r"[^\w\s]", flags=re.UNICODE)
_WS_RE = re.compile(r"\s+")

# Trend buckets considered negative / positive when rolling up to pillars.
_NEGATIVE_TRENDS = {"down", "chronic_in_progress", "chronic_blocked"}
_POSITIVE_TRENDS = {"up", "resolved", "stable_done"}

# Genuine forward movement — used to gate whether an objective may yield a
# STRENGTH. "stable_done" is deliberately excluded: simply maintaining an
# already-achieved indicator is not a strategic strength worth carrying forward.
_IMPROVING_TRENDS = {"up", "resolved"}


# ── English normalization ──────────────────────────────────────────────────────

def normalize_en(text: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace."""
    if not text:
        return ""
    text = _PUNCT_RE.sub(" ", text.lower())
    return _WS_RE.sub(" ", text).strip()


# ── indicator alignment within an objective ────────────────────────────────────

def _match_bucket(name_norm: str, buckets: list[dict]) -> dict | None:
    """Find an existing bucket for this indicator: exact-normalized, else fuzzy."""
    for b in buckets:
        if b["name_norm"] == name_norm:
            return b
    best, best_score = None, 0.0
    for b in buckets:
        score = fuzz.token_set_ratio(name_norm, b["name_norm"])
        if score > best_score:
            best, best_score = b, score
    return best if best_score >= FUZZY_THRESHOLD else None


def _classify_trend(timeline: dict[str, dict]) -> str:
    """
    Classify an indicator's multi-year trajectory.

    Numeric slope (when ≥2 years carry a value) decides up/down; otherwise the
    status-score path decides. A single report yields "single".
    """
    periods = sorted(timeline.keys())
    reported = [p for p in periods if timeline[p]["status"] != STATUS_NOT_REPORTED]
    if not reported:
        return "single" if len(periods) <= 1 else "flat"
    if len(reported) == 1:
        return "single"

    first, last = reported[0], reported[-1]

    # Numeric slope takes precedence when we have real numbers at both ends.
    v_first, v_last = timeline[first]["value"], timeline[last]["value"]
    if v_first is not None and v_last is not None and v_first != v_last:
        return "up" if v_last > v_first else "down"

    scores = [STATUS_SCORE[timeline[p]["status"]] for p in reported]
    s_first, s_last = scores[0], scores[-1]
    if s_last > s_first:
        return "up"
    if s_last < s_first:
        return "down"

    # Flat trajectory — qualify by the status it is stuck at.
    last_status = timeline[last]["status"]
    if last_status == STATUS_DONE:
        return "stable_done"
    if last_status == STATUS_IN_PROGRESS:
        return "chronic_in_progress"
    if last_status == STATUS_BLOCKED:
        return "chronic_blocked"
    if len(set(scores)) > 1:
        return "volatile"
    return "flat"


def _build_indicator_timelines(rows: list[dict], periods: list[str]) -> list[dict]:
    """Cluster an objective's report rows into per-indicator multi-year timelines."""
    buckets: list[dict] = []
    for row in rows:
        name = row["indicator"]
        if not name:
            continue
        name_norm = normalize_en(name)
        bucket = _match_bucket(name_norm, buckets)
        if bucket is None:
            bucket = {"name": name, "name_norm": name_norm, "timeline": {}}
            buckets.append(bucket)
        # If the same period appears twice, keep the higher-scoring status.
        prev = bucket["timeline"].get(row["period"])
        cell = {
            "status": row["status"],
            "value": row["value"],
            "blocker": row["blocker"],
            "achieved": row["achieved"],
        }
        if prev is None or STATUS_SCORE[cell["status"]] >= STATUS_SCORE[prev["status"]]:
            bucket["timeline"][row["period"]] = cell

    indicators = []
    for b in buckets:
        # Ensure every covered period has an entry (not_reported where absent).
        for p in periods:
            b["timeline"].setdefault(
                p, {"status": STATUS_NOT_REPORTED, "value": None, "blocker": "", "achieved": ""}
            )
        latest = sorted(b["timeline"].keys())[-1]
        indicators.append(
            {
                "name": b["name"],
                "timeline": b["timeline"],
                "trend": _classify_trend(b["timeline"]),
                "latest_status": b["timeline"][latest]["status"],
            }
        )
    return indicators


def _health_score(indicators: list[dict]) -> float:
    """Mean latest-period status score across reported indicators (0..1)."""
    scores = [
        STATUS_SCORE[i["latest_status"]]
        for i in indicators
        if i["latest_status"] != STATUS_NOT_REPORTED
    ]
    return round(sum(scores) / len(scores), 3) if scores else 0.0


# ── public: per-objective signals ──────────────────────────────────────────────

def build_objective_signals(
    plan_index: dict[tuple[int, int], dict],
    report_rows: list[dict],
    pillar_map: dict[tuple[int, int], dict],
) -> list[dict]:
    """
    One signal dict per objective that appears in the plan and/or any report.
    """
    periods = sorted({r["period"] for r in report_rows})

    # Group report rows by (goal, objective).
    by_obj: dict[tuple[int, int], list[dict]] = {}
    for r in report_rows:
        by_obj.setdefault((r["goal"], r["objective"]), []).append(r)

    keys = set(plan_index) | set(by_obj)
    signals: list[dict] = []
    for key in sorted(keys):
        g, o = key
        plan = plan_index.get(key, {})
        rows = by_obj.get(key, [])
        obj_periods = sorted({r["period"] for r in rows})
        indicators = _build_indicator_timelines(rows, obj_periods or periods)
        pillar = pillar_map.get(key, {})

        chronic = sum(1 for i in indicators if i["trend"] in _NEGATIVE_TRENDS)
        improving = sum(1 for i in indicators if i["trend"] in _POSITIVE_TRENDS)
        genuine = sum(1 for i in indicators if i["trend"] in _IMPROVING_TRENDS)

        signals.append(
            {
                "kind": "objective",
                "goal": g,
                "objective": o,
                "goal_title": plan.get("goal_title")
                or (rows[0]["goal_title"] if rows else ""),
                "objective_title": plan.get("objective_title")
                or (rows[0]["objective_title"] if rows else ""),
                "pillar_id": pillar.get("pillar_id"),
                "pillar_name": pillar.get("pillar_name"),
                "plan_targets": plan.get("plan_targets", []),
                "periods": obj_periods,
                "n_reports": len(obj_periods),
                "indicators": indicators,
                "health_score": _health_score(indicators),
                "chronic_count": chronic,
                "improving_count": improving,
                "genuine_improvement": genuine,
                "total_indicators": len(indicators),
            }
        )
    return signals


# ── public: systemic pillar roll-up ────────────────────────────────────────────

def build_systemic_flags(objective_signals: list[dict]) -> list[dict]:
    """
    Aggregate indicator trends by pillar; emit a systemic WEAKNESS flag where
    decline dominates a sufficiently populated pillar.

    Systemic *strengths* are intentionally not emitted: they merely restate the
    per-objective strengths of the same pillar and add no information. A systemic
    weakness, by contrast, surfaces a cross-cutting decline that no single
    objective makes obvious.
    """
    by_pillar: dict[int, dict] = {}
    for sig in objective_signals:
        pid = sig.get("pillar_id")
        if pid is None:
            continue
        bucket = by_pillar.setdefault(
            pid,
            {
                "pillar_id": pid,
                "pillar_name": sig.get("pillar_name"),
                "negative": 0,
                "positive": 0,
                "total": 0,
                "objectives": [],
                "max_reports": 0,
            },
        )
        for ind in sig["indicators"]:
            if ind["latest_status"] == STATUS_NOT_REPORTED:
                continue
            bucket["total"] += 1
            if ind["trend"] in _NEGATIVE_TRENDS:
                bucket["negative"] += 1
            elif ind["trend"] in _POSITIVE_TRENDS:
                bucket["positive"] += 1
        bucket["objectives"].append(sig["objective_title"])
        bucket["max_reports"] = max(bucket["max_reports"], sig["n_reports"])

    flags: list[dict] = []
    for b in by_pillar.values():
        total = b["total"]
        if total < SYSTEMIC_MIN_INDICATORS:
            continue
        neg_frac = b["negative"] / total
        pos_frac = b["positive"] / total
        if neg_frac < SYSTEMIC_WEAK_FRACTION:
            continue
        flags.append(
            {
                "kind": "systemic_weakness",
                "pillar_id": b["pillar_id"],
                "pillar_name": b["pillar_name"],
                "negative_fraction": round(neg_frac, 3),
                "positive_fraction": round(pos_frac, 3),
                "total_indicators": total,
                "objectives": b["objectives"],
                "n_reports": b["max_reports"],
            }
        )
    return flags
