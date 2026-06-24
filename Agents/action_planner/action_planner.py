"""
StratOS — Action Plan Agent (الخطة التنفيذية) — TOP-DOWN BUDGET MODEL
======================================================================
Extends the strategy hierarchy: Run -> Goal -> Objective -> **Action item**.

For every objective of an *approved* strategy run, this agent drafts 2-4
executive activities and assigns each a share of its NAQAAE pillar's
pre-allocated budget.

Architecture — "LLM classifies, Python distributes":
  * The LLM generates English prose for each activity, assigns a
    relative_cost_weight (1–10) that reflects resource intensity relative
    to other activities in the same pillar, and classifies the activity
    into an OPEX archetype (for reporting/tagging only — NOT for pricing).
  * The LLM NEVER emits a money value.
  * Python groups all action items by NAQAAE pillar, then distributes each
    pillar's pre-allocated EGP envelope proportionally to the weights,
    rounding to the nearest 1,000 EGP and assigning any remainder to the
    highest-weight item so the pillar sums exactly to its allocation.
  * The user's workspace budget (total + 7 pillar allocations) is read from
    strategic_budget / budget_pillar_allocation at generation time. Budget
    is entered once during onboarding and updated from Settings.

Guarantees:
  * Lifecycle gate — aborts unless agent_runs.structured_data.plan_status == 'final'.
  * Idempotent — deletes prior actions for the run_id before inserting.
  * Grounded — tows_type / pillar / SWOT provenance injected so scheduling
    is urgency-aware (WT/ST threats scheduled earlier).
  * Graceful degradation — if budget is unset (0), items receive cost=0 with
    a warning; the agent never crashes on missing budget.

Entry point:
    compile_and_run(run_id: str, ...) -> dict
"""

from __future__ import annotations

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

# ── Resolve repo root ──────────────────────────────────────────────────────────
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

FINANCIALS_DIR     = _ROOT / "Data" / "financials"
OPEX_CATALOG_JSON  = FINANCIALS_DIR / "activity_opex_catalog.json"

# Planning horizon: Q1-2026 .. Q4-2029 (16 quarters, 4 plan years).
PLAN_BASE_YEAR = 2026
PLAN_END_YEAR  = 2029
PLAN_YEARS     = PLAN_END_YEAR - PLAN_BASE_YEAR + 1  # 4

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

# OPEX archetype keys — kept for categorization/reporting, no longer drive cost.
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

# NAQAAE pillar names (mirrors migrations/001 — used for grounding and budget grouping).
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

# Literal types used to constrain structured LLM output.
RoleLiteral      = Literal[ROLE_VOCAB]       # type: ignore[valid-type]
ArchetypeLiteral = Literal[ARCHETYPE_KEYS]   # type: ignore[valid-type]


# ── Gemini / Vertex model — lazy singleton ────────────────────────────────────
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
            location="global",
            temperature=0.2,
        )
    return _llm


# ══════════════════════════════════════════════════════════════════════════════
#  Archetype catalog — labels/descriptions only (no pricing)
# ══════════════════════════════════════════════════════════════════════════════

