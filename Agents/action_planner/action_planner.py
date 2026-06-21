"""
StratOS — Action Plan Agent (الخطة التنفيذية)
=============================================
Extends the strategy hierarchy: Run -> Goal -> Objective -> **Action item**.

For every objective of an *approved* strategy run, this agent drafts 2-4
executive activities and fills the operational-plan columns:

    activity_text · kpi_name · timeline (start/end quarter) ·
    responsible_exec · responsible_monitor · budget (computed)

Architecture — "LLM classifies, Python computes":
  * The LLM (Gemini 2.5 Flash on Vertex AI) generates the English prose,
    picks responsibilities from a controlled vocabulary, schedules quarters
    with chain-of-thought reasoning, classifies each activity into an OPEX
    archetype, and estimates a duration_multiplier (1-4).
  * The LLM NEVER emits a money value. Python loads the decoupled financial
    registries (Data/financials/*), looks up the archetype's base cost, applies
    a compounding inflation multiplier keyed to the cost driver, multiplies by
    duration, and records full pricing provenance.
  * A per-plan-year affordability check compares faculty OpEx spend against
    that year's inflated 5%-of-tuition ceiling and emits soft warnings.

Guarantees:
  * Lifecycle gate — aborts unless agent_runs.structured_data.plan_status == 'final'.
  * Idempotent — deletes prior actions for the run_id before inserting.
  * Grounded — tows_type / pillar / SWOT provenance injected so scheduling is
    urgency-aware (WT/ST threats scheduled earlier).

Entry point:
    compile_and_run(run_id: str, ...) -> dict
"""

from __future__ import annotations

import csv
import json
import os
import re
import sys
import uuid
from pathlib import Path
from typing import Any, Literal, Optional, TypedDict

from dotenv import load_dotenv
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_google_vertexai import ChatVertexAI
from pydantic import BaseModel, Field

# ── Resolve repo root (handles direct run and importlib loading) ───────────────
_ROOT = Path(__file__).parent.parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

load_dotenv(_ROOT / ".env")

import psycopg2                       # noqa: E402
from psycopg2.extras import Json      # noqa: E402

from core.llm import JSON_GUARDRAIL   # noqa: E402

# ══════════════════════════════════════════════════════════════════════════════
#  Configuration
# ══════════════════════════════════════════════════════════════════════════════

DB_CONNECTION_STRING = os.getenv("DB_CONNECTION_STRING", "")

FINANCIALS_DIR = _ROOT / "Data" / "financials"
REVENUE_CSV = FINANCIALS_DIR / "tuition_revenue_2026.csv"
OPEX_CATALOG_JSON = FINANCIALS_DIR / "activity_opex_catalog.json"

# Planning horizon: Q1-2026 .. Q4-2029 (16 quarters, 4 plan years).
PLAN_BASE_YEAR = 2026
PLAN_END_YEAR = 2029
PLAN_YEARS = PLAN_END_YEAR - PLAN_BASE_YEAR + 1  # 4

# Frozen, recorded macroeconomic assumptions for the 2026-2029 horizon (also
# echoed per row in pricing_provenance). Local CPI drives domestic costs; USD/FX
# drives imported costs. These are APPROXIMATE, conservative planning rates that
# approximate IMF WEO projections of Egypt's post-2024 inflation stabilization
# (the IMF path actually declines across the horizon, so a flat rate is a
# conservative simplification). CONFIRM against the latest IMF WEO / CBE figures
# before publication, and update here (the change is fully auditable per row).
LOCAL_CPI_RATE = 0.15   # local CPI — domestic costs (compounded annually)
USD_FX_RATE = 0.10      # EGP/USD depreciation — imported costs (compounded annually)

# Soft strategic-budget ceiling: share of net tuition revenue per year.
STRATEGIC_CEILING_PCT = 0.05

# Controlled vocabulary for responsibilities (English, per-college scope).
ROLE_VOCAB = (
    "Dean of ITCS",
    "Vice Dean of Undergraduate Programs",
    "Vice Dean of Postgraduate Studies",
    "Program Director",
    "Quality Assurance Unit",
    "ITCS Council",
    "Research Center",
    "IT Department",
    "Student Affairs",
)

