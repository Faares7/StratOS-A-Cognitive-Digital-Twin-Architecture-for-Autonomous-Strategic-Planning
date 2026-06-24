"""
StratOS — Survey Generation Agent
==================================
Audience-routed survey drafting with few-shot prompting and live SWOT context.

The agent automatically loads the most recent SWOT run from the database so
it always has up-to-date institutional context. The LLM then selects which
SWOT dimensions and individual items are relevant given the audience and the
designer's instructions — it does NOT mechanically cover all four categories.

Answer types match the frontend values exactly:
  scale-1-5 | strongly-agree-disagree | open-ended

Entry point:
    compile_and_run(state_snapshot, user_request) -> dict
"""

from __future__ import annotations

import json
import os
import random
from pathlib import Path

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from core.llm import JSON_GUARDRAIL, local_brain
from core.persistence import build_envelope, save_envelope

load_dotenv()
_DB_DSN          = os.getenv("DB_CONNECTION_STRING", "")
_TEMPLATES_PATH  = Path(__file__).resolve().parents[2] / "Data" / "survey_templates.json"

# ── Pydantic output schemas ───────────────────────────────────────────────────

class SurveyQuestion(BaseModel):
    """A single survey question with its answer format and institutional pillar tag."""

    text: str = Field(
        description=(
            "The question text. Must be extremely concise (<=15 words), "
            "use simple everyday vocabulary, and be unambiguous."
        )
    )
    answer_type: str = Field(
        description=(
            "The response format. Must be exactly one of: "
            "scale-1-5 (for 1-to-5 ratings), "
            "strongly-agree-disagree (for agree/disagree or multiple-choice), "
            "open-ended (for a short free-text answer — use at most once per survey)."
        )
    )
    pillar: str = Field(
        description=(
            "The NAQAAE accreditation pillar this question primarily addresses. "
            "Use exactly one of: "
            "P1 (Program Mission and Management), "
            "P2 (Program Design), "
            "P3 (Teaching, Learning and Assessment), "
            "P4 (Students and Graduates), "
            "P5 (Faculty and Teaching Assistants), "
            "P6 (Resources and Learning Facilities), "
            "P7 (Quality Assurance and Program Evaluation). "
            "When the question is based on a SWOT item that carries a pillar tag, "
            "use that same pillar. If none fits clearly, use P7."
        )
    )


class SurveyDraft(BaseModel):
    """The complete AI-generated survey draft."""

    questions: list[SurveyQuestion] = Field(
        description="Ordered list of survey questions."
    )


SurveyDraft.model_rebuild()

# ── DB: load last-run SWOT items ──────────────────────────────────────────────

def _load_last_swot_items() -> list[dict]:
    """
    Return approved SWOT consolidation candidates ordered S → W → O → T,
    then by salience_score DESC within each type.
    Returns [] if the DB is not configured or no approved run exists.
    """
    if not _DB_DSN:
        return []
    try:
        conn = psycopg2.connect(_DB_DSN)
        with conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("""
                    SELECT type, title, description,
                           pillar_id, pillar_name,
                           salience_score AS impact_level
                    FROM   swot_consolidation_candidates
                    WHERE  approved = true
                    ORDER BY
                        CASE type
                            WHEN 'strength'    THEN 1
                            WHEN 'weakness'    THEN 2
                            WHEN 'opportunity' THEN 3
                            WHEN 'threat'      THEN 4
                            ELSE 5
                        END,
                        salience_score DESC
                """)
                rows = cur.fetchall()
        conn.close()
        items = [dict(r) for r in rows]
        if not items:
            print("[survey] WARNING: no approved SWOT consolidation run found — "
                  "approve a consolidation run before generating surveys.")
        else:
            print(f"[survey] Loaded {len(items)} approved SWOT candidate(s).")
        return items
    except Exception as exc:
        print(f"[survey] SWOT load from DB failed: {exc}")
        return []

# ── Template-based few-shot sampling ─────────────────────────────────────────

