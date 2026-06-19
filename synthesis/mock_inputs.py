"""
Mock inputs for plan synthesis.

These emulate what ingestion/retrieval.py (reference outline) and the signal
agents (InsightCards) will provide in production. Replace the two function
bodies to wire real data — the generator only calls these two functions.
"""
from __future__ import annotations


# ── Reference outline ─────────────────────────────────────────────────────────
# Mirrors the chapter → subchapter structure in PlanDocument.
# Each subchapter carries a reference_excerpt (prior-plan text) and
# reference_meta (for ReferencePlanProvenance).

REFERENCE_OUTLINE: list[dict] = [
    {
        "number": 1,
        "canonical_key": "executive_summary",
        "title": "Executive Summary",
        "subchapters": [
            {
                "canonical_key": "overview",
                "heading": "Overview",
                "reference_excerpt": (
                    "The 2020 plan framed the faculty's direction around accreditation "
                    "readiness and digital growth, establishing a foundation for "
                    "continuous improvement across all NAQAAE pillars."
                ),
                "reference_meta": {
                    "plan_id": "plan-2020",
                    "plan_title": "2020 Strategic Plan",
                    "section_heading": "Overview",
                    "page": 3,
                },
            },
            {
                "canonical_key": "highlights",
                "heading": "Key Highlights",
                "reference_excerpt": (
                    "Prior highlights emphasised strategic partnerships, staff "
                    "development, and research capacity as the three pillars of "
                    "institutional growth."
                ),
                "reference_meta": {
                    "plan_id": "plan-2020",
                    "plan_title": "2020 Strategic Plan",
                    "section_heading": "Highlights",
                    "page": 5,
                },
            },
        ],
    },
    {
        "number": 2,
        "canonical_key": "vision_mission",
        "title": "Vision & Mission",
        "subchapters": [
            {
                "canonical_key": "vision",
                "heading": "Our Vision",
                "reference_excerpt": (
                    "To be a globally recognised centre of excellence in computing "
                    "and information sciences, driving innovation and graduate "
                    "employability across Egypt and the Arab world."
                ),
                "reference_meta": {
                    "plan_id": "plan-2020",
                    "plan_title": "2020 Strategic Plan",
                    "section_heading": "Vision & Mission",
                    "page": 6,
                },
            },
            {
                "canonical_key": "kpis",
                "heading": "Strategic KPIs",
                "reference_excerpt": (
                    "Headline indicators target a 15% annual increase in research "
                    "output, a student satisfaction score of 90%, and 80% digital "
                    "adoption across administrative operations by 2028."
                ),
                "reference_meta": {
                    "plan_id": "plan-2020",
                    "plan_title": "2020 Strategic Plan",
                    "section_heading": "Performance Indicators",
                    "page": 8,
                },
            },
        ],
    },
    {
        "number": 3,
        "canonical_key": "strategic_goals",
        "title": "Strategic Goals",
        "subchapters": [
            {
                "canonical_key": "goal_areas",
                "heading": "Goal Areas",
                "reference_excerpt": (
                    "The faculty pursues excellence in teaching and learning, "
                    "impactful industry-relevant research, and a sustainable "
                    "financial and operational model as its three strategic pillars."
                ),
                "reference_meta": {
                    "plan_id": "plan-2020",
                    "plan_title": "2020 Strategic Plan",
                    "section_heading": "Strategic Goals",
                    "page": 11,
                },
            },
            {
                "canonical_key": "roadmap",
                "heading": "Implementation Roadmap",
                "reference_excerpt": (
                    "A phased three-year roadmap was adopted: foundation (Year 1), "
                    "acceleration (Year 2), and consolidation (Year 3), each with "
                    "measurable deliverables reviewed by the Planning Committee."
                ),
                "reference_meta": {
                    "plan_id": "plan-2020",
                    "plan_title": "2020 Strategic Plan",
                    "section_heading": "Implementation",
                    "page": 12,
                },
            },
        ],
    },
    {
        "number": 4,
        "canonical_key": "faculty_development",
        "title": "Faculty Development",
        "subchapters": [
            {
                "canonical_key": "talent_strategy",
                "heading": "Talent Strategy",
                "reference_excerpt": (
                    "The faculty commits to structured recruitment, competitive "
                    "compensation, and clear career pathways to attract and retain "
                    "top academic talent."
                ),
                "reference_meta": {
                    "plan_id": "plan-2020",
                    "plan_title": "2020 Strategic Plan",
                    "section_heading": "Faculty Development",
                    "page": 15,
                },
            },
            {
                "canonical_key": "professional_dev",
                "heading": "Professional Development",
                "reference_excerpt": (
                    "An annual budget of EGP 500,000 is allocated to professional "
                    "development including conference attendance, online certifications, "
                    "and visiting-professor exchanges."
                ),
                "reference_meta": {
                    "plan_id": "plan-2020",
                    "plan_title": "2020 Strategic Plan",
                    "section_heading": "Development Budget",
                    "page": 16,
                },
            },
        ],
    },
    {
        "number": 5,
        "canonical_key": "digital_transformation",
        "title": "Digital Transformation",
        "subchapters": [
            {
                "canonical_key": "infrastructure",
                "heading": "Digital Infrastructure",
                "reference_excerpt": (
                    "Investment in cloud-based learning platforms, a GPU research "
                    "cluster, and fibre-optic campus connectivity underpins the "
                    "faculty's digital transformation agenda."
                ),
                "reference_meta": {
                    "plan_id": "plan-2020",
                    "plan_title": "2020 Strategic Plan",
                    "section_heading": "Digital Infrastructure",
                    "page": 20,
                },
            },
            {
                "canonical_key": "ai_integration",
                "heading": "AI & Data Integration",
                "reference_excerpt": (
                    "The faculty will embed AI tools across curriculum delivery, "
                    "research workflows, and administrative processes to achieve "
                    "measurable gains in quality and efficiency."
                ),
                "reference_meta": {
                    "plan_id": "plan-2020",
                    "plan_title": "2020 Strategic Plan",
                    "section_heading": "AI Integration",
                    "page": 22,
                },
            },
        ],
    },
]