def load_catalog(path: Path = OPEX_CATALOG_JSON) -> dict[str, dict]:
    """Load the OPEX archetype catalog for categorization labels and descriptions.
    base_cost_egp values in the JSON are ignored — budget comes from the workspace."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    catalog = data["archetypes"]
    missing = set(ARCHETYPE_KEYS) - set(catalog)
    extra   = set(catalog) - set(ARCHETYPE_KEYS)
    if missing or extra:
        raise ValueError(
            f"OPEX catalog out of sync with ARCHETYPE_KEYS. "
            f"Missing in JSON: {sorted(missing)}; unexpected in JSON: {sorted(extra)}."
        )
    return catalog


# ══════════════════════════════════════════════════════════════════════════════
#  Workspace budget reader
# ══════════════════════════════════════════════════════════════════════════════

def _fetch_workspace_budget(conn) -> dict:
    """Read workspace budget and pillar allocations from DB.
    Tolerates empty/unset tables (returns 0 budget with a warning)."""
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT total_budget_egp FROM strategic_budget LIMIT 1")
            row = cur.fetchone()
            total = float(row[0]) if row and row[0] is not None else 0.0

            cur.execute(
                "SELECT pillar_id, allocated_egp FROM budget_pillar_allocation ORDER BY pillar_id"
            )
            allocs = {int(r[0]): float(r[1] or 0) for r in cur.fetchall()}

        # If table not yet seeded, equal-split fallback (agent must not crash).
        if not allocs:
            per_pillar = total / 7.0 if total > 0 else 0.0
            allocs = {i: per_pillar for i in range(1, 8)}
            print(
                "[action_planner] Warning: budget_pillar_allocation is empty — "
                "using equal-split fallback. Run migration 006_strategic_budget.sql."
            )

        return {"total_budget_egp": total, "pillar_allocations": allocs}

    except Exception as exc:
        print(f"[action_planner] Warning: could not read workspace budget: {exc}. "
              "All action items will receive cost=0.")
        return {"total_budget_egp": 0.0, "pillar_allocations": {i: 0.0 for i in range(1, 8)}}


# ══════════════════════════════════════════════════════════════════════════════
#  Top-down budget distribution engine
# ══════════════════════════════════════════════════════════════════════════════

def _round_to_thousand(x: float) -> int:
    return int(round(x / 1000.0)) * 1000


def distribute_pillar_budget(items: list[dict], pillar_budget_egp: float) -> list[dict]:
    """Assign EGP to a set of items from one pillar proportionally to their weights.

    Rules (per spec):
      - item_cost = pillar_budget × (weight / sum_of_weights), rounded to 1,000 EGP.
      - Rounding remainder assigned to the highest-weight item so the pillar sums
        exactly to its allocation.
      - All-zero weights → equal split.
      - Zero budget → cost=0 for all items.
    Returns the same list with 'inflated_cost_egp' filled in on each item.
    """
    if not items:
        return items

    total_weight = sum(float(item.get("relative_cost_weight") or 0) for item in items)

    if pillar_budget_egp <= 0:
        for item in items:
            item["inflated_cost_egp"] = 0
        return items

    budget_rounded = _round_to_thousand(pillar_budget_egp)

    if total_weight <= 0:
        # Equal split fallback.
        per_item = _round_to_thousand(pillar_budget_egp / len(items))
        for item in items:
            item["inflated_cost_egp"] = per_item
        remainder = budget_rounded - per_item * len(items)
        items[0]["inflated_cost_egp"] += remainder
        return items

    # Proportional allocation.
    raw_amounts = [
        _round_to_thousand(pillar_budget_egp * (float(item.get("relative_cost_weight") or 0) / total_weight))
        for item in items
    ]
    assigned_total = sum(raw_amounts)
    remainder = budget_rounded - assigned_total

    # Give remainder to highest-weight item (stable: first match on tie).
    if remainder != 0:
        max_idx = max(
            range(len(items)),
            key=lambda i: float(items[i].get("relative_cost_weight") or 0),
        )
        raw_amounts[max_idx] += remainder

    for item, amount in zip(items, raw_amounts):
        item["inflated_cost_egp"] = amount

    return items


def render_cost_explanation(
    item_weight: float,
    total_pillar_weight: float,
    pillar_budget_egp: float,
    allocated_egp: int,
    pillar_id: int,
) -> str:
    """Human-readable derivation receipt for the top-down allocation."""
    if pillar_budget_egp <= 0:
        return (
            f"Pillar {pillar_id} ({PILLAR_NAMES.get(pillar_id, '?')}) has no budget "
            f"allocation — cost set to 0 EGP. Configure the budget in Settings. "
            f"User-adjustable."
        )
    if total_pillar_weight <= 0:
        n = "—"
        pct_str = "equal split (all weights were 0)"
    else:
        pct = item_weight / total_pillar_weight * 100.0
        pct_str = f"weight {item_weight:.1f} / pillar total {total_pillar_weight:.1f} = {pct:.1f}%"
        n = f"{item_weight:.1f}"
    return (
        f"Allocated {allocated_egp:,} EGP = Pillar {pillar_id} budget "
        f"{int(pillar_budget_egp):,} EGP × ({pct_str}). "
        f"User-adjustable."
    )


def build_cashflow_by_year(items: list[dict]) -> list[dict]:
    """Sum assigned cost per plan year (scheduling/cash-flow view, no inflation).

    Returns a list of {year, assigned_egp} for each plan year 2026..2029.
    Items are bucketed by start_year_index (0=2026 .. 3=2029).
    """
    by_year: dict[int, float] = {i: 0.0 for i in range(PLAN_YEARS)}
    for item in items:
        idx = int(item.get("start_year_index") or 0)
        idx = max(0, min(PLAN_YEARS - 1, idx))
        by_year[idx] += float(item.get("inflated_cost_egp") or 0)
    return [
        {"year": PLAN_BASE_YEAR + idx, "assigned_egp": by_year[idx]}
        for idx in range(PLAN_YEARS)
    ]


def reconcile_pillars(items: list[dict], workspace_budget: dict) -> dict:
    """Per-pillar allocated vs assigned summary, plus workspace-level totals.

    Returns:
        pillars            — list of per-pillar rows (all 7 pillars, even empty ones).
        total_budget_egp   — workspace total from strategic_budget.
        total_allocated_egp — sum of 7 pillar allocations.
        total_assigned_egp  — sum of all action item costs.
        unallocated_egp    — total_allocated_egp − total_assigned_egp (≥ 0).
        warnings           — list of soft warning strings (never hard-fails).
    """
    pillar_allocations: dict[int, float] = workspace_budget.get("pillar_allocations", {})
    total_budget = float(workspace_budget.get("total_budget_egp", 0))

    assigned_by_pillar: dict[int, float] = {}
    items_by_pillar: dict[int, int] = {}
    for item in items:
        pid = int(item.get("pillar_id") or 0)
        cost = float(item.get("inflated_cost_egp") or 0)
        assigned_by_pillar[pid] = assigned_by_pillar.get(pid, 0.0) + cost
        items_by_pillar[pid] = items_by_pillar.get(pid, 0) + 1

    warnings: list[str] = []
    pillars_out: list[dict] = []

    for pid in range(1, 8):
        allocated = float(pillar_allocations.get(pid, 0))
        assigned  = assigned_by_pillar.get(pid, 0.0)
        n_items   = items_by_pillar.get(pid, 0)
        within    = assigned <= allocated

        if n_items > 0 and allocated == 0:
            warnings.append(
                f"Pillar {pid} ({PILLAR_NAMES.get(pid, '?')}) has {n_items} item(s) "
                f"but no budget allocation — cost was set to 0."
            )
        if n_items == 0 and allocated > 0:
            warnings.append(
                f"Pillar {pid} ({PILLAR_NAMES.get(pid, '?')}) has {allocated:,.0f} EGP "
                f"allocated but no action items — budget is unspent."
            )
        if not within:
            warnings.append(
                f"Pillar {pid} ({PILLAR_NAMES.get(pid, '?')}) assigned "
                f"{assigned:,.0f} EGP exceeds allocation {allocated:,.0f} EGP "
                f"(over by {assigned - allocated:,.0f})."
            )

        pillars_out.append({
            "pillar_id":          pid,
            "pillar_name":        PILLAR_NAMES.get(pid, f"Pillar {pid}"),
            "allocated_egp":      allocated,
            "assigned_egp":       assigned,
            "num_items":          n_items,
            "within_allocation":  within,
        })

    total_allocated = sum(float(pillar_allocations.get(p, 0)) for p in range(1, 8))
    total_assigned  = sum(assigned_by_pillar.values())

    return {
        "pillars":            pillars_out,
        "total_budget_egp":   total_budget,
        "total_allocated_egp": total_allocated,
        "total_assigned_egp": total_assigned,
        "unallocated_egp":    max(0.0, total_allocated - total_assigned),
        "warnings":           warnings,
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
    """Clamp quarters into the horizon, ensure end >= start, emit canonical strings."""
    sq, sy = parse_quarter(start_q_text)
    eq, ey = parse_quarter(end_q_text)
    sy, ey = _clamp_year(sy), _clamp_year(ey)

    start_slot = (sy - PLAN_BASE_YEAR) * 4 + (sq - 1)
    end_slot   = (ey - PLAN_BASE_YEAR) * 4 + (eq - 1)
    if end_slot < start_slot:
        ey, eq = sy, sq

    return {
        "start_quarter":    f"Q{sq} {sy}",
        "end_quarter":      f"Q{eq} {ey}",
        "start_year_index": sy - PLAN_BASE_YEAR,
    }


# ══════════════════════════════════════════════════════════════════════════════
#  Structured LLM output schema
# ══════════════════════════════════════════════════════════════════════════════

class ActionItemDraft(BaseModel):
    """One executive activity for an objective. All fields English."""

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
                    "(1) the PRIORITY level and WHY — tie it to the objective's TOWS urgency; "
                    "(2) why THIS specific start_quarter — name dependencies/prerequisites and the "
                    "PDCA phase that fix it to that quarter; (3) any concurrency or sequencing and WHY. "
                    "Write this BEFORE choosing the quarters."
    )
    start_quarter: str = Field(
        description="Format 'Q<n> <year>', within Q1 2026 .. Q4 2029. E.g. 'Q1 2026'."
    )
    end_quarter: str = Field(
        description="Format 'Q<n> <year>', within Q1 2026 .. Q4 2029, not before start_quarter."
    )
    responsible_exec: RoleLiteral = Field(  # type: ignore[valid-type]
        description="The role accountable for EXECUTING the activity. Choose exactly from the allowed roles."
    )
    responsible_monitor: RoleLiteral = Field(  # type: ignore[valid-type]
        description="The role accountable for MONITORING/follow-up. Choose exactly from the allowed roles."
    )
    classification_reasoning: str = Field(
        description="Explain the activity's economic NATURE and WHY it maps to the chosen archetype. "
                    "Also justify the relative_cost_weight: is this activity trivial/one-off, "
                    "moderate, substantial, or a major multi-year effort? Compare to the other "
                    "activities you are generating for this SAME pillar. "
                    "Do NOT state or invent any EGP amount. 1-3 sentences. "
                    "Write this BEFORE choosing archetype and weight."
    )
    assigned_archetype: ArchetypeLiteral = Field(  # type: ignore[valid-type]
        description="Classify the activity into exactly ONE cost archetype key (for reporting/tagging "
                    "only — it no longer drives cost). Use 'general_initiative' only if nothing fits."
    )
    relative_cost_weight: float = Field(
        ge=1.0, le=10.0,
        description="Relative resource intensity of THIS activity compared to other activities in the "
                    "SAME NAQAAE pillar (across ALL objectives in the pillar, not just this objective). "
                    "Scale: 1-2=trivial (committee meeting, zero-cost governance); "
                    "3-4=moderate (single workshop, one survey); "
                    "5-6=substantial (training series, curriculum revision); "
                    "7-8=major (multi-year program, large-scale recruitment); "
                    "9-10=exceptional (institution-scale initiative spanning the full horizon). "
                    "This is a RELATIVE weight, NOT an EGP value. Python distributes the pillar's "
                    "pre-allocated budget proportionally to these weights."
    )


class ObjectiveActions(BaseModel):
    """2-4 action items decomposing a single strategic objective."""

    actions: list[ActionItemDraft] = Field(
        description="Between 2 and 4 distinct, non-overlapping action items for the objective."
    )


# ══════════════════════════════════════════════════════════════════════════════
#  Prompting
# ══════════════════════════════════════════════════════════════════════════════

def _build_system_prompt(catalog: dict[str, dict]) -> str:
    role_list = "\n".join(f"  - {r}" for r in ROLE_VOCAB)
    archetype_list = "\n".join(
        f"  - {k}: {catalog[k]['description']}" for k in ARCHETYPE_KEYS
    )

    return f"""\
