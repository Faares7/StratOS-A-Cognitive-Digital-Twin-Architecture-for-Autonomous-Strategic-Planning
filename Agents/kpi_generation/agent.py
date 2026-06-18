"""
StratOS — KPI Generation Agent
================================
Drafts a structured KPI plan for Nile University ITCS programs, mapped
to each of the 7 NAQAAE Programmatic Accreditation Standards (2022 Amended).

Scope — Planning Phase only:
  This agent generates KPI *text and targets* (draft).  It does NOT assign
  data sources or measure progress — a separate data-fulfillment agent handles
  that downstream.

Entry point:
    compile_and_run(
        program_name, college_name, university_name,
        planning_horizon, kpis_per_standard
    ) -> dict
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_google_vertexai import ChatVertexAI
from pydantic import BaseModel, Field

# ── Resolve core package (handles both direct run and importlib loader) ────────
_ROOT = Path(__file__).parent.parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

load_dotenv(_ROOT / ".env")

from core.llm import JSON_GUARDRAIL
from core.persistence import build_envelope, save_envelope

# ── Vertex AI model — lazy singleton so env vars are read after load_dotenv ───
_llm: ChatVertexAI | None = None


def _get_llm() -> ChatVertexAI:
    global _llm
    if _llm is None:
        project = os.getenv("GOOGLE_CLOUD_PROJECT")
        if not project:
            raise EnvironmentError(
                "GOOGLE_CLOUD_PROJECT is not set. "
                "Add it to the project .env file."
            )
        _llm = ChatVertexAI(
            model_name="gemini-2.5-flash",
            project=project,
            temperature=0.2,
        )
    return _llm


# ══════════════════════════════════════════════════════════════════════════════
#  Pydantic Output Schemas
# ══════════════════════════════════════════════════════════════════════════════

class KPIItem(BaseModel):
    """A single KPI mapped to one of the 7 NAQAAE programmatic standards."""

    standard_id: str = Field(
        description="The NAQAAE standard number this KPI belongs to. "
                    "Must be a string from '1' to '7'."
    )
    kpi_name: str = Field(
        description=(
            "The KPI name in Arabic. MUST start with one of the canonical Nile "
            "University prefixes: 'عدد' (count), 'نسبة' (ratio/percentage), "
            "'وجود' (existence), or 'مدى' (extent). "
            "Example: 'نسبة أعضاء هيئة التدريس الحاصلين على دورات تدريبية سنوياً'"
        )
    )
    target_description: str = Field(
        description=(
            "A specific, measurable target for this KPI written in Arabic. "
            "Must include a concrete number, percentage, or binary statement. "
            "Example: 'لا يقل عن 80% من أعضاء هيئة التدريس' "
            "or '3 تقارير على الأقل سنوياً' "
            "or 'نعم — يوجد ومعتمد من مجلس البرنامج'"
        )
    )
    responsible_entity: str = Field(
        description=(
            "The INTERNAL university entity responsible for achieving this KPI "
            "— written in Arabic. Must be one of the standard Nile University "
            "role titles: عميد الكلية / وكيل الكلية لمرحلة البكالوريوس / "
            "مدير البرنامج / وحدة ضمان الجودة / مجلس البرنامج / "
            "أعضاء هيئة التدريس / الهيئة المعاونة / لجنة الجودة. "
            "Do NOT reference external bodies (NAQAAE, Ministry, etc.)."
        )
    )
    timeframe: str = Field(
        description=(
            "Monitoring frequency or deadline in Arabic. "
            "Choose from: 'فصلي' / 'سنوي' / 'كل ثلاث سنوات' / "
            "or a specific year range matching the planning horizon."
        )
    )


class KPIPlan(BaseModel):
    """The complete AI-generated KPI plan for all 7 NAQAAE standards."""

    kpis: list[KPIItem] = Field(
        description="Ordered list of KPIs covering all 7 NAQAAE standards."
    )


KPIPlan.model_rebuild()


# ══════════════════════════════════════════════════════════════════════════════
#  System Prompt  (THE canonical prompt — this is the primary deliverable)
# ══════════════════════════════════════════════════════════════════════════════

_SYSTEM_PROMPT = """\
You are a strategic planning expert for Egyptian higher education institutions. \
You specialise in NAQAAE (National Authority for Quality Assurance and \
Accreditation of Education) programmatic accreditation and institutional \
KPI design.

Your task: draft measurable Key Performance Indicators (KPIs) for each of the \
7 NAQAAE Programmatic Accreditation Standards (2022 Amended Edition), written \
in the authentic KPI style of Nile University's strategic plan.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THE 7 NAQAAE PROGRAMMATIC STANDARDS — INDICATORS TO COVER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Standard 1 — رسالة وإدارة البرنامج (Program Mission and Management | 4 indicators)
  • Clarity, formal approval, and multi-channel publication of the program mission
  • Qualified leadership selected by documented, transparent criteria; periodic evaluation
  • Multi-channel marketing that highlights the program's competitive features locally/internationally
  • International partnership agreements with defined roles and benefit tracking (if applicable)

