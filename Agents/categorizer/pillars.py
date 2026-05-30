"""
Single source of truth for the 7 NAQAAE pillars used by the categorizer.

Must stay in sync with migrations/001_unified_agent_outputs.sql.
"""

PILLARS: list[dict] = [
    {
        "pillar_id": 1,
        "name": "Program Mission and Management",
        "short_desc": (
            "Mission clarity and stakeholder participation, leadership selection "
            "and evaluation, marketing and visibility, international agreements "
            "and partnerships."
        ),
    },
    {
        "pillar_id": 2,
        "name": "Program Design",
        "short_desc": (
            "NARS or alternative academic reference standards, program structure "
            "and curriculum balance, program specification, course specifications "
            "and matrices."
        ),
    },
    {
        "pillar_id": 3,
        "name": "Teaching, Learning and Assessment",
        "short_desc": (
            "Diverse teaching methods, active learning and skills development, "
            "field training, diverse and fair student assessment, exam mechanisms "
            "and fairness, using results for development, feedback to students."
        ),
    },
    {
        "pillar_id": 4,
        "name": "Students and Graduates",
        "short_desc": (
            "Academic support and advising, identifying high-achieving/struggling/"
            "gifted students, student activities and career guidance, graduate "
            "follow-up and database."
        ),
    },
    {
        "pillar_id": 5,
        "name": "Faculty and Teaching Assistants",
        "short_desc": (
            "Faculty and teaching assistant numbers and workload, qualifications "
            "and competencies, selection criteria, continuous professional "
            "development, research and community activity."
        ),
    },
    {
        "pillar_id": 6,
        "name": "Resources and Learning Facilities",
        "short_desc": (
            "Financial resources, premises and lab equipment, health/safety/"
            "occupational security, digital and technological infrastructure, "
            "library and learning sources."
        ),
    },
    {
        "pillar_id": 7,
        "name": "Quality Assurance and Program Evaluation",
        "short_desc": (
            "Feedback from students/faculty/graduates/employers, course reports, "
            "annual program reports, monitoring enhancement and continuous "
            "improvement."
        ),
    },
]

_PILLAR_BY_ID = {p["pillar_id"]: p for p in PILLARS}


def get_pillar(pillar_id: int) -> dict | None:
    return _PILLAR_BY_ID.get(pillar_id)


def pillars_prompt_block() -> str:
    """Render the pillar list as a prompt-ready string for the categorizer LLM."""
    return "\n".join(
        f"{p['pillar_id']}. {p['name']} — {p['short_desc']}"
        for p in PILLARS
    )