# OPEX archetype keys — MUST stay in sync with activity_opex_catalog.json.
ARCHETYPE_KEYS = (
    "faculty_training_workshop",
    "student_outreach_campaign",
    "scholarship_financial_aid",
    "academic_event_conference",
    "international_mou_partnership",
    "marketing_branding",
    "accreditation_quality_prep",
    "software_license_tier_1",
    "software_license_tier_2",
    "lab_hardware_upgrade",
    "infrastructure_facility",
    "curriculum_program_development",
    "survey_assessment_study",
    "faculty_recruitment",
    "student_support_service",
    "it_system_deployment",
    "administrative_routine",
    "general_initiative",
)

# NAQAAE pillar names (mirrors migrations/001 — used to enrich prompt grounding).
PILLAR_NAMES = {
    1: "Program Mission and Management",
    2: "Program Design",
    3: "Teaching, Learning and Assessment",
    4: "Students and Graduates",
    5: "Faculty and Teaching Assistants",
    6: "Resources and Learning Facilities",
    7: "Quality Assurance and Program Evaluation",
}

# TOWS → scheduling urgency (defensive: drives "schedule earlier" for threats).
TOWS_URGENCY = {
    "WT": "HIGHEST urgency (weakness vs. threat) — schedule earliest, ideally 2026.",
    "ST": "HIGH urgency (strength vs. threat) — schedule early.",
    "WO": "MEDIUM urgency (weakness vs. opportunity) — schedule mid-horizon.",
    "SO": "BUILD-OVER-TIME (strength vs. opportunity) — may schedule later in the horizon.",
}

# Literal types used to constrain the structured LLM output.
RoleLiteral = Literal[ROLE_VOCAB]            # type: ignore[valid-type]
ArchetypeLiteral = Literal[ARCHETYPE_KEYS]   # type: ignore[valid-type]


# ── Gemini / Vertex model — lazy singleton (key/project read after load_dotenv) ─
_llm: Optional[ChatVertexAI] = None


def _get_llm() -> ChatVertexAI:
    global _llm
    if _llm is None:
        project = os.getenv("GOOGLE_CLOUD_PROJECT")
        if not project:
            raise EnvironmentError(
                "GOOGLE_CLOUD_PROJECT is not set. Add it (and "
                "GOOGLE_APPLICATION_CREDENTIALS) to the project .env file."
            )
        _llm = ChatVertexAI(
            model_name="gemini-3.1-pro-preview",
            project=project,
            location="global",   # required for the 3.1 preview models on Vertex
            temperature=0.2,
        )
    return _llm


# ══════════════════════════════════════════════════════════════════════════════
#  Financial registries  (loaded once; the LLM never sees the numbers)
# ══════════════════════════════════════════════════════════════════════════════

def load_revenue(path: Path = REVENUE_CSV) -> dict:
    """Load the tuition revenue baseline and compute the strategic envelope."""
    programs: list[dict] = []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            programs.append(
                {
                    "program": row["program"],
                    "full_annual_fee_egp": float(row["full_annual_fee_egp"]),
                    "blended_avg_fee_egp": float(row["blended_avg_fee_egp"]),
                    "estimated_enrollment": int(row["estimated_enrollment"]),
                }
            )
    total_revenue = sum(p["blended_avg_fee_egp"] * p["estimated_enrollment"] for p in programs)
    base_ceiling = total_revenue * STRATEGIC_CEILING_PCT  # year-0 (2026) envelope
    return {
        "programs": programs,
        "total_students": sum(p["estimated_enrollment"] for p in programs),
        "total_revenue_egp": total_revenue,
        "base_ceiling_egp": base_ceiling,
    }


