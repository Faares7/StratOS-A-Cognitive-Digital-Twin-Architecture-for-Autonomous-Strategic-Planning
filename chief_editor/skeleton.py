"""
Static section catalog — the canonical chapter/subchapter skeleton for the
strategic plan.  This is the ONLY place the section order is defined.
No DB or catalog table is consulted; swapping sources is isolated to adapters.py.

PREFACE: sections that appear before Chapter 1, with no chapter heading or number.
  - dean_message: letter card, default textAlign="center"
  - prep_team: strategic plan preparation and update team
  - introduction: plan introduction

Cover and approval_date are NOT sections — they are derived from PlanMeta and
rendered by the template's built-in CoverPage from fresh data (not carryover).
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Literal, Optional

SectionMode = Literal["carryover", "agent"]
AgentSource  = Literal["swot", "gap", "goals", "exec"]


@dataclass
class SectionDef:
    section_key: str
    heading:     str
    mode:        SectionMode
    agent:       Optional[AgentSource] = None
    text_align:  Optional[str]        = None  # "left" | "center" | "right"


@dataclass
class ChapterDef:
    number:        int
    canonical_key: str
    title:         str
    sections:      list[SectionDef] = field(default_factory=list)


# ── Preface sections (no chapter wrapper, no chapter number) ──────────────────
# heading is a template default; generator overrides dean_message with dean's name.

PREFACE: list[SectionDef] = [
    SectionDef("dean_message", "A Message from the Dean", "carryover", text_align="center"),
    SectionDef("prep_team",    "Strategic Plan Preparation and Update Team", "carryover"),
    SectionDef("introduction", "Plan Introduction", "carryover"),
]


# ── Numbered chapters (Chapter 1–6) ───────────────────────────────────────────

SKELETON: list[ChapterDef] = [
    ChapterDef(
        number=1, canonical_key="faculty_profile", title="Faculty Profile",
        sections=[
            SectionDef("college_overview",    "Faculty Overview and Institutional Profile",       "carryover"),
            SectionDef("org_structure",       "Organizational Structure",                         "carryover"),
            SectionDef("financial_resources", "Financial Resources and Physical Infrastructure",  "carryover"),
            SectionDef("excellence_features", "Features of Excellence and Distinction",           "carryover"),
        ],
    ),
    ChapterDef(
        number=2, canonical_key="framework", title="Planning Framework",
        sections=[
            SectionDef("planning_philosophy", "Planning Philosophy and Methodology", "carryover"),
            SectionDef("risk_assessment",     "Risk Assessment",                     "carryover"),
        ],
    ),
    ChapterDef(
        number=3, canonical_key="environmental", title="Environmental Analysis",
        sections=[
            SectionDef("swot_analysis", "SWOT Analysis", "agent", "swot"),
            SectionDef("gap_analysis",  "Gap Analysis",  "agent", "gap"),
        ],
    ),
    ChapterDef(
        number=4, canonical_key="strategy", title="Strategic Direction",
        sections=[
            SectionDef("vision_mission",  "Vision, Mission, and Values",    "carryover"),
            SectionDef("strategic_goals", "Strategic Goals and Objectives", "agent", "goals"),
        ],
    ),
    ChapterDef(
        number=5, canonical_key="policies", title="Guiding Policies",
        sections=[
            SectionDef("guiding_policies", "Guiding Policies", "carryover"),
        ],
    ),
    ChapterDef(
        number=6, canonical_key="execution", title="Implementation Plan",
        sections=[
            SectionDef("implementation_plan", "Execution Plan", "agent", "exec"),
        ],
    ),
]

# Flat lookup: section_key → (ChapterDef, SectionDef)
SECTION_INDEX: dict[str, tuple[ChapterDef, SectionDef]] = {
    s.section_key: (ch, s)
    for ch in SKELETON
    for s in ch.sections
}