You are a strategic-planning expert building the EXECUTIVE ACTION PLAN (الخطة التنفيذية) \
for the School of Information Technology and Computer Science (ITCS) at Nile University, \
covering the programs: Artificial Intelligence, Computer Science, Bioinformatics, \
Biomedical Informatics, and Cyber Security.

TASK
For the given strategic objective, produce between 2 and 4 concrete, active-verb-led \
EXECUTIVE ACTIVITIES that make the objective operational. Everything in ENGLISH.

ROLES — choose responsible_exec and responsible_monitor STRICTLY from this list:
{role_list}

COST ARCHETYPES — classify each activity into exactly ONE key (for reporting/tagging only):
{archetype_list}

RELATIVE COST WEIGHT — estimate how resource-intensive each activity is relative to \
other activities in the same NAQAAE pillar (1.0–10.0, NOT an EGP value):
  1–2   trivial      (one committee meeting, zero-cost governance task)
  3–4   moderate     (single workshop, one assessment study, one report)
  5–6   substantial  (recurring training series, curriculum revision, sustained campaign)
  7–8   major        (multi-year program, large-scale recruitment, lab upgrade)
  9–10  exceptional  (institution-scale initiative spanning the full horizon)
Python will distribute this pillar's pre-allocated EGP envelope proportionally to these
weights across ALL items in the pillar. You NEVER output an EGP value.

