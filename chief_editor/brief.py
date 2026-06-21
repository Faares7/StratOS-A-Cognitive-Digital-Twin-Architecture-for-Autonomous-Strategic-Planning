"""
Brief — deterministic context object for every Chief Editor LLM call.
Built from org row + carryover + run counts. Zero extra LLM calls.
"""
from __future__ import annotations
import re
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Brief:
    """Grounding context injected into every condenser and intro call."""
    org_name:             str
    faculty:              str
    period_label:         str
    vision:               str
    mission:              str
    strategic_priorities: list[str]      = field(default_factory=list)
    programs:             list[str]      = field(default_factory=list)
    key_figures:          dict[str, str] = field(default_factory=dict)
    swot_summary:         str            = ""
    gap_summary:          str            = ""
    goals_summary:        str            = ""
    exec_summary:         str            = ""

    def render(self) -> str:
        """Compact text block injected into every LLM prompt as grounding context."""
        lines = [
            f"Organisation: {self.org_name} ({self.faculty})",
            f"Strategic period: {self.period_label}",
        ]
        if self.vision:
            lines.append(f"Vision: {self.vision}")
        if self.mission:
            lines.append(f"Mission: {self.mission}")
        if self.strategic_priorities:
            lines.append("Strategic priorities: " + "; ".join(self.strategic_priorities[:6]))
        if self.programs:
            lines.append("Academic programmes: " + "; ".join(self.programs[:8]))
        if self.key_figures:
            lines.append(
                "Key figures: " + "; ".join(f"{k}={v}" for k, v in self.key_figures.items())
            )
        for label, summary in [
            ("SWOT data",  self.swot_summary),
            ("Gap data",   self.gap_summary),
            ("Goals data", self.goals_summary),
            ("Exec data",  self.exec_summary),
        ]:
            if summary:
                lines.append(f"{label}: {summary}")
        return "\n".join(lines)


def build_brief(
    org:        dict[str, Any],
    carryover:  dict[str, Any],
    swot_items: list[dict],
    gap_items:  list[dict],
    goals:      list[dict],
    objectives: list[dict],
    actions:    list[dict],
) -> Brief:
    """Build a Brief deterministically from run data. No LLM calls."""
    org_name     = org.get("display_name") or "Nile University"
    faculty      = org.get("faculty") or "ITCS"
    period_label = org.get("strategic_period") or "2024–2027"

    vision  = (org.get("vision") or org.get("vision_en") or "").strip()
    mission = (org.get("mission") or org.get("mission_en") or "").strip()
    if not vision or not mission:
        vision, mission = _vm_from_carryover(carryover, vision, mission)

    strategic_priorities = _list_from_carryover(
        carryover, ["strategic_priorities", "guiding_principles"]
    )
    programs = _list_from_carryover(
        carryover, ["academic_programs", "programs", "college_overview"]
    )

    key_figures: dict[str, str] = {}
    pt = carryover.get("prep_team") or {}
    for blk in (pt.get("blocks") or []) if isinstance(pt, dict) else []:
        for item in (blk.get("items") or []) if isinstance(blk, dict) else []:
            if not isinstance(item, str):
                continue
            if "dean" in item.lower() or "team leader" in item.lower():
                m = re.search(r"Prof\.?\s+([A-Za-z\s.]+?)(?:\s*[—\-–]|\s*$)", item)
                if m:
                    key_figures["dean"] = f"Prof. {m.group(1).strip()}"
                    break

    n_s = sum(1 for i in swot_items if (i.get("type") or "").lower() == "strength")
    n_w = sum(1 for i in swot_items if (i.get("type") or "").lower() == "weakness")
    n_o = sum(1 for i in swot_items if (i.get("type") or "").lower() == "opportunity")
    n_t = sum(1 for i in swot_items if (i.get("type") or "").lower() == "threat")
    sw_pillars = len({i.get("pillar_name") for i in swot_items if i.get("pillar_name")})
    gap_pillars = len({i.get("pillar_name") for i in gap_items if i.get("pillar_name")})

    return Brief(
        org_name=org_name,
        faculty=faculty,
        period_label=period_label,
        vision=vision,
        mission=mission,
        strategic_priorities=strategic_priorities,
        programs=programs,
        key_figures=key_figures,
        swot_summary=(
            f"{sw_pillars} NAQAAE pillars; {n_s} strengths, {n_w} weaknesses, "
            f"{n_o} opportunities, {n_t} threats"
        ),
        gap_summary=f"{gap_pillars} NAQAAE pillars, {len(gap_items)} gap items",
        goals_summary=(
            f"{len(goals)} strategic goals (غايات), "
            f"{len(objectives)} objectives (أهداف)"
        ),
        exec_summary=f"{len(actions)} activities across {len(goals)} goals",
    )


def _vm_from_carryover(
    carryover: dict, vision: str, mission: str
) -> tuple[str, str]:
    vm = carryover.get("vision_mission") or {}
    if not isinstance(vm, dict):
        return vision, mission
    texts = [
        blk.get("text", "").strip()
        for blk in (vm.get("blocks") or [])
        if isinstance(blk, dict) and blk.get("type") == "paragraph"
        and blk.get("text", "").strip()
    ]
    if not vision and texts:
        vision = texts[0]
    if not mission and len(texts) >= 2:
        mission = texts[1]
    return vision, mission


def _list_from_carryover(carryover: dict, section_keys: list[str]) -> list[str]:
    for key in section_keys:
        sec = carryover.get(key) or {}
        if not isinstance(sec, dict):
            continue
        items: list[str] = []
        for blk in (sec.get("blocks") or []):
            if isinstance(blk, dict) and blk.get("type") == "list":
                items.extend(
                    i for i in (blk.get("items") or [])
                    if isinstance(i, str) and i.strip()
                )
        if items:
            return items
    return []