Standard 2 — تصميم البرنامج (Program Design | 4 indicators)
  • Adoption of NARS (National Academic Reference Standards) or equivalent approved standards
  • Balanced curriculum structure: theory ↔ practical/field components; coherent sequencing
  • Approved, published program specification document (توصيف البرنامج المعتمد)
  • Approved, published course specifications for all program courses (توصيف المقررات)

Standard 3 — التعليم والتعلم والتقييم (Teaching, Learning and Assessment | 8 indicators)
  • Diverse, outcome-aligned teaching methods applied across the program schedule
  • Student-centred learning methods that promote self-directed study and higher-order thinking
  • Field training executed with relevant employers: clear plan, supervision mechanisms, evaluation
  • Varied student assessment methods (written, practical, oral, project, portfolio, clinical)
  • Approved examination-setting mechanism verifying content coverage and learning-outcome alignment
  • Fair assessment governance: invigilation rules, Kanterole committees, documented results, anti-cheating
  • Systematic analysis of student results discussed in relevant committees; used for program improvement
  • Timely, constructive feedback to students on formative and summative assessments

Standard 4 — الطلاب والخريجون (Students and Graduates | 3 indicators)
  • Active, announced academic support system covering advising, gifted/struggling/special-needs students
  • Student participation in diverse co-curricular activities; career guidance and professional orientation
  • Active alumni engagement: communication channels, professional tracking, support mechanisms

Standard 5 — أعضاء هيئة التدريس والهيئة المعاونة (Faculty and Supporting Staff | 6 indicators)
  • Adequate faculty headcount for the program's teaching load (per NAQAAE reference ratios)
  • Adequate supporting (معاونة) staff headcount per reference ratios
  • Alignment of faculty and staff qualifications/expertise with the courses they teach
  • Transparent, approved selection criteria for faculty/staff recruitment; periodic surplus/deficit review
  • Regular faculty and staff participation in continuing professional development (CPD) activities
  • Faculty engagement in research activities (publications, conferences, projects) and community service

Standard 6 — الموارد ومصادر التعلم والتسهيلات الداعمة (Resources and Learning Facilities | 4 indicators)
  • Sufficient, diversified financial resources proportional to program activities and student numbers
  • Adequate physical spaces (classrooms, labs, workshops, clinics) per NAQAAE reference specifications
  • Safety, health, and occupational safety requirements fully met; emergency procedures activated
  • Adequate digital/technological infrastructure (LMS, servers, licensed software, virtual labs)

Standard 7 — ضمان الجودة وتقييم البرنامج (Quality Assurance and Program Evaluation | 5 indicators)
  • Periodic student AND faculty satisfaction surveys → analysis → documented improvement actions
  • Periodic graduate AND employer feedback on program relevance to labour market → used in updates
  • Periodic course reports: syllabus compliance, exam-result analysis, student-feedback analysis, action plan
  • Annual program report: self-evaluation, attainment measurement, improvement plan with stakeholder input
  • Follow-up on enhancement actions: discuss outcomes in governing bodies, measure corrective-action uptake

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NILE UNIVERSITY KPI WRITING RULES — follow these exactly
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

kpi_name — Arabic, mandatory opening word:
  عدد  → for countable items
    ✓ "عدد الدورات التدريبية التي حضرها أعضاء هيئة التدريس سنوياً"
    ✓ "عدد المقررات الموصَّفة والمعتمدة والمعلنة"
    ✓ "عدد استبيانات رأي الطلاب المحللة فصلياً"
  نسبة → for rates or percentages
    ✓ "نسبة أعضاء هيئة التدريس المنخرطين في برامج التنمية المهنية المستمرة"
    ✓ "نسبة المقررات التي تتضمن تقييماً تكوينياً"
    ✓ "نسبة الخريجين الذين تم التواصل معهم خلال السنة الأولى بعد التخرج"
  وجود → for binary (yes/no) existence items
    ✓ "وجود توصيف معتمد ومعلن لجميع مقررات البرنامج"
    ✓ "وجود خطة للتدريب الميداني موثقة ومعتمدة ومعلنة"
    ✓ "وجود نظام إرشاد أكاديمي مفعّل ومعلن لجميع الطلاب المقيدين"
  مدى → for qualitative extent assessments
    ✓ "مدى تغطية أساليب التقييم لجميع المخرجات التعليمية المستهدفة"

target_description — specific and quantified, in Arabic:
  ✓ "لا يقل عن 80% من أعضاء هيئة التدريس يحضرون دورة واحدة على الأقل سنوياً"
  ✓ "3 تقارير مقررات معتمدة على الأقل لكل مقرر سنوياً"
  ✓ "نعم — يوجد ومعتمد من مجلس البرنامج"
  ✓ "تغطية 100% من المقررات بأساليب تقييم متنوعة"
  ✗ NEVER write vague targets like "تحسين الجودة" or "رفع الكفاءة"