TIMELINE — horizon is Q1 2026 .. Q4 2029 (16 quarters).
  - Write `timeline_reasoning` FIRST, then choose start_quarter and end_quarter.
  - Sequence logically with PDCA: Plan/Procure early, Execute in the middle, Evaluate late.
  - Respect the objective's urgency hint (threat-facing objectives schedule earlier).
  - end_quarter must not precede start_quarter.

KPI CONVENTIONS — kpi_name starts with 'Number of', 'Percentage of', 'Existence of', \
or 'Extent of'.

REASONING (write each rationale BEFORE the field it justifies — think, then commit):
  - activity_rationale:      why this activity + KPI follow from the objective and its SWOT grounding.
  - timeline_reasoning:      priority (tie to TOWS urgency) + why this exact quarter + concurrency.
  - classification_reasoning: economic nature of the activity + relative size vs other pillar items
                              → which justifies the archetype + weight. NEVER state an EGP amount.

Return between 2 and 4 action items now.""" + JSON_GUARDRAIL


def _build_human_prompt(objective: dict) -> str:
    tows      = (objective.get("tows_type") or "").upper()
    urgency   = TOWS_URGENCY.get(tows, "Schedule using normal PDCA sequencing.")
    pillar_id = objective.get("pillar_id")
    pillar    = f"{pillar_id} — {PILLAR_NAMES.get(pillar_id, 'Unknown')}" if pillar_id else "Unspecified"
    swot_ids  = objective.get("source_swot_ids") or []

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
    if len(drafts) < 3:
        return False
    slots = set()
    for d in drafts:
        q, y = parse_quarter(d.start_quarter)
        slots.add((_clamp_year(y) - PLAN_BASE_YEAR) * 4 + (q - 1))
    return len(slots) == 1


def _self_critique_schedule(
    objective: dict, drafts: list[ActionItemDraft]
) -> list[ActionItemDraft]:
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
            [SystemMessage(
                content="You fix scheduling only. Return the same activities with corrected quarters."
                        + JSON_GUARDRAIL
             ),
             HumanMessage(content=msg)]
        )
        if revised and len(revised.actions) == len(drafts):
            return revised.actions
    except Exception as exc:
        print(f"[action_planner] self-critique skipped: {exc}")
    return drafts


# ══════════════════════════════════════════════════════════════════════════════
#  Database access
# ══════════════════════════════════════════════════════════════════════════════

def _get_conn():
    if not DB_CONNECTION_STRING:
        raise EnvironmentError(
            "DB_CONNECTION_STRING is not set — the Action Plan agent needs the database."
        )
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
        objectives.append({
            "objective_id":   str(r[0]),
            "text":           r[1],
            "tows_type":      r[2],
            "pillar_id":      r[3],
            "source_swot_ids": r[4] or [],
            "goal_id":        str(r[6]),
            "goal_title":     r[7],
            "goal_description": r[8],
        })
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
            activity_text, original_activity_text, kpi_name, original_kpi_name,
            timeline_reasoning,
            start_quarter, end_quarter, original_start_quarter, original_end_quarter,
            start_year_index,
            responsible_exec, original_responsible_exec,
            responsible_monitor, original_responsible_monitor,
            classification_reasoning, assigned_archetype, original_assigned_archetype,
            relative_cost_weight, original_relative_cost_weight,
            inflated_cost_egp, original_inflated_cost_egp,
            cost_explanation, pricing_provenance,
            position, edited_by_user
        ) VALUES (
            %s, %s, %s,
            %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s,
            %s, %s,
            %s, %s,
            %s, %s,
            %s, %s
        )
        """,
        (
            row["action_id"], row["objective_id"], row["run_id"],
            row["activity_rationale"],
            row["activity_text"], row["activity_text"],
            row["kpi_name"], row["kpi_name"],
            row["timeline_reasoning"],
            row["start_quarter"], row["end_quarter"],
            row["start_quarter"], row["end_quarter"],
            row["start_year_index"],
            row["responsible_exec"], row["responsible_exec"],
            row["responsible_monitor"], row["responsible_monitor"],
            row["classification_reasoning"],
            row["assigned_archetype"], row["assigned_archetype"],
            row["relative_cost_weight"], row["relative_cost_weight"],
            row["inflated_cost_egp"], row["inflated_cost_egp"],
            row["cost_explanation"], Json(row["pricing_provenance"]),
            row["position"], False,
        ),
    )