def load_catalog(path: Path = OPEX_CATALOG_JSON) -> dict[str, dict]:
    """Load + validate the OPEX archetype catalog (must match ARCHETYPE_KEYS)."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    catalog = data["archetypes"]

    # Guard against registry / code drift — this is the source of subtle bugs.
    missing = set(ARCHETYPE_KEYS) - set(catalog)
    extra = set(catalog) - set(ARCHETYPE_KEYS)
    if missing or extra:
        raise ValueError(
            f"OPEX catalog out of sync with ARCHETYPE_KEYS. "
            f"Missing in JSON: {sorted(missing)}; unexpected in JSON: {sorted(extra)}."
        )
    return catalog


# ══════════════════════════════════════════════════════════════════════════════
#  Pricing engine  (deterministic — Python owns all arithmetic)
# ══════════════════════════════════════════════════════════════════════════════

def _round_to_thousand(x: float) -> int:
    return int(round(x / 1000.0)) * 1000


def _rate_for_driver(cost_driver: str) -> float:
    return USD_FX_RATE if cost_driver == "usd_linked" else LOCAL_CPI_RATE


def price_activity(archetype: str, duration_multiplier: int, start_year_index: int,
                   catalog: dict[str, dict]) -> dict:
    """
    Compute the budget for one activity from the catalog.

        inflated = base * duration_multiplier * (1 + rate) ** start_year_index

    `rate` is selected by the archetype's cost_driver (local CPI vs USD/FX).
    Central CapEx items keep their REAL inflated cost here — exclusion from the
    faculty envelope happens later, in the affordability check.
    """
    spec = catalog[archetype]
    base = float(spec["base_cost_egp"])
    cost_driver = spec["cost_driver"]
    funding_source = spec["funding_source"]
    rate = _rate_for_driver(cost_driver)
    duration_multiplier = max(1, min(4, int(duration_multiplier)))
    start_year_index = max(0, min(PLAN_YEARS - 1, int(start_year_index)))

    inflation_multiplier = (1.0 + rate) ** start_year_index
    inflated_raw = base * duration_multiplier * inflation_multiplier
    inflated = _round_to_thousand(inflated_raw)

    provenance = {
        "archetype": archetype,
        "base_cost_egp": base,
        "duration_multiplier": duration_multiplier,
        "start_year_index": start_year_index,
        "cost_driver": cost_driver,
        "inflation_rate": rate,
        "inflation_multiplier": round(inflation_multiplier, 4),
        "funding_source": funding_source,
        "formula": "base * duration_multiplier * (1 + rate) ** start_year_index",
        "inflated_raw_egp": round(inflated_raw, 2),
    }
    return {
        "base_cost_egp": base,
        "inflated_cost_egp": inflated,
        "cost_driver": cost_driver,
        "funding_source": funding_source,
        "duration_multiplier": duration_multiplier,
        "pricing_provenance": provenance,
    }


def render_cost_explanation(provenance: dict, inflated_cost_egp: float) -> str:
    """
    Deterministic, human-readable RECEIPT for the computed cost — rendered purely
    from the stored provenance (no LLM). This is the factual 'how the number was
    derived'; the *why* (economic judgement) lives in classification_reasoning.
    Backfillable onto existing rows straight from pricing_provenance.
    """
    arch = provenance.get("archetype", "?")
    base = float(provenance.get("base_cost_egp", 0) or 0)
    dur = int(provenance.get("duration_multiplier", 1) or 1)
    idx = int(provenance.get("start_year_index", 0) or 0)
    mult = float(provenance.get("inflation_multiplier", 1.0) or 1.0)
    driver = provenance.get("cost_driver", "local")
    funding = provenance.get("funding_source", "faculty_opex")
    year = PLAN_BASE_YEAR + idx

    if base == 0:
        return (f"Classified as '{arch}': routine, zero-budget governance funded centrally — "
                f"no marginal cost. Final cost = 0 EGP.")

    driver_lbl = "USD/FX-linked" if driver == "usd_linked" else "local-CPI"
    central = " (funded centrally, excluded from the faculty 5% envelope)" if funding == "central_capex" else ""
    return (
        f"Classified as '{arch}' (catalog base {base:,.0f} EGP, {driver_lbl} cost driver){central}. "
        f"Scaled x{dur} for its duration; activity starts {year} (plan-year index {idx}), so the "
        f"compounding inflation multiplier is {mult:g}. "
        f"Computed deterministically: {base:,.0f} x {dur} x {mult:g} = {inflated_cost_egp:,.0f} EGP."
    )


def reconcile_budget(priced_actions: list[dict], revenue: dict) -> dict:
    """
    Per-plan-year affordability check (Flaw-1 fix).

    Sums *faculty_opex* spend by plan year and compares each year to that year's
    inflated 5% ceiling. Central CapEx is reported separately and never counted
    against the faculty envelope. Returns totals + soft warnings.
    """
    base_ceiling = revenue["base_ceiling_egp"]
    faculty_by_year = {i: 0.0 for i in range(PLAN_YEARS)}
    central_total = 0.0

    for a in priced_actions:
        idx = a["start_year_index"]
        if a["funding_source"] == "central_capex":
            central_total += a["inflated_cost_egp"]
        else:
            faculty_by_year[idx] = faculty_by_year.get(idx, 0.0) + a["inflated_cost_egp"]

    warnings: list[str] = []
    per_year: list[dict] = []
    for idx in range(PLAN_YEARS):
        year = PLAN_BASE_YEAR + idx
        ceiling = _round_to_thousand(base_ceiling * (1.0 + LOCAL_CPI_RATE) ** idx)
        spend = faculty_by_year.get(idx, 0.0)
        over = spend > ceiling
        if over:
            warnings.append(
                f"[{year}] Faculty OpEx spend {spend:,.0f} EGP exceeds the "
                f"5% ceiling {ceiling:,.0f} EGP (over by {spend - ceiling:,.0f})."
            )
        per_year.append(
            {"year": year, "faculty_opex_spend_egp": spend,
             "ceiling_egp": ceiling, "within_envelope": not over}
        )

    return {
        "per_year": per_year,
        "central_capex_total_egp": central_total,
        "faculty_opex_total_egp": sum(faculty_by_year.values()),
        "warnings": warnings,
    }


# ══════════════════════════════════════════════════════════════════════════════
#  Schedule parsing / validation  (deterministic repair)
# ══════════════════════════════════════════════════════════════════════════════

_QUARTER_RE = re.compile(r"Q\s*([1-4]).*?(\d{4})", re.IGNORECASE)


def parse_quarter(text: str) -> tuple[int, int]:
    """Parse 'Q1 2026' → (quarter 1..4, year). Falls back to (1, base year)."""
    if text:
        m = _QUARTER_RE.search(str(text))
        if m:
            return int(m.group(1)), int(m.group(2))
    return 1, PLAN_BASE_YEAR


def _clamp_year(year: int) -> int:
    return max(PLAN_BASE_YEAR, min(PLAN_END_YEAR, year))


def normalize_schedule(start_q_text: str, end_q_text: str) -> dict:
    """
    Clamp quarters into the horizon, ensure end >= start, and emit canonical
    strings + the structured start_year_index used for pricing and storage.
    """
    sq, sy = parse_quarter(start_q_text)
    eq, ey = parse_quarter(end_q_text)
    sy, ey = _clamp_year(sy), _clamp_year(ey)

    # Ensure end is not before start (compare on the 0..15 quarter grid).
    start_slot = (sy - PLAN_BASE_YEAR) * 4 + (sq - 1)
    end_slot = (ey - PLAN_BASE_YEAR) * 4 + (eq - 1)
    if end_slot < start_slot:
        ey, eq = sy, sq

    return {
        "start_quarter": f"Q{sq} {sy}",
        "end_quarter": f"Q{eq} {ey}",
        "start_year_index": sy - PLAN_BASE_YEAR,
    }


# ══════════════════════════════════════════════════════════════════════════════
#  Structured LLM output schema  (no money field — Python computes cost)
# ══════════════════════════════════════════════════════════════════════════════

class ActionItemDraft(BaseModel):
    """One executive activity for an objective. All fields English."""

    # Reasoning-first (chain-of-thought): each rationale precedes the decision it
    # justifies, so the model reasons BEFORE it commits.
    activity_rationale: str = Field(
        description="Explain how this activity and its KPI follow from the parent objective "
                    "and its underlying SWOT/threat/opportunity grounding: WHY does this activity "
                    "advance the objective, and WHY does this KPI measure its success? 1-3 sentences. "
                    "Write this BEFORE composing the activity and KPI."
    )
    activity_text: str = Field(
        description="Active-verb-led, specific executive activity. English. "
                    "E.g. 'Launch a quarterly faculty workshop on AI-assisted teaching.'"
    )
    kpi_name: str = Field(
        description="Monitoring indicator, English, using standard KPI conventions: "
                    "start with 'Number of', 'Percentage of', 'Existence of', or 'Extent of'."
    )
    timeline_reasoning: str = Field(
        description="Detailed CAUSAL justification for the schedule (2-4 sentences). Explicitly state: "
                    "(1) the PRIORITY level and WHY — tie it to the objective's TOWS urgency "
                    "(threat-facing ST/WT objectives are high priority and cannot wait); "
                    "(2) why THIS specific start_quarter — name the dependencies/prerequisites and the "
                    "PDCA phase that fix it to that quarter; (3) any concurrency or sequencing with other "
                    "activities and WHY. Write this BEFORE choosing the quarters."
    )
    start_quarter: str = Field(description="Format 'Q<n> <year>', within Q1 2026 .. Q4 2029. E.g. 'Q1 2026'.")
    end_quarter: str = Field(description="Format 'Q<n> <year>', within Q1 2026 .. Q4 2029, not before start_quarter.")
    responsible_exec: RoleLiteral = Field(  # type: ignore[valid-type]
        description="The role accountable for EXECUTING the activity. Choose exactly from the allowed roles."
    )
    responsible_monitor: RoleLiteral = Field(  # type: ignore[valid-type]
        description="The role accountable for MONITORING/follow-up. Choose exactly from the allowed roles."
    )
    classification_reasoning: str = Field(
        description="Explain the activity's economic NATURE and WHY it maps to the chosen archetype "
                    "and duration_multiplier: is it one-off or recurring/multi-year, and what drives its "
                    "scale? This is the human-readable 'why it costs what it costs'. "
                    "Do NOT state or invent any EGP amount — reason ONLY about the category and duration. "
                    "1-3 sentences. Write this BEFORE choosing the archetype and duration."
    )
    assigned_archetype: ArchetypeLiteral = Field(  # type: ignore[valid-type]
        description="Classify the activity into exactly ONE cost archetype key. "
                    "Use 'general_initiative' only if nothing else fits. Do NOT estimate any money value."
    )
    duration_multiplier: int = Field(
        ge=1, le=4,
        description="Cost-scaling factor for recurring/multi-year effort: "
                    "1 = one-off (single quarter), 2 = spans ~2 years/recurs, "
                    "3-4 = sustained across most of the horizon.",
    )


class ObjectiveActions(BaseModel):
    """2-4 action items decomposing a single strategic objective."""

    actions: list[ActionItemDraft] = Field(
        description="Between 2 and 4 distinct, non-overlapping action items for the objective."
    )


# ══════════════════════════════════════════════════════════════════════════════
#  Prompting
# ══════════════════════════════════════════════════════════════════════════════

def _build_system_prompt(revenue: dict, catalog: dict[str, dict]) -> str:
    role_list = "\n".join(f"  - {r}" for r in ROLE_VOCAB)
    archetype_list = "\n".join(
        f"  - {k}: {catalog[k]['description']}" for k in ARCHETYPE_KEYS
    )
    ceiling_m = revenue["base_ceiling_egp"] / 1_000_000.0
    revenue_m = revenue["total_revenue_egp"] / 1_000_000.0

    return f"""\