def _load_templates() -> dict[str, list[str]]:
    try:
        with open(_TEMPLATES_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _build_few_shot_block(audience_key: str, n: int = 5) -> str:
    templates = _load_templates()
    questions  = templates.get(audience_key, [])
    if not questions:
        return ""
    sample = random.sample(questions, min(n, len(questions)))
    lines  = [f'Few-shot reference questions for "{audience_key}" audience:\n---']
    for q_text in sample:
        display = q_text.split("\n")[0]
        lines.append(f'Q: "{display}"')
    lines.append("---")
    return "\n".join(lines)

# ── SWOT formatting ───────────────────────────────────────────────────────────

def _fmt_swot_block(items: list[dict], swot_type: str, heading: str, guidance: str) -> str:
    """Format one SWOT dimension for the human prompt, including pillar + impact metadata."""
    typed = [it for it in items if it.get("type") == swot_type]
    if not typed:
        return f"{heading}:\n  (none available)\n"

    lines = [f"{heading} — {guidance}:"]
    for it in typed:
        # pillar label
        if it.get("pillar_id") and it.get("pillar_name"):
            pillar_tag = f"P{it['pillar_id']} · {it['pillar_name']}"
        elif it.get("pillar_name"):
            pillar_tag = it["pillar_name"]
        else:
            pillar_tag = "pillar unclassified"

        impact = (f" | {it['impact_level'].upper()} impact"
                  if it.get("impact_level") else "")
        title  = f'  "{it["title"]}"' if it.get("title") else ""
        desc   = (it.get("description") or "").strip()
        # cap description so the prompt stays manageable
        if len(desc) > 220:
            desc = desc[:217] + "…"

        lines.append(f"  [{pillar_tag}{impact}]{title}")
        if desc:
            lines.append(f"    → {desc}")
    return "\n".join(lines)

# ── System prompt ─────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """\
You are an Institutional Survey Design Expert specialising in crafting \
questionnaires for higher-education stakeholders of any type — students, \
faculty, staff, administrators, employers, community partners, alumni, \
or any other audience specified by the survey designer.

────────────────────────────────────────────────────────────────
ANSWER TYPE RULES — use ONLY these three values exactly as written:
  scale-1-5               — 1-to-5 numeric rating (satisfaction, quality, frequency)
  strongly-agree-disagree — agree/disagree or multiple-choice selection
  open-ended              — short free-text answer (AT MOST ONCE per survey)

NAQAAE PILLAR CODES — tag every question with the single most relevant code:
  P1 — Program Mission and Management
  P2 — Program Design
  P3 — Teaching, Learning and Assessment
  P4 — Students and Graduates
  P5 — Faculty and Teaching Assistants
  P6 — Resources and Learning Facilities
  P7 — Quality Assurance and Program Evaluation

────────────────────────────────────────────────────────────────
SWOT SELECTION — use contextual judgment, NOT mechanical coverage:

You are provided with the institution's live SWOT items from the most recent
analysis. Each item is tagged with its institutional pillar (P1–P7) and an
impact level. Your task is to SELECT which dimensions and which specific items
are worth turning into survey questions for THIS audience and THIS request.

WHEN each dimension is most useful:

• Strengths (S) — validate and confirm what is working well.
  Best when: the audience is external (employers, alumni, community partners),
  or the designer explicitly wants to confirm perceived positives, or a
  comparison against weaknesses would add useful contrast.
  With students or faculty: use sparingly — only if you want them to explicitly
  rate something the institution believes is a strength.

• Weaknesses (W) — surface pain points and gaps for improvement.
  Best when: the audience directly experiences these issues (students, faculty,
  staff), the designer asks to probe problems or improvement areas, or the
  survey goal is internal process improvement.
  This is the HIGHEST-value dimension for most student and faculty surveys.

• Opportunities (O) — gauge awareness of and readiness to pursue growth areas.
  Best when: the audience can influence or respond to growth (faculty, senior
  students, employers), or the designer wants forward-looking, strategic questions.
  Less useful for audiences with no agency over institutional direction.

• Threats (T) — assess perception of risks and external pressures.
  Best when: the audience is exposed to external pressures (faculty, graduates,
  senior students, leadership), or the designer wants to measure how prepared
  stakeholders feel about challenges ahead.
  Avoid for first-year students or audiences unlikely to understand strategic risks.

SELECTION RULES:
1. You MAY omit a dimension entirely if it is not relevant to this audience or request.
2. From each dimension you DO include, choose only the 2–4 most relevant items.
3. Prefer HIGH-impact items when selecting.
4. When a SWOT item carries a pillar tag (P1–P7), assign that SAME pillar to
   the question you write for it — do not assign a different pillar arbitrarily.
5. If the designer's instructions emphasise one dimension (e.g. "focus on
   weaknesses", "highlight our strengths"), let that dimension dominate the
   question set. You may still include 1–2 questions from other dimensions for
   contrast, but do not balance them equally.
6. If the designer's instructions say to EXCLUDE a dimension (e.g. "skip
   opportunities"), omit it entirely.

────────────────────────────────────────────────────────────────
HARD RULES — follow without exception:
1. Write EXTREMELY concise questions (≤15 words each).
2. Use simple, everyday vocabulary suited to the target audience. Avoid jargon.
3. Never ask two things in one question (no "and/or" compound questions).
4. Limit open-ended questions to AT MOST one per survey.
5. Default to scale-1-5 for all subjective experience questions.
6. Honour ALL additional instructions from the survey designer exactly.
""" + JSON_GUARDRAIL

# ── Core generation function ──────────────────────────────────────────────────

def _generate(swot_items: list[dict], user_request: dict) -> SurveyDraft:
    audience: str     = user_request.get("audience", "All students")
    audience_key: str = user_request.get("audience_key", "")
    min_q: int        = int(user_request.get("min_questions", 5))
    max_q: int        = int(user_request.get("max_questions", 10))
    instructions: str = user_request.get("instructions", "").strip()

    structured_llm = local_brain.with_structured_output(SurveyDraft)

    few_shot_block   = _build_few_shot_block(audience_key) if audience_key else ""
    few_shot_section = (
        f"{few_shot_block}\n\n" if few_shot_block
        else "(No template examples available — rely on the instructions below.)\n\n"
    )

    strengths_block     = _fmt_swot_block(swot_items, "strength",    "STRENGTHS (S)",    "validate what is working well")
    weaknesses_block    = _fmt_swot_block(swot_items, "weakness",    "WEAKNESSES (W)",   "probe pain points and gaps")
    opportunities_block = _fmt_swot_block(swot_items, "opportunity", "OPPORTUNITIES (O)", "gauge readiness to grow")
    threats_block       = _fmt_swot_block(swot_items, "threat",      "THREATS (T)",      "assess risk perception")

    swot_note = (
        "No SWOT items are available. Generate relevant questions based solely "
        "on the audience and the designer's instructions."
        if not swot_items
        else (
            "Select the most relevant items for this audience and request. "
            "You do not need to cover every item or every dimension."
        )
    )

    human_prompt = (
        f"Target audience: {audience}\n\n"
        f"{few_shot_section}"
        f"── Institutional SWOT context ──\n"
        f"{swot_note}\n\n"
        f"{strengths_block}\n\n"
        f"{weaknesses_block}\n\n"
        f"{opportunities_block}\n\n"
        f"{threats_block}\n\n"
        f"── Designer instructions ──\n"
        f"{instructions or 'None — use your judgment based on the audience.'}\n\n"
        f"Generate the survey now. Return a SurveyDraft with {min_q}–{max_q} questions. "
        f"Use ONLY these answer_type values: scale-1-5, strongly-agree-disagree, open-ended."
    )

    return structured_llm.invoke(
        [
            SystemMessage(content=_SYSTEM_PROMPT),
            HumanMessage(content=human_prompt),
        ]
    )


# ── Public entry point ────────────────────────────────────────────────────────

def compile_and_run(
    state_snapshot: dict | None = None,
    user_request: dict | None = None,
) -> dict:
    """
    Generate a structured survey draft grounded in the latest SWOT analysis.

    SWOT items are loaded automatically from the database (most recent run).
    state_snapshot is accepted for backward compatibility but is no longer the
    primary source of SWOT data.

    Args:
        state_snapshot: Legacy dict — previously held current_strengths /
                        current_weaknesses etc. as plain string lists.
                        Ignored if the DB has live SWOT items.
        user_request:   Dict with keys: audience, audience_key, min_questions,
                        max_questions, instructions.

    Returns:
        {
          "questions": [{"text": str, "answer_type": str, "pillar": str}, ...],
          "error":     str | None
        }
    """
    req: dict  = user_request or {}
    snap: dict = state_snapshot or {}

    # ── Load live SWOT from DB; fall back to legacy state_snapshot ────────────
    swot_items: list[dict] = _load_last_swot_items()

    if not swot_items:
        # Legacy path: convert plain string lists into minimal item dicts
        print("[survey] No DB SWOT items — falling back to state_snapshot.")
        for swot_type, snap_key in [
            ("strength",    "current_strengths"),
            ("weakness",    "current_weaknesses"),
            ("opportunity", "current_opportunities"),
            ("threat",      "current_threats"),
        ]:
            for desc in snap.get(snap_key, []):
                swot_items.append({
                    "type":        swot_type,
                    "title":       None,
                    "description": desc,
                    "pillar_id":   None,
                    "pillar_name": None,
                    "impact_level": None,
                })

    draft: SurveyDraft = _generate(swot_items, req)

    if draft is None:
        return {"questions": [], "error": "LLM returned no output."}

    questions = [
        {"text": q.text, "answer_type": q.answer_type, "pillar": q.pillar}
        for q in draft.questions
    ]

    try:
        envelope = build_envelope(
            agent_id="survey",
            swot_items=[],
            structured_data={
                "questions":    questions,
                "swot_item_count": len(swot_items),
                "user_request": req,
            },
        )
        save_envelope(envelope)
    except Exception as e:
        print(f"[survey] unified envelope save failed: {e}")

    return {"questions": questions}