# ── InsightCards (SWOT signals from signal agents) ────────────────────────────
# Shape mirrors AgentProvenance fields in PLAN_DOCUMENT_SPEC.md §5.
# Each card has a stable `id` used for provenance citation in generated blocks.

INSIGHT_CARDS: list[dict] = [
    {
        "id": "wf-01",
        "agent": "workforce",
        "category": "weakness",
        "source": "HR metrics",
        "finding": "Part-time staff dependency ratio is 41%, above the 30% target.",
        "pillar_tag": "Pillar 4: Faculty Development",
        "confidence": 82,
        "evidence": {"part_time_ratio": 0.41, "target": 0.30},
    },
    {
        "id": "wf-02",
        "agent": "workforce",
        "category": "strength",
        "source": "HR metrics",
        "finding": "83% of full-time faculty hold doctoral degrees, exceeding the 75% benchmark.",
        "pillar_tag": "Pillar 4: Faculty Development",
        "confidence": 90,
        "evidence": {"phd_ratio": 0.83, "benchmark": 0.75},
    },
    {
        "id": "tech-01",
        "agent": "tech",
        "category": "opportunity",
        "source": "SerpApi",
        "finding": "Egyptian job demand for AI/ML skills rose 38% year over year.",
        "pillar_tag": "Pillar 12: Digital Transformation",
        "confidence": 76,
        "evidence": {"yoy_growth": 0.38},
    },
    {
        "id": "tech-02",
        "agent": "tech",
        "category": "threat",
        "source": "CISA",
        "finding": "Rising cybersecurity skill gaps threaten program relevance in STEM hiring.",
        "pillar_tag": "Pillar 3: Quality Assurance Systems",
        "confidence": 64,
        "evidence": {},
    },
    {
        "id": "sent-01",
        "agent": "sentiment",
        "category": "weakness",
        "source": "Student feedback CSV",
        "finding": "Students report weak industry exposure in current curricula.",
        "pillar_tag": "Pillar 5: Student Learning Outcomes",
        "confidence": 70,
        "evidence": {},
    },
    {
        "id": "sent-02",
        "agent": "sentiment",
        "category": "strength",
        "source": "Student feedback CSV",
        "finding": "92% of students rate faculty accessibility as good or excellent.",
        "pillar_tag": "Pillar 5: Student Learning Outcomes",
        "confidence": 88,
        "evidence": {"accessibility_score": 0.92},
    },
    {
        "id": "bench-01",
        "agent": "benchmark",
        "category": "strength",
        "source": "OpenAlex",
        "finding": "Research output grew 15% vs peer Egyptian institutions.",
        "pillar_tag": "Pillar 7: Research & Innovation",
        "confidence": 88,
        "evidence": {"growth": 0.15},
    },
    {
        "id": "bench-02",
        "agent": "benchmark",
        "category": "weakness",
        "source": "OpenAlex",
        "finding": "International co-authorship rate (8%) lags the regional median of 22%.",
        "pillar_tag": "Pillar 7: Research & Innovation",
        "confidence": 84,
        "evidence": {"co_authorship_rate": 0.08, "regional_median": 0.22},
    },
    {
        "id": "soc-01",
        "agent": "social",
        "category": "opportunity",
        "source": "Facebook",
        "finding": "Strong community interest in applied and industry-aligned programs.",
        "pillar_tag": "Pillar 8: Community Engagement",
        "confidence": 71,
        "evidence": {},
    },
    {
        "id": "soc-02",
        "agent": "social",
        "category": "threat",
        "source": "Facebook",
        "finding": "Public concern about graduate employment rates has increased by 20% in community forums.",
        "pillar_tag": "Pillar 8: Community Engagement",
        "confidence": 68,
        "evidence": {"sentiment_change": 0.20},
    },
]


# ── Public API ────────────────────────────────────────────────────────────────

def get_reference_outline(org_id: str) -> list[dict]:  # noqa: ARG001
    """Return the chapter → subchapter skeleton with reference excerpts."""
    return REFERENCE_OUTLINE


def get_insight_cards(org_id: str) -> list[dict]:  # noqa: ARG001
    """Return SWOT signal InsightCards from the signal agents."""
    return INSIGHT_CARDS
