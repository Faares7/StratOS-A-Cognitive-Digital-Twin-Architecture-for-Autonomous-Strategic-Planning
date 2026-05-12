"""
StratOS — Survey Generation Agent
==================================
Drafts a structured student survey from institutional weakness signals
and a caller-supplied user_request configuration dict.

Entry point:
    compile_and_run(state_snapshot, user_request) -> dict
"""

from __future__ import annotations

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from core.llm import JSON_GUARDRAIL, local_brain

# ── Pydantic output schemas ───────────────────────────────────────────────────

class SurveyQuestion(BaseModel):
    """A single survey question with its answer format."""

    text: str = Field(
        description=(
            "The question text. Must be extremely concise (<=15 words), "
            "use simple everyday vocabulary, and be unambiguous."
        )
    )
    answer_type: str = Field(
        description=(
            "The response format for this question. "
            "Must be one of: scale-1-5, strongly-agree-disagree, open-ended"
        )
    )


class SurveyDraft(BaseModel):
    """The complete AI-generated survey draft."""

    questions: list[SurveyQuestion] = Field(
        description="Ordered list of survey questions."
    )


SurveyDraft.model_rebuild()

# ── System prompt ─────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """\
You are a Student Engagement & Psychometrics Expert specialising in \
institutional survey design for higher-education settings.

HARD RULES - follow without exception:
1. The target audience is easily bored. Write EXTREMELY concise questions.
2. Use simple, everyday vocabulary. Avoid academic jargon.
3. Limit open-ended text questions to AT MOST one per survey.
4. Default heavily to 1-5 scale ratings for subjective experience questions.
5. Each question must be answerable in under 10 seconds.
6. Never ask two things in one question (no "and/or" compound questions).
7. Cover every institutional weakness you are given - do not skip any.
8. Honour ALL additional instructions from the survey designer exactly.

AUDIENCE ADAPTATION - adjust tone, vocabulary, and topic focus based on who
will fill in the survey:
- UNDERGRADUATES: Focus on teaching quality, campus facilities, assignment
  feedback speed, lab access, and peer support. Use casual, friendly language.
  Do NOT reference research supervision or publishing.
- POSTGRADUATES / MASTERS / PHD: Focus on research supervision quality,
  thesis support, access to journals and lab equipment, career readiness,
  and collaboration opportunities. Use precise, professional language.
- MIXED or CUSTOM audiences: Balance simplicity with professionalism and
  cover both academic quality and support services.\
""" + JSON_GUARDRAIL

# ── Core generation function ──────────────────────────────────────────────────

def _generate(weaknesses: list[str], user_request: dict) -> SurveyDraft:
    audience: str     = user_request.get("audience", "All students")
    min_q: int        = int(user_request.get("min_questions", 5))
    max_q: int        = int(user_request.get("max_questions", 10))
    instructions: str = user_request.get("instructions", "").strip()

    structured_llm = local_brain.with_structured_output(SurveyDraft)

    weakness_block = (
        "\n".join(f"  - {w}" for w in weaknesses)
        if weaknesses
        else "  (No specific weaknesses supplied - draft general quality questions.)"
    )
    instruction_block = instructions if instructions else "None."

    human_prompt = f"""\
Target audience: {audience}

Required question count: between {min_q} and {max_q} questions.

Institutional weaknesses to address (cover ALL of them):
{weakness_block}

Additional instructions from the survey designer:
{instruction_block}

Generate the survey now. Return a SurveyDraft with {min_q}-{max_q} questions, \
choosing the most appropriate answer_type for each.
"""

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
    Generate a structured survey draft.

    Args:
        state_snapshot: Dict optionally containing "current_weaknesses" (list[str]).
        user_request:   Dict with audience, min_questions, max_questions,
                        and instructions keys (all optional with sensible defaults).

    Returns:
        {
          "questions": [{"text": str, "answer_type": str}, ...],
          "error":     str | None
        }
    """
    req: dict        = user_request or {}
    weaknesses: list[str] = (state_snapshot or {}).get("current_weaknesses", [])

    draft: SurveyDraft = _generate(weaknesses, req)

    if draft is None:
        return {"questions": [], "error": "LLM returned no output."}

    return {
        "questions": [
            {"text": q.text, "answer_type": q.answer_type}
            for q in draft.questions
        ]
    }
