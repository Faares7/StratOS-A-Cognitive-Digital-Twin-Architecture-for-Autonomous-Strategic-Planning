"""
Configuration for the Operational Audit agent.

This agent mines multi-year execution trends from the executive action plan
(الخطة التنفيذية 2020-2024) and 1..N annual monitoring reports
(تقييم الخطة التنفيذية). It writes strengths/weaknesses to the swot_items
table under agent_id = "operational_audit" so the goals planner picks them up
automatically on the next strategy run.

Everything tunable lives here so behaviour can be changed in one place.
"""
from __future__ import annotations

from pathlib import Path

# ── Identity ───────────────────────────────────────────────────────────────────
AGENT_ID = "operational_audit"

# ── Data locations ─────────────────────────────────────────────────────────────
# config.py lives at <repo>/Agents/operational_audit/config.py → parents[2] = repo
_REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = _REPO_ROOT / "Data"

PLAN_FILE: Path = DATA_DIR / "الخطة_التنفيذية_2020-2024.json"

# (period_label, path) — ordered oldest → newest. Labels sort lexicographically,
# which also gives chronological order, so they double as the timeline key.
REPORT_FILES: list[tuple[str, Path]] = [
    ("2020-2021", DATA_DIR / "تقييم_الخطة_التنفيذية_2020-2021.json"),
    ("2021-2022", DATA_DIR / "تقييم_الخطة_التنفيذية_2021-2022.json"),
    ("2022-2023", DATA_DIR / "تقييم_الخطة_التنفيذية_2022-2023.json"),
]

# ── Status model ───────────────────────────────────────────────────────────────
# Status is derived structurally from which report fields are populated — no
# token/keyword lexicon is needed because the English JSON already separates
# achieved / in_progress / reasons into distinct fields.
STATUS_DONE = "done"
STATUS_IN_PROGRESS = "in_progress"
STATUS_BLOCKED = "blocked"
STATUS_NOT_REPORTED = "not_reported"

# Numeric weight per status for health/trend scoring. not_reported is excluded
# from averages entirely (it is a coverage signal, not a performance signal).
STATUS_SCORE: dict[str, float] = {
    STATUS_DONE: 1.0,
    STATUS_IN_PROGRESS: 0.4,
    STATUS_BLOCKED: 0.2,
    STATUS_NOT_REPORTED: 0.0,
}

# ── Alignment ──────────────────────────────────────────────────────────────────
# rapidfuzz token_set_ratio threshold (0-100) for matching the "same" indicator
# across years after English normalization. 84.8% of indicators match exactly;
# the fuzzy fallback recovers truncations / rewordings of the same KPI.
FUZZY_THRESHOLD = 82

# ── Systemic roll-up ───────────────────────────────────────────────────────────
# A pillar is flagged systemic-weak when at least this fraction of its indicators
# are chronic (stuck in-progress/blocked) or declining. Require a minimum
# population so a 1-indicator pillar can't trip a "systemic" flag.
# Systemic *strengths* are not emitted (they only echo per-objective strengths),
# so SYSTEMIC_STRONG_FRACTION is retained for reference but currently unused.
SYSTEMIC_WEAK_FRACTION = 0.5
SYSTEMIC_STRONG_FRACTION = 0.6  # unused — systemic roll-up is weakness-only
SYSTEMIC_MIN_INDICATORS = 4

# ── Diagnosis ──────────────────────────────────────────────────────────────────
# Findings below this confidence are dropped. Order: low < medium < high.
CONFIDENCE_RANK: dict[str, int] = {"low": 0, "medium": 1, "high": 2}
MIN_CONFIDENCE = "medium"

# Max findings the LLM may emit per objective (and per systemic flag).
# Kept at 1 so each objective contributes only its single strongest signal —
# two-per-objective floods the batch with low-value "maintenance" strengths.
MAX_FINDINGS_PER_OBJECTIVE = 1