You are a strategic-planning expert building the EXECUTIVE ACTION PLAN (الخطة التنفيذية) \
for the School of Information Technology and Computer Science (ITCS) at Nile University, \
covering the programs: Artificial Intelligence, Computer Science, Bioinformatics, \
Biomedical Informatics, and Cyber Security.

TASK
For the given strategic objective, produce between 2 and 4 concrete, active-verb-led \
EXECUTIVE ACTIVITIES that make the objective operational. Everything in ENGLISH.

GROUNDING & SCALE (context only — you do NOT output any budget number)
The faculty serves ~{revenue['total_students']} students and generates roughly \
{revenue_m:.0f}M EGP/year; about {ceiling_m:.1f}M EGP/year is available for strategic \
initiatives. Keep activities realistic in ambition for an institution of this size.

ROLES — choose responsible_exec and responsible_monitor STRICTLY from this list:
{role_list}

COST ARCHETYPES — classify each activity into exactly ONE key (Python prices it later):
{archetype_list}

TIMELINE — horizon is Q1 2026 .. Q4 2029 (16 quarters).
  - Write `timeline_reasoning` FIRST, then choose start_quarter and end_quarter.
  - Sequence logically with PDCA: Plan/Procure early, Execute in the middle, Evaluate late.
  - Respect the objective's urgency hint (threat-facing objectives schedule earlier).
  - end_quarter must not precede start_quarter.

