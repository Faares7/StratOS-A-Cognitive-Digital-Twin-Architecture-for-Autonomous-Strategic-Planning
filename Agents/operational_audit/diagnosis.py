"""
Phase 3 — Diagnosis.

One LLM call per objective signal and one per systemic pillar flag. Each call
returns 0..N AuditFindings (strength / weakness) which are filtered by
confidence and converted into unified swot_item dicts ready for the envelope.

Confidence is N-aware: with a single report the model is told it is reading a
snapshot, and any "high" it returns is capped to "medium" because one year of
data cannot evidence a trend.
"""
from __future__ import annotations

from typing import List, Literal

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from core.llm import JSON_GUARDRAIL, local_brain

from .config import (
    AGENT_ID,
    CONFIDENCE_RANK,
    MAX_FINDINGS_PER_OBJECTIVE,
    MIN_CONFIDENCE,
    STATUS_NOT_REPORTED,
)


# ── structured-output schema ───────────────────────────────────────────────────

class AuditFinding(BaseModel):
    type: Literal["strength", "weakness"] = Field(
        description="strength if execution succeeded/improved, weakness if it stalled/declined"
    )
    title: str = Field(description="Short noun phrase naming the finding")
    description: str = Field(
        description="1-2 sentences citing the multi-year evidence (statuses/numbers/years)"
    )
    confidence: Literal["high", "medium", "low"] = Field(
        description="high only with a clear multi-year signal; low if weak/ambiguous"
    )


class AuditFindings(BaseModel):
    findings: List[AuditFinding]


# ── prompts ────────────────────────────────────────────────────────────────────

_OBJECTIVE_SYSTEM = (
    "You are an operational-execution auditor for a university program. You are "
    "given ONE strategic objective, the plan's intent for it, and how each of its "
    "indicators performed across one or more annual monitoring reports.\n\n"
    "Decide whether execution of this objective reveals a genuine STRENGTH "
    "(consistently achieved or clearly improving) or a WEAKNESS (stalled, "
    "blocked, declining, or chronically in-progress). Ground every finding in the "
    "evidence shown — cite the years, statuses, or numbers.\n\n"
    "Rules:\n"
    f"- Emit at most {MAX_FINDINGS_PER_OBJECTIVE} finding; emit NONE if the "
    "evidence is mixed/neutral with no clear signal.\n"
    "- Report only the single most decision-relevant signal for this objective.\n"
    "- Prefer reporting a weakness (a gap, stall, decline, or chronic in-progress) "
    "when one exists. Only report a strength when indicators genuinely IMPROVED "
    "across years — not when they were merely maintained at an already-done level.\n"
    "- Do not restate the plan; report what actually happened during execution.\n"
    "- Set confidence by how strong and consistent the multi-year signal is.\n"
    "- If only ONE report is available you are seeing a snapshot, not a trend: "
    "never claim a trend and keep confidence at medium or low."
    + JSON_GUARDRAIL
)

_SYSTEMIC_SYSTEM = (
    "You are an operational-execution auditor for a university program. You are "
    "given an accreditation PILLAR and a summary showing that most of its "
    "indicators (spanning several objectives) move in the same direction across "
    "the monitoring reports.\n\n"
    "Write a single SYSTEMIC finding (strength or weakness) describing the "
    "cross-cutting pattern at the pillar level — not any one objective. Ground it "
    "in the fractions and objectives provided.\n\n"
    "Rules:\n"
    "- Emit exactly ONE finding.\n"
    "- Make clear it is a pillar-wide pattern.\n"
    "- Confidence reflects how dominant the pattern is and how many reports back it."
    + JSON_GUARDRAIL
)


# ── evidence rendering ─────────────────────────────────────────────────────────

def _render_objective(sig: dict) -> str:
    lines = [
        f"Objective {sig['goal']}.{sig['objective']}: {sig['objective_title']}",
        f"Goal: {sig['goal_title']}",
        f"Reports available (N): {sig['n_reports']} covering {', '.join(sig['periods']) or 'none'}",
        f"Objective execution-health score (0-1): {sig['health_score']}",
    ]
    if sig.get("plan_targets"):
        lines.append("Plan intent:")
        for t in sig["plan_targets"][:4]:
            lines.append(f"  - {t}")
    lines.append("Indicators across years:")
    for ind in sig["indicators"]:
        series = []
        for period in sorted(ind["timeline"].keys()):
            cell = ind["timeline"][period]
            if cell["status"] == STATUS_NOT_REPORTED:
                series.append(f"{period}: not reported")
            else:
                val = f" ({cell['achieved']})" if cell["achieved"] else ""
                series.append(f"{period}: {cell['status']}{val}")
        blockers = [
            c["blocker"]
            for c in ind["timeline"].values()
            if c.get("blocker")
        ]
        line = f"  - {ind['name']} [trend={ind['trend']}]: " + "; ".join(series)
        if blockers:
            line += f"  | reasons: {blockers[-1]}"
        lines.append(line)
    return "\n".join(lines)