# ══════════════════════════════════════════════════════════════════════════════
#  Pass 1 — Per-objective generation (LLM prose + relative weights, no EGP)
# ══════════════════════════════════════════════════════════════════════════════

def _validate_role(value: str) -> str:
    return value if value in ROLE_VOCAB else "Program Director"


def _validate_archetype(value: str) -> str:
    return value if value in ARCHETYPE_KEYS else "general_initiative"


def generate_actions_for_objective(
    objective: dict,
    system_prompt: str,
    enable_self_critique: bool,
) -> list[dict]:
    """LLM generates prose + relative_cost_weight. Returns items WITHOUT inflated_cost_egp.

    Pass 2 (distribute_pillar_budget) assigns EGP after all objectives are processed,
    so that items from different objectives in the same pillar are pooled correctly.
    """
    structured = _get_llm().with_structured_output(ObjectiveActions)
    result: ObjectiveActions = structured.invoke(
        [SystemMessage(content=system_prompt),
         HumanMessage(content=_build_human_prompt(objective))]
    )
    drafts = list(result.actions) if result and result.actions else []

    if enable_self_critique and _has_schedule_anomaly(drafts):
        drafts = _self_critique_schedule(objective, drafts)

    items: list[dict] = []
    for position, d in enumerate(drafts):
        sched    = normalize_schedule(d.start_quarter, d.end_quarter)
        archetype = _validate_archetype(d.assigned_archetype)
        items.append({
            "action_id":               str(uuid.uuid4()),
            "objective_id":            objective["objective_id"],
            "run_id":                  objective["run_id"],
            "pillar_id":               objective.get("pillar_id"),
            "activity_rationale":      d.activity_rationale,
            "activity_text":           d.activity_text,
            "kpi_name":                d.kpi_name,
            "timeline_reasoning":      d.timeline_reasoning,
            "start_quarter":           sched["start_quarter"],
            "end_quarter":             sched["end_quarter"],
            "start_year_index":        sched["start_year_index"],
            "responsible_exec":        _validate_role(d.responsible_exec),
            "responsible_monitor":     _validate_role(d.responsible_monitor),
            "classification_reasoning": d.classification_reasoning,
            "assigned_archetype":      archetype,
            "relative_cost_weight":    float(d.relative_cost_weight),
            "position":                position,
            # inflated_cost_egp, cost_explanation, pricing_provenance filled in Pass 2
        })
    return items