KPI CONVENTIONS — kpi_name starts with 'Number of', 'Percentage of', 'Existence of', or 'Extent of'.

DURATION — set duration_multiplier: 1 = one-off; 2 = recurs / ~2 years; 3-4 = sustained across the horizon.

REASONING (write each rationale BEFORE the field it justifies — think, then commit):
  - activity_rationale: why this activity + KPI follow from the objective and its SWOT grounding.
  - timeline_reasoning: priority (tie to TOWS urgency) + why this exact quarter + any concurrency, causally.
  - classification_reasoning: the activity's economic nature (one-off vs recurring; what drives scale) →
    which justifies the archetype + duration. NEVER state or invent an EGP amount — Python prices it.

Return between 2 and 4 action items now.""" + JSON_GUARDRAIL


def _build_human_prompt(objective: dict) -> str:
    tows = (objective.get("tows_type") or "").upper()
    urgency = TOWS_URGENCY.get(tows, "Schedule using normal PDCA sequencing.")
    pillar_id = objective.get("pillar_id")
    pillar = f"{pillar_id} — {PILLAR_NAMES.get(pillar_id, 'Unknown')}" if pillar_id else "Unspecified"
    swot_ids = objective.get("source_swot_ids") or []

    return f"""\
STRATEGIC GOAL: {objective.get('goal_title', '(untitled)')}
GOAL CONTEXT: {objective.get('goal_description', '')}