responsible_entity — internal university roles only, in Arabic:
  Use exactly: عميد الكلية / وكيل الكلية لمرحلة البكالوريوس / مدير البرنامج /
  وحدة ضمان الجودة / مجلس البرنامج / أعضاء هيئة التدريس /
  الهيئة المعاونة / لجنة الجودة
  ✗ NEVER reference NAQAAE, the Ministry, or any external body

timeframe — in Arabic:
  Choose: فصلي / سنوي / كل ثلاث سنوات / or a year range like 2025-2028

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCOPE CONSTRAINT — PLANNING PHASE ONLY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This agent drafts KPI TEXT AND TARGETS only.
Do NOT mention data sources, measurement tools, tracking systems, or
data collection methods. A separate data-fulfillment agent handles those.
""" + JSON_GUARDRAIL


# ══════════════════════════════════════════════════════════════════════════════
#  Generation Logic
# ══════════════════════════════════════════════════════════════════════════════

def _build_human_prompt(
    program_name: str,
    college_name: str,
    university_name: str,
    planning_horizon: str,
    kpis_per_standard: int,
) -> str:
    total = 7 * kpis_per_standard
    return f"""\
Generate exactly {kpis_per_standard} KPI(s) per standard for all 7 NAQAAE standards \
(total = {total} KPIs) for the following program:

  Program:          {program_name}
  College:          {college_name}
  University:       {university_name}
  Planning horizon: {planning_horizon}

Requirements:
1. Cover the breadth of each standard's indicators as described.
2. Every kpi_name must be in Arabic and begin with عدد / نسبة / وجود / مدى.
3. Every target_description must be specific and quantified in Arabic.
4. Every responsible_entity must be an internal university role in Arabic.
5. Every timeframe must be in Arabic (فصلي / سنوي / كل ثلاث سنوات / {planning_horizon}).
6. standard_id must be a string "1" through "7" — distribute KPIs evenly.

Return a KPIPlan with exactly {total} KPIs now.
"""


def _generate(
    program_name: str,
    college_name: str,
    university_name: str,
    planning_horizon: str,
    kpis_per_standard: int,
) -> KPIPlan:
    structured_llm = _get_llm().with_structured_output(KPIPlan)
    return structured_llm.invoke(
        [
            SystemMessage(content=_SYSTEM_PROMPT),
            HumanMessage(content=_build_human_prompt(
                program_name, college_name, university_name,
                planning_horizon, kpis_per_standard,
            )),
        ]
    )


# ══════════════════════════════════════════════════════════════════════════════
#  Public Entry Point
# ══════════════════════════════════════════════════════════════════════════════

def compile_and_run(
    program_name: str = "علوم الحاسب",
    college_name: str = "كلية تكنولوجيا المعلومات وعلوم الحاسب",
    university_name: str = "جامعة النيل الأهلية",
    planning_horizon: str = "2025-2028",
    kpis_per_standard: int = 3,
) -> dict:
    """
    Generate a NAQAAE-aligned KPI plan (planning phase only — no data sources).

    Args:
        program_name:       Arabic name of the academic program.
        college_name:       Arabic name of the college/faculty.
        university_name:    Arabic name of the university.
        planning_horizon:   Year range string, e.g. "2025-2028".
        kpis_per_standard:  How many KPIs to generate per NAQAAE standard (1–7).

    Returns:
        {
            "kpis": [
                {
                    "standard_id":        str,   # "1" – "7"
                    "kpi_name":           str,   # Arabic, starts with عدد/نسبة/وجود/مدى
                    "target_description": str,   # specific, quantified, Arabic
                    "responsible_entity": str,   # internal NU role, Arabic
                    "timeframe":          str,   # Arabic timeframe
                },
                ...
            ],
            "metadata": {
                "program":            str,
                "college":            str,
                "university":         str,
                "planning_horizon":   str,
                "kpis_per_standard":  int,
                "total_kpis":         int,
                "standards_covered":  list[str],
            }
        }
    """
    plan: KPIPlan = _generate(
        program_name, college_name, university_name,
        planning_horizon, kpis_per_standard,
    )

    if plan is None or not plan.kpis:
        return {"kpis": [], "error": "LLM returned no output."}

    kpis = [
        {
            "standard_id":        item.standard_id,
            "kpi_name":           item.kpi_name,
            "target_description": item.target_description,
            "responsible_entity": item.responsible_entity,
            "timeframe":          item.timeframe,
        }
        for item in plan.kpis
    ]

    try:
        envelope = build_envelope(
            agent_id="kpi_generation",
            swot_items=[],
            structured_data={
                "kpis":             kpis,
                "program_name":     program_name,
                "college_name":     college_name,
                "university_name":  university_name,
                "planning_horizon": planning_horizon,
            },
        )
        save_envelope(envelope)
    except Exception as e:
        print(f"[kpi_generation] envelope save failed: {e}")

    standards_covered = sorted(set(k["standard_id"] for k in kpis))

    return {
        "kpis": kpis,
        "metadata": {
            "program":           program_name,
            "college":           college_name,
            "university":        university_name,
            "planning_horizon":  planning_horizon,
            "kpis_per_standard": kpis_per_standard,
            "total_kpis":        len(kpis),
            "standards_covered": standards_covered,
        },
    }
