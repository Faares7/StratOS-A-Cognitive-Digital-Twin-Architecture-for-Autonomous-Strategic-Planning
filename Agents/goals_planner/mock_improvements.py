"""
Mock مقترحات التحسين (improvement suggestions) for the strategy planner.

# TODO: replace with gap-analysis agent output when gap agent is built.
#       The real implementation will query the gap-analysis output table
#       and match improvements to weaknesses by item_id or pillar.

Each entry is a list of improvement suggestions for a given pillar
(matching swot_items.pillar_name values from _GAP_PILLARS).
These mirror the مقترحات التحسين column in the تحليل الفجوة tables
from the NILE University ITCS strategic plan.
"""

from __future__ import annotations

# Keyed by pillar_name (matches _GAP_PILLARS / swot_items.pillar_name)
_MOCK_BY_PILLAR: dict[str, list[str]] = {
    "Program Mission and Management": [
        "Establish a structured annual stakeholder engagement process to review and update the program mission.",
        "Develop a transparent leadership succession plan with published selection criteria.",
        "Create a formal framework for evaluating and monitoring international partnership benefits.",
        "Introduce digital participation channels (e-surveys, smart-phone apps) to raise stakeholder engagement in strategic reviews.",
    ],
    "Program Design": [
        "Conduct annual industry-needs assessments to drive curriculum updates aligned with labor-market trends.",
        "Implement a competency-based curriculum mapping process aligned to NAQAAE academic reference standards.",
        "Introduce interdisciplinary elective tracks to serve diverse student backgrounds and emerging fields.",
        "Establish a structured external review cycle for program specifications with documented improvement actions.",
    ],
    "Teaching, Learning and Assessment": [
        "Standardise assessment rubrics across all courses and publish them at the start of each semester.",
        "Expand project-based learning components with documented industry-partner involvement.",
        "Provide structured academic support for students with special educational needs.",
        "Rebalance the distribution of coursework loads across the semester to reduce peak-period pressure.",
    ],
    "Students and Graduates": [
        "Launch a structured alumni-tracking system covering the first three years post-graduation.",
        "Establish a transparent, criteria-based program allocation policy for over-subscribed programs.",
        "Expand scholarship and financial-support pathways to attract and retain high-achieving students.",
        "Develop formal employment-fair and internship-placement partnerships with IT sector companies.",
    ],
    "Faculty and Teaching Assistants": [
        "Develop an annual faculty training plan covering pedagogy, research methods, and quality standards.",
        "Increase the ratio of full-time to part-time faculty through targeted recruitment and retention incentives.",
        "Establish a faculty mentoring programme pairing junior and senior academics.",
        "Create a dedicated consultation and training centre to support faculty professional development.",
    ],
    "Resources and Learning Facilities": [
        "Create a specialised research lab with sufficient capacity for graduate-level experiments.",
        "Establish a scientific and technical consultancy centre serving both faculty and industry.",
        "Provide on-campus accommodation or transport support for visiting international staff and students.",
        "Develop and allocate a dedicated, properly equipped space for the Quality Assurance unit.",
    ],
    "Quality Assurance and Program Evaluation": [
        "Accelerate staffing of the Quality Assurance unit and allocate a dedicated workspace.",
        "Introduce formal internal and external review cycles with documented corrective-action plans.",
        "Integrate quality-performance metrics into the annual faculty and staff evaluation system.",
        "Expand the participation base in quality activities across all program stakeholders.",
    ],
}


def get_improvement_for_weakness(pillar_name: str, weakness_text: str) -> str | None:
    """
    Return a mock improvement suggestion for a given weakness.

    In production this will call the gap-analysis agent output table
    and select the improvement whose embedding is closest to weakness_text.

    For now: return the first improvement registered for the pillar.
    Returns None if the pillar is unrecognised.
    """
    # TODO: replace with real gap-analysis query
    improvements = _MOCK_BY_PILLAR.get(pillar_name or "", [])
    return improvements[0] if improvements else None


def get_all_improvements_for_pillar(pillar_name: str) -> list[str]:
    """Return all mock improvements for a pillar (useful for debugging)."""
    return _MOCK_BY_PILLAR.get(pillar_name or "", [])