OBJECTIVE TO OPERATIONALIZE:
{objective['text']}

GROUNDING:
  - NAQAAE pillar: {pillar}
  - TOWS type: {tows or 'n/a'} → {urgency}
  - Backed by {len(swot_ids)} source SWOT signal(s).

Generate 2-4 executive activities for THIS objective only."""


# ══════════════════════════════════════════════════════════════════════════════
#  Optional single self-critique pass (scheduling anomalies only)
# ══════════════════════════════════════════════════════════════════════════════

def _has_schedule_anomaly(drafts: list[ActionItemDraft]) -> bool:
    """Flag the one case deterministic repair cannot fix: no sequencing at all."""
    if len(drafts) < 3:
        return False
    slots = set()
    for d in drafts:
        q, y = parse_quarter(d.start_quarter)
        slots.add((_clamp_year(y) - PLAN_BASE_YEAR) * 4 + (q - 1))
    return len(slots) == 1  # 3+ activities all crammed into a single quarter


def _self_critique_schedule(objective: dict, drafts: list[ActionItemDraft]) -> list[ActionItemDraft]:
    """Ask the model ONCE to re-sequence quarters when activities aren't spread out."""
    summary = "\n".join(
        f"  {i+1}. {d.activity_text}  [{d.start_quarter} → {d.end_quarter}]"
        for i, d in enumerate(drafts)
    )
    msg = (
        "These activities for one objective are all scheduled in the same quarter, "
        "which ignores logical PDCA sequencing. Re-distribute their start_quarter / "
        "end_quarter across the Q1 2026 .. Q4 2029 horizon (Plan early, Execute middle, "
        "Evaluate late), keeping every other field IDENTICAL.\n\n"
        f"Objective: {objective['text']}\n\nActivities:\n{summary}"
    )
    try:
        structured = _get_llm().with_structured_output(ObjectiveActions)
        revised = structured.invoke(
            [SystemMessage(content="You fix scheduling only. Return the same activities with corrected quarters." + JSON_GUARDRAIL),
             HumanMessage(content=msg)]
        )
        if revised and len(revised.actions) == len(drafts):
            return revised.actions
    except Exception as exc:  # best-effort — never block the run on the critique
        print(f"[action_planner] self-critique skipped: {exc}")
    return drafts


# ══════════════════════════════════════════════════════════════════════════════
#  Database access
# ══════════════════════════════════════════════════════════════════════════════

def _get_conn():
    if not DB_CONNECTION_STRING:
        raise EnvironmentError("DB_CONNECTION_STRING is not set — the Action Plan agent needs the database.")
    return psycopg2.connect(DB_CONNECTION_STRING)


def _plan_status(cur, run_id: str) -> Optional[str]:
    cur.execute(
        "SELECT structured_data->>'plan_status' FROM agent_runs WHERE run_id = %s",
        (run_id,),
    )
    row = cur.fetchone()
    return row[0] if row else None


def _fetch_objectives(cur, run_id: str) -> list[dict]:
    """All objectives for a run, joined to their goal, ordered for stable output."""
    cur.execute(
        """
        SELECT o.objective_id, o.text, o.tows_type, o.pillar_id, o.source_swot_ids,
               o.position, g.goal_id, g.title, g.description, g.position
        FROM strategic_objectives o
        JOIN strategic_goals g ON o.goal_id = g.goal_id
        WHERE g.run_id = %s
        ORDER BY g.position, o.position
        """,
        (run_id,),
    )
    objectives = []
    for r in cur.fetchall():
        objectives.append(
            {
                "objective_id": str(r[0]),
                "text": r[1],
                "tows_type": r[2],
                "pillar_id": r[3],
                "source_swot_ids": r[4] or [],
                "goal_id": str(r[6]),
                "goal_title": r[7],
                "goal_description": r[8],
            }
        )
    return objectives


def _delete_prior_actions(cur, run_id: str) -> int:
    cur.execute("DELETE FROM strategic_actions WHERE run_id = %s", (run_id,))
    return cur.rowcount