# ══════════════════════════════════════════════════════════════════════════════
#  Pass 2 — Pillar-scoped budget distribution
# ══════════════════════════════════════════════════════════════════════════════

def _apply_pillar_pricing(
    all_items: list[dict],
    workspace_budget: dict,
) -> list[dict]:
    """Group all items by pillar_id, distribute each pillar's budget, fill EGP fields."""
    pillar_allocations = workspace_budget.get("pillar_allocations", {})

    # Group items by pillar_id (None → 0 for unspecified).
    groups: dict[int, list[dict]] = {}
    for item in all_items:
        pid = int(item.get("pillar_id") or 0)
        groups.setdefault(pid, []).append(item)

    # Per-pillar distribution.
    for pid, items in groups.items():
        pillar_budget = float(pillar_allocations.get(pid, 0))
        total_weight  = sum(float(item.get("relative_cost_weight") or 0) for item in items)
        distribute_pillar_budget(items, pillar_budget)

        # Fill provenance + explanation now that EGP is assigned.
        for item in items:
            allocated   = int(item["inflated_cost_egp"])
            item_weight = float(item.get("relative_cost_weight") or 0)
            item["cost_explanation"] = render_cost_explanation(
                item_weight, total_weight, pillar_budget, allocated, pid
            )
            item["pricing_provenance"] = {
                "model":               "top_down_weight_distribution",
                "pillar_id":           pid,
                "pillar_budget_egp":   pillar_budget,
                "item_weight":         item_weight,
                "pillar_total_weight": total_weight,
                "allocation_formula":  "pillar_budget × (item_weight / pillar_total_weight)",
            }

        if pid == 0:
            print(
                f"[action_planner] Warning: {len(items)} item(s) have no pillar_id — "
                f"cost assigned as 0 (no pillar budget to draw from)."
            )

    return all_items


# ══════════════════════════════════════════════════════════════════════════════
#  Public entry point
# ══════════════════════════════════════════════════════════════════════════════

