"""
Phase 1 — Normalize.

Reads the plan JSON and each report JSON and flattens them into canonical rows
keyed by the stable objective spine (goal#, objective#).

Two products:
  * plan_index : {(goal, objective): {goal_title, objective_title,
                                      plan_targets[], plan_indicators[], timeframes[]}}
  * report_rows: list of per-indicator dicts carrying the derived status and any
                 parsed numeric value, tagged with the report's period label.

Status is derived structurally from field presence (see config) — no keyword
lexicon. Numeric values are parsed from the leading number of the `achieved`
field ("70 students" → 70.0).
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from .config import (
    PLAN_FILE,
    REPORT_FILES,
    STATUS_BLOCKED,
    STATUS_DONE,
    STATUS_IN_PROGRESS,
    STATUS_NOT_REPORTED,
)

# Matches the first number in a string, tolerating thousands separators and
# decimals: "1,200 graduates" → 1200, "85%" → 85, "70 students" → 70.
_NUM_RE = re.compile(r"-?\d+(?:\.\d+)?")


# ── small helpers ──────────────────────────────────────────────────────────────

def _clean(value) -> str:
    """Return a stripped string, treating None / empty / 'null' as empty."""
    if value is None:
        return ""
    s = str(value).strip()
    return "" if s.lower() in ("", "null", "none", "n/a", "-") else s


def _load_json(path: str | Path) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def derive_status(indicator: dict) -> str:
    """
    Map a report indicator leaf to a status using field presence only.

    Priority: a populated `achieved` means the indicator produced a result
    (done); else an active `in_progress`; else a non-achievement explanation
    (`reasons_and_corrective_actions`) means blocked; else not reported.
    """
    if _clean(indicator.get("achieved")):
        return STATUS_DONE
    if _clean(indicator.get("in_progress")):
        return STATUS_IN_PROGRESS
    if _clean(indicator.get("reasons_and_corrective_actions")):
        return STATUS_BLOCKED
    return STATUS_NOT_REPORTED


def parse_value(text) -> float | None:
    """Parse the first number out of an `achieved` string, or None."""
    cleaned = _clean(text)
    if not cleaned:
        return None
    m = _NUM_RE.search(cleaned.replace(",", ""))
    if not m:
        return None
    try:
        return float(m.group())
    except ValueError:
        return None


# ── plan ───────────────────────────────────────────────────────────────────────

def load_plan(path: str | Path = PLAN_FILE) -> dict[tuple[int, int], dict]:
    """
    Flatten the plan into {(goal#, objective#): {...}}.

    The plan provides qualitative intent (initiative `target` strings) and the
    expected indicator set per objective — no numeric targets exist in the data,
    so targets are kept as text for the LLM to read as intent.
    """
    doc = _load_json(path)
    index: dict[tuple[int, int], dict] = {}

    for goal in doc.get("goals", []):
        g_num = goal.get("number")
        g_title = _clean(goal.get("title"))
        for obj in goal.get("objectives", []):
            o_num = obj.get("number")
            key = (g_num, o_num)
            entry = index.setdefault(
                key,
                {
                    "goal": g_num,
                    "objective": o_num,
                    "goal_title": g_title,
                    "objective_title": _clean(obj.get("title")),
                    "plan_targets": [],
                    "plan_indicators": [],
                    "timeframes": [],
                },
            )
            for ini in obj.get("initiatives", []):
                target = _clean(ini.get("target"))
                if target:
                    entry["plan_targets"].append(target)
                for ind in ini.get("indicators", []):
                    ind = _clean(ind)
                    if ind:
                        entry["plan_indicators"].append(ind)
                tf = ini.get("timeframe") or {}
                if isinstance(tf, dict):
                    span = " – ".join(
                        x for x in (_clean(tf.get("from")), _clean(tf.get("to"))) if x
                    )
                    if span:
                        entry["timeframes"].append(span)

    return index


# ── reports ────────────────────────────────────────────────────────────────────

def load_report(path: str | Path, period: str) -> list[dict]:
    """
    Flatten one report into per-indicator canonical rows tagged with `period`.

    Each row: {period, goal, objective, goal_title, objective_title, activity,
               indicator, achieved, in_progress, blocker, timeframe,
               status, value}
    """
    doc = _load_json(path)
    rows: list[dict] = []

    for goal in doc.get("goals", []):
        g_num = goal.get("number")
        g_title = _clean(goal.get("title"))
        for obj in goal.get("objectives", []):
            o_num = obj.get("number")
            o_title = _clean(obj.get("title"))
            for act in obj.get("activities", []):
                activity = _clean(act.get("activity"))
                for ind in act.get("indicators", []):
                    rows.append(
                        {
                            "period": period,
                            "goal": g_num,
                            "objective": o_num,
                            "goal_title": g_title,
                            "objective_title": o_title,
                            "activity": activity,
                            "indicator": _clean(ind.get("indicator")),
                            "achieved": _clean(ind.get("achieved")),
                            "in_progress": _clean(ind.get("in_progress")),
                            "blocker": _clean(ind.get("reasons_and_corrective_actions")),
                            "timeframe": _clean(ind.get("timeframe")),
                            "status": derive_status(ind),
                            "value": parse_value(ind.get("achieved")),
                        }
                    )
    return rows


def load_reports(
    reports: list[tuple[str, str | Path]] | None = None,
) -> list[dict]:
    """
    Load all configured reports (or a caller-supplied list) into one flat list
    of rows. Missing files are skipped silently so N degrades gracefully.
    """
    reports = reports or REPORT_FILES
    all_rows: list[dict] = []
    for period, path in reports:
        if not Path(path).exists():
            print(f"[operational_audit] report not found, skipping: {path}")
            continue
        all_rows.extend(load_report(path, period))
    return all_rows


def source_hash(reports: list[tuple[str, str | Path]] | None = None) -> str:
    """Stable hash of plan + report file contents, for idempotency metadata."""
    import hashlib

    reports = reports or REPORT_FILES
    h = hashlib.sha256()
    for p in [PLAN_FILE, *[path for _, path in reports]]:
        try:
            h.update(Path(p).read_bytes())
        except OSError:
            continue
    return h.hexdigest()[:16]