def _insert_action(cur, row: dict) -> None:
    cur.execute(
        """
        INSERT INTO strategic_actions (
            action_id, objective_id, run_id,
            activity_rationale,
            activity_text, original_activity_text, kpi_name, original_kpi_name, timeline_reasoning,
            start_quarter, end_quarter, original_start_quarter, original_end_quarter, start_year_index,
            responsible_exec, original_responsible_exec, responsible_monitor, original_responsible_monitor,
            classification_reasoning, assigned_archetype, original_assigned_archetype,
            duration_multiplier, original_duration_multiplier,
            base_cost_egp, inflated_cost_egp, cost_driver, funding_source, cost_explanation, pricing_provenance,
            position, edited_by_user
        ) VALUES (
            %s, %s, %s,
            %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s,
            %s, %s,
            %s, %s, %s, %s, %s, %s,
            %s, %s
        )
        """,
        (
            row["action_id"], row["objective_id"], row["run_id"],
            row["activity_rationale"],
            row["activity_text"], row["activity_text"], row["kpi_name"], row["kpi_name"], row["timeline_reasoning"],
            row["start_quarter"], row["end_quarter"], row["start_quarter"], row["end_quarter"], row["start_year_index"],
            row["responsible_exec"], row["responsible_exec"], row["responsible_monitor"], row["responsible_monitor"],
            row["classification_reasoning"], row["assigned_archetype"], row["assigned_archetype"],
            row["duration_multiplier"], row["duration_multiplier"],
            row["base_cost_egp"], row["inflated_cost_egp"], row["cost_driver"], row["funding_source"],
            row["cost_explanation"], Json(row["pricing_provenance"]),
            row["position"], False,
        ),
    )


# ══════════════════════════════════════════════════════════════════════════════
#  Per-objective generation + pricing
# ══════════════════════════════════════════════════════════════════════════════

def _validate_role(value: str) -> str:
    return value if value in ROLE_VOCAB else "Program Director"


def _validate_archetype(value: str) -> str:
    return value if value in ARCHETYPE_KEYS else "general_initiative"


def generate_actions_for_objective(
    objective: dict,
    system_prompt: str,
    catalog: dict[str, dict],
    enable_self_critique: bool,
) -> list[dict]:
    """LLM drafts → deterministic schedule repair → (optional critique) → Python pricing."""
    structured = _get_llm().with_structured_output(ObjectiveActions)
    result: ObjectiveActions = structured.invoke(
        [SystemMessage(content=system_prompt),
         HumanMessage(content=_build_human_prompt(objective))]
    )
    drafts = list(result.actions) if result and result.actions else []

    if enable_self_critique and _has_schedule_anomaly(drafts):
        drafts = _self_critique_schedule(objective, drafts)

    priced: list[dict] = []
    for position, d in enumerate(drafts):
        sched = normalize_schedule(d.start_quarter, d.end_quarter)
        archetype = _validate_archetype(d.assigned_archetype)
        pricing = price_activity(archetype, d.duration_multiplier, sched["start_year_index"], catalog)
        cost_explanation = render_cost_explanation(pricing["pricing_provenance"], pricing["inflated_cost_egp"])
        priced.append(
            {
                "action_id": str(uuid.uuid4()),
                "objective_id": objective["objective_id"],
                "run_id": objective["run_id"],
                "activity_rationale": d.activity_rationale,
                "activity_text": d.activity_text,
                "kpi_name": d.kpi_name,
                "timeline_reasoning": d.timeline_reasoning,
                "start_quarter": sched["start_quarter"],
                "end_quarter": sched["end_quarter"],
                "start_year_index": sched["start_year_index"],
                "responsible_exec": _validate_role(d.responsible_exec),
                "responsible_monitor": _validate_role(d.responsible_monitor),
                "classification_reasoning": d.classification_reasoning,
                "assigned_archetype": archetype,
                "cost_explanation": cost_explanation,
                "position": position,
                **pricing,
            }
        )
    return priced


# ══════════════════════════════════════════════════════════════════════════════
#  Public entry point
# ══════════════════════════════════════════════════════════════════════════════