def compile_and_run(
    run_id: str,
    enable_self_critique: bool = True,
    require_final: bool = True,
    progress_cb=None,
) -> dict:
    """Generate the executive action plan for an approved strategy run.

    Args:
        run_id:               the strategy run (must already have goals/objectives).
        enable_self_critique: run a single LLM re-sequencing pass when 3+ activities
                              of an objective collapse into one quarter.
        require_final:        abort unless agent_runs.plan_status == 'final'.
        progress_cb:          optional callable(processed:int, total:int).

    Returns a summary dict (or {"error": ...} on failure). Persists to
    strategic_actions transactionally and idempotently.
    """
    def _report(done: int, total: int) -> None:
        if progress_cb:
            try:
                progress_cb(done, total)
            except Exception:
                pass

    if not run_id:
        return {"error": "run_id is required."}

    try:
        catalog = load_catalog()
    except Exception as exc:
        return {"error": f"Failed to load archetype catalog: {exc}"}

    system_prompt = _build_system_prompt(catalog)

    conn = None
    try:
        conn = _get_conn()

        # 1) Read workspace budget (tolerates missing tables — returns 0 gracefully).
        workspace_budget = _fetch_workspace_budget(conn)

        # 2) Lifecycle gate + fetch objectives (read-only).
        with conn.cursor() as cur:
            status = _plan_status(cur, run_id)
            if status is None:
                return {"error": f"No agent_runs row found for run_id {run_id}."}
            if require_final and status != "final":
                return {
                    "error": (
                        f"Plan is not final (plan_status='{status}'). "
                        f"Approve the plan before generating its action plan."
                    )
                }
            objectives = _fetch_objectives(cur, run_id)

        if not objectives:
            return {"error": f"No strategic objectives found for run_id {run_id}."}

        for o in objectives:
            o["run_id"] = run_id

        # 3) Pass 1 — Generate prose + relative weights per objective (LLM calls).
        total = len(objectives)
        _report(0, total)
        all_items: list[dict] = []
        for i, o in enumerate(objectives):
            try:
                all_items.extend(
                    generate_actions_for_objective(o, system_prompt, enable_self_critique)
                )
            except Exception as exc:
                print(f"[action_planner] objective {o['objective_id']} failed: {exc}")
            _report(i + 1, total)

        if not all_items:
            return {"error": "The agent produced no action items."}

        # 4) Pass 2 — Distribute pillar budgets, fill EGP + provenance.
        all_items = _apply_pillar_pricing(all_items, workspace_budget)

        # 5) Reconcile + cash-flow (non-blocking reporting).
        reconciliation = reconcile_pillars(all_items, workspace_budget)
        cashflow       = build_cashflow_by_year(all_items)

        # 6) Idempotent transactional write.
        with conn:
            with conn.cursor() as cur:
                deleted = _delete_prior_actions(cur, run_id)
                for row in all_items:
                    _insert_action(cur, row)

        print(
            f"[action_planner] run {run_id}: wrote {len(all_items)} actions "
            f"for {len(objectives)} objectives (replaced {deleted}). "
            f"Total assigned {reconciliation['total_assigned_egp']:,.0f} EGP / "
            f"allocated {reconciliation['total_allocated_egp']:,.0f} EGP."
        )
        for w in reconciliation["warnings"]:
            print(f"[action_planner] WARNING {w}")

        return {
            "run_id":               run_id,
            "objectives_processed": len(objectives),
            "actions_created":      len(all_items),
            "actions_replaced":     deleted,
            "reconciliation":       reconciliation,
            "cashflow_by_year":     cashflow,
            "horizon":              f"Q1 {PLAN_BASE_YEAR} – Q4 {PLAN_END_YEAR}",
            "budget": {
                "total_budget_egp":   workspace_budget["total_budget_egp"],
                "pillar_allocations": workspace_budget["pillar_allocations"],
                "unallocated_egp":    max(
                    0.0,
                    workspace_budget["total_budget_egp"]
                    - sum(workspace_budget["pillar_allocations"].values()),
                ),
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


# ── Manual run: python -m Agents.action_planner.action_planner <run_id> ─────
if __name__ == "__main__":
    import sys as _sys
    if len(_sys.argv) < 2:
        print("Usage: python -m Agents.action_planner.action_planner <run_id>")
        raise SystemExit(1)
    out = compile_and_run(_sys.argv[1])
    print(json.dumps(out, indent=2, ensure_ascii=False, default=str))