def _render_systemic(flag: dict) -> str:
    return (
        f"Pillar: {flag['pillar_name']} (id {flag['pillar_id']})\n"
        f"Pattern: {flag['kind'].replace('_', ' ')}\n"
        f"Indicators in pillar: {flag['total_indicators']}\n"
        f"Fraction negative (chronic/declining): {flag['negative_fraction']}\n"
        f"Fraction positive (improving/done): {flag['positive_fraction']}\n"
        f"Max reports backing it (N): {flag['n_reports']}\n"
        "Objectives involved:\n"
        + "\n".join(f"  - {o}" for o in flag["objectives"] if o)
    )


# ── confidence handling ────────────────────────────────────────────────────────

def _passes_confidence(conf: str) -> bool:
    return CONFIDENCE_RANK.get(conf, 0) >= CONFIDENCE_RANK[MIN_CONFIDENCE]


def _cap_for_n(conf: str, n_reports: int) -> str:
    """A single report cannot evidence a trend → cap 'high' to 'medium'."""
    if n_reports <= 1 and conf == "high":
        return "medium"
    return conf


def _invoke(system: str, user: str) -> list[AuditFinding]:
    structured = local_brain.with_structured_output(AuditFindings)
    try:
        resp: AuditFindings = structured.invoke(
            [SystemMessage(content=system), HumanMessage(content=user)]
        )
        return resp.findings
    except Exception as e:  # noqa: BLE001 — never let one objective sink the run
        print(f"[operational_audit] diagnosis LLM call failed: {e}")
        return []


# ── swot_item construction ─────────────────────────────────────────────────────

def _objective_evidence(sig: dict) -> list[str]:
    out = []
    for ind in sig["indicators"]:
        series = [
            f"{p}={ind['timeline'][p]['status']}"
            for p in sorted(ind["timeline"].keys())
            if ind["timeline"][p]["status"] != STATUS_NOT_REPORTED
        ]
        if series:
            out.append(f"{ind['name']}: " + ", ".join(series))
    return out


def _to_swot_item(finding: AuditFinding, sig: dict, confidence: str) -> dict:
    return {
        "type": finding.type,
        "title": finding.title,
        "description": finding.description,
        "evidence": _objective_evidence(sig),
        "impact_level": confidence,
        # Leave the pillar unset so save_envelope's categorizer tags the item by
        # its OWN finding text rather than the broad objective title — this fixes
        # mis-tagged objectives and lets pillars 2 & 3 populate. The objective's
        # title-based pillar is kept only for the internal systemic roll-up.
        "pillar_id": None,
        "pillar_name": None,
        "source_metadata": {
            "source": AGENT_ID,
            "goal": sig["goal"],
            "objective": sig["objective"],
            "objective_title": sig["objective_title"],
            "indicators": [i["name"] for i in sig["indicators"]],
            "periods": sig["periods"],
            "n_reports": sig["n_reports"],
            "health_score": sig["health_score"],
            "confidence": confidence,
            "systemic": False,
        },
    }


def _systemic_to_swot_item(finding: AuditFinding, flag: dict, confidence: str) -> dict:
    return {
        "type": finding.type,
        "title": finding.title,
        "description": finding.description,
        "evidence": [
            f"{flag['negative_fraction']:.0%} of {flag['total_indicators']} indicators "
            f"trending negative" if flag["kind"] == "systemic_weakness"
            else f"{flag['positive_fraction']:.0%} of {flag['total_indicators']} indicators "
            f"trending positive"
        ],
        "impact_level": confidence,
        "pillar_id": flag["pillar_id"],
        "pillar_name": flag["pillar_name"],
        "source_metadata": {
            "source": AGENT_ID,
            "pillar_id": flag["pillar_id"],
            "n_reports": flag["n_reports"],
            "negative_fraction": flag["negative_fraction"],
            "positive_fraction": flag["positive_fraction"],
            "objectives": flag["objectives"],
            "confidence": confidence,
            "systemic": True,
        },
    }


# ── public ─────────────────────────────────────────────────────────────────────

def diagnose(objective_signals: list[dict], systemic_flags: list[dict]) -> list[dict]:
    """Run all diagnosis LLM calls and return filtered swot_item dicts."""
    items: list[dict] = []

    for sig in objective_signals:
        if not sig["indicators"]:
            continue
        # An objective may only yield a STRENGTH if it shows genuine forward
        # movement (an up/resolved indicator); merely maintaining done indicators
        # is not a carry-forward strength. Weaknesses are always eligible.
        allow_strength = sig.get("genuine_improvement", 0) > 0
        for finding in _invoke(_OBJECTIVE_SYSTEM, _render_objective(sig))[
            :MAX_FINDINGS_PER_OBJECTIVE
        ]:
            if finding.type == "strength" and not allow_strength:
                continue
            conf = _cap_for_n(finding.confidence, sig["n_reports"])
            if _passes_confidence(conf):
                items.append(_to_swot_item(finding, sig, conf))

    for flag in systemic_flags:
        for finding in _invoke(_SYSTEMIC_SYSTEM, _render_systemic(flag))[:1]:
            conf = _cap_for_n(finding.confidence, flag["n_reports"])
            if _passes_confidence(conf):
                items.append(_systemic_to_swot_item(finding, flag, conf))

    return items