def compile_and_run(
    run_id: str,
    enable_self_critique: bool = True,
    require_final: bool = True,
    progress_cb=None,
) -> dict:
    """
    Generate the executive action plan for an approved strategy run.

    Args:
        run_id:               the strategy run (must already have goals/objectives).
        enable_self_critique: run a single LLM re-sequencing pass when 3+ activities
                              of an objective collapse into one quarter.
        require_final:        abort unless agent_runs.plan_status == 'final'.
        progress_cb:          optional callable(processed:int, total:int) invoked as
                              each objective is processed (for live UI progress).

    Returns a summary dict (or {"error": ...} on failure). Persists to
    strategic_actions transactionally and idempotently.
    """
    def _report(done: int, total: int) -> None:
        if progress_cb:
            try:
                progress_cb(done, total)
            except Exception:
                pass  # progress is best-effort; never let it break generation
    if not run_id:
        return {"error": "run_id is required."}

    try:
        revenue = load_revenue()
        catalog = load_catalog()
    except Exception as exc:
        return {"error": f"Failed to load financial registries: {exc}"}

    system_prompt = _build_system_prompt(revenue, catalog)

    conn = None
    try:
        conn = _get_conn()

        # 1) Lifecycle gate + 2) fetch objectives (read-only).
        with conn.cursor() as cur:
            status = _plan_status(cur, run_id)
            if status is None:
                return {"error": f"No agent_runs row found for run_id {run_id}."}
            if require_final and status != "final":
                return {
                    "error": f"Plan is not final (plan_status='{status}'). "
                             f"Approve the plan before generating its action plan."
                }
            objectives = _fetch_objectives(cur, run_id)

        if not objectives:
            return {"error": f"No strategic objectives found for run_id {run_id}."}

        for o in objectives:
            o["run_id"] = run_id

        # 3) Generate + price per objective (LLM calls are outside the write txn).
        total = len(objectives)
        _report(0, total)
        all_actions: list[dict] = []
        for i, o in enumerate(objectives):
            try:
                all_actions.extend(
                    generate_actions_for_objective(o, system_prompt, catalog, enable_self_critique)
                )
            except Exception as exc:
                print(f"[action_planner] objective {o['objective_id']} failed: {exc}")
            _report(i + 1, total)

        if not all_actions:
            return {"error": "The agent produced no action items."}

        # 4) Per-year affordability reconciliation (faculty OpEx vs inflated ceiling).
        budget = reconcile_budget(all_actions, revenue)

        # 5) Idempotent transactional write.
        with conn:
            with conn.cursor() as cur:
                deleted = _delete_prior_actions(cur, run_id)
                for row in all_actions:
                    _insert_action(cur, row)

        print(
            f"[action_planner] run {run_id}: wrote {len(all_actions)} actions "
            f"for {len(objectives)} objectives (replaced {deleted}). "
            f"Faculty OpEx total {budget['faculty_opex_total_egp']:,.0f} EGP; "
            f"central CapEx {budget['central_capex_total_egp']:,.0f} EGP."
        )
        for w in budget["warnings"]:
            print(f"[action_planner] CEILING WARNING {w}")

        return {
            "run_id": run_id,
            "objectives_processed": len(objectives),
            "actions_created": len(all_actions),
            "actions_replaced": deleted,
            "budget": budget,
            "horizon": f"Q1 {PLAN_BASE_YEAR} – Q4 {PLAN_END_YEAR}",
            "assumptions": {
                "local_cpi_rate": LOCAL_CPI_RATE,
                "usd_fx_rate": USD_FX_RATE,
                "strategic_ceiling_pct": STRATEGIC_CEILING_PCT,
                "total_revenue_egp": revenue["total_revenue_egp"],
            },
        }

    except Exception as exc:
        return {"error": str(exc)}
    finally:
        if conn is not None:
            conn.close()


# ══════════════════════════════════════════════════════════════════════════════
#  Optional minimal LangGraph wrapper  (single linear pipeline, no debate)
# ══════════════════════════════════════════════════════════════════════════════

class ActionPlannerState(TypedDict, total=False):
    run_id: str
    enable_self_critique: bool
    require_final: bool
    result: dict


def _node_run(state: ActionPlannerState) -> ActionPlannerState:
    state["result"] = compile_and_run(
        state["run_id"],
        enable_self_critique=state.get("enable_self_critique", True),
        require_final=state.get("require_final", True),
    )
    return state


_GRAPH = None


def get_graph():
    """Compile the single-node LangGraph (kept thin; logic lives in compile_and_run)."""
    global _GRAPH
    if _GRAPH is None:
        from langgraph.graph import StateGraph, END
        g = StateGraph(ActionPlannerState)
        g.add_node("action_planner", _node_run)
        g.set_entry_point("action_planner")
        g.add_edge("action_planner", END)
        _GRAPH = g.compile()
    return _GRAPH


# ── Manual run: python -m Agents.action_planner.action_planner <run_id> ────────
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m Agents.action_planner.action_planner <run_id>")
        raise SystemExit(1)
    out = compile_and_run(sys.argv[1])
    print(json.dumps(out, indent=2, ensure_ascii=False, default=str))
