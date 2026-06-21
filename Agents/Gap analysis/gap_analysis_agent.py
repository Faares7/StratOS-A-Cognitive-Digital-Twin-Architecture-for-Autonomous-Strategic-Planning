"""
Agents/gap_analysis_agent.py — Human-in-the-Loop Gap Analysis LangGraph Agent

Single-node graph:
    START → generate_suggestions → END

For each of the 7 Strategic Pillars received in the state, the node calls the
shared local LLM (llama3.1:8b via core.llm) acting as a QA expert to produce
structured improvement suggestions with explicit reasoning per suggestion.
"""

import sys
from pathlib import Path
from typing import List, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field

# Ensure project root is on sys.path so `core.llm` is importable regardless
# of how this module is loaded by the API's dynamic module loader.
_ROOT = Path(__file__).parent.parent.resolve()
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from core.llm import local_brain, JSON_GUARDRAIL  # noqa: E402
from core.persistence import build_envelope, save_envelope, save_gap_analysis_items  # noqa: E402


# ── Structured output schema ──────────────────────────────────────────────────

class Suggestion(BaseModel):
    suggestion: str = Field(
        description="The specific, actionable improvement recommendation."
    )
    reasoning: str = Field(
        description=(
            "Why this gap exists. Must cite specific evidence from the "
            "provided strengths, weaknesses, opportunities, or threats."
        )
    )
    gap_identified: str = Field(
        description="The specific shortfall being addressed, in one concise sentence."
    )


class PillarSuggestions(BaseModel):
    items: List[Suggestion] = Field(
        description="Exactly 4 to 6 improvement suggestions for this pillar."
    )


# ── State schema ──────────────────────────────────────────────────────────────

class PillarInput(TypedDict):
    pillar: str
    target_state: str
    strengths: str
    weaknesses: str
    opportunities: str
    threats: str


class PillarSuggestion(TypedDict):
    pillar: str
    suggestions: List[dict]   # each dict is a Suggestion.model_dump()


class GapState(TypedDict):
    pillars: List[PillarInput]
    suggestions: List[PillarSuggestion]


# ── Prompts ───────────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = (
    "You are a senior Quality Assurance expert specializing in higher education "
    "accreditation under the NAQAAE (National Authority for Quality Assurance and "
    "Accreditation of Education) framework.\n\n"
    "Your role is to analyze the gap between an institution's current state and its "
    "accreditation target state, then produce concrete, actionable improvement "
    "suggestions that a university leadership team can act on immediately.\n\n"
    "For each suggestion you MUST provide three fields:\n"
    "  • suggestion     — the specific, actionable recommendation\n"
    "  • reasoning      — why this gap exists, citing evidence from the input data\n"
    "  • gap_identified — the specific shortfall being addressed in one sentence\n\n"
    "ORDERING RULES — follow this priority strictly:\n"
    "1. WEAKNESS-FIRST: For every weakness listed, you MUST produce at least one "
    "suggestion that directly addresses it by name. Quote or closely paraphrase the "
    "weakness title in the gap_identified field so it is traceable. Do this before "
    "generating any compliance-only suggestions.\n"
    "2. COMPLIANCE GAPS: After all weaknesses are addressed, add suggestions for "
    "shortfalls between the current strengths and the NAQAAE target state that are "
    "not yet covered.\n"
    "3. If weaknesses alone already account for 6 suggestions, stop — do not exceed 6.\n"
    "4. If there are no weaknesses, generate 4–6 compliance-focused suggestions.\n\n"
    "QUALITY RULES:\n"
    "- Output ONLY in professional English.\n"
    "- Every suggestion must be specific and immediately actionable.\n"
    "- Reasoning must cite concrete evidence from the provided data — never fabricate.\n"
    "- Do not repeat the input text verbatim; interpret and synthesise it."
    + JSON_GUARDRAIL
)

_USER_TEMPLATE = (
    "Pillar: {pillar}\n\n"
    "Target State (NAQAAE Standard Requirement):\n{target_state}\n\n"
    "Current Strengths:\n{strengths}\n\n"
    "Current Weaknesses:\n{weaknesses}\n\n"
    "External Opportunities (signals relevant to this pillar):\n{opportunities}\n\n"
    "External Threats (risks relevant to this pillar):\n{threats}\n\n"
    "Analyze the gap between the current state and the target state. "
    "Produce 4–6 structured improvement suggestions, each with a suggestion, "
    "reasoning, and gap_identified field."
)

_NO_DATA = "None identified yet."


# ── Few-shot feedback injection ────────────────────────────────────────────────

def _few_shot_block(examples: list[dict]) -> str:
    """Build a few-shot section from previously approved user suggestions."""
    if not examples:
        return ""
    lines = [
        "\n\nPREVIOUSLY APPROVED SUGGESTIONS FOR THIS PILLAR "
        "(use as a quality and specificity reference — do not repeat them verbatim):"
    ]
    for i, ex in enumerate(examples[:3], 1):
        lines.extend([
            f"\n  [{i}] gap_identified: {ex['gap_identified']}",
            f"       suggestion:     {ex['suggestion']}",
            f"       reasoning:      {ex['reasoning']}",
        ])
    return "\n".join(lines)


# ── Single-suggestion prompts (for user-initiated HITL additions) ─────────────

_USER_SUGGESTION_SYSTEM = (
    "You are a senior Quality Assurance expert specializing in NAQAAE higher education "
    "accreditation. A university administrator has described an improvement they wish to "
    "make for a specific accreditation pillar. Your job is to formalize their intent into "
    "ONE structured, NAQAAE-grounded improvement suggestion.\n\n"
    "Requirements:\n"
    "- The suggestion must be specific and immediately actionable.\n"
    "- The reasoning must cite concrete evidence from the provided strengths/weaknesses "
    "and target state — never fabricate.\n"
    "- The gap_identified must identify the specific shortfall in one sentence, traceable "
    "to a weakness or compliance gap.\n"
    "- Stay within the scope of the named pillar and the administrator's stated intent."
    + JSON_GUARDRAIL
)

_USER_SUGGESTION_TEMPLATE = (
    "Pillar: {pillar}\n\n"
    "Target State (NAQAAE Standard Requirement):\n{target_state}\n\n"
    "Current Strengths:\n{strengths}\n\n"
    "Current Weaknesses:\n{weaknesses}\n\n"
    "Administrator's stated intent:\n\"{user_query}\"\n\n"
    "Formalize this into one structured improvement suggestion with "
    "suggestion, reasoning, and gap_identified fields."
)


# ── Graph node ────────────────────────────────────────────────────────────────

def _run_suggestions(state: GapState, feedback: dict[str, list[dict]]) -> GapState:
    structured_llm = local_brain.with_structured_output(PillarSuggestions)
    results: List[PillarSuggestion] = []

    for p in state["pillars"]:
        examples = feedback.get(p["pillar"], [])
        system = _SYSTEM_PROMPT + _few_shot_block(examples)
        try:
            response: PillarSuggestions = structured_llm.invoke([
                SystemMessage(content=system),
                HumanMessage(content=_USER_TEMPLATE.format(
                    pillar=p["pillar"],
                    target_state=p.get("target_state") or _NO_DATA,
                    strengths=p.get("strengths") or _NO_DATA,
                    weaknesses=p.get("weaknesses") or _NO_DATA,
                    opportunities=p.get("opportunities") or _NO_DATA,
                    threats=p.get("threats") or _NO_DATA,
                )),
            ])
            results.append({
                "pillar": p["pillar"],
                "suggestions": [item.model_dump() for item in response.items],
            })
        except Exception as e:
            print(f"[gap_analysis] LLM call failed for pillar '{p['pillar']}': {e}")
            results.append({"pillar": p["pillar"], "suggestions": []})

    return {**state, "suggestions": results}


# ── Public entry points ───────────────────────────────────────────────────────

def compile_and_run(pillars: list[dict], feedback: dict | None = None) -> list[dict]:
    """
    Called by api/main.py via the dynamic module loader.

    Args:
        pillars:  list of dicts with keys:
                  pillar, target_state, strengths, weaknesses,
                  opportunities (optional), threats (optional)
        feedback: optional dict mapping pillar_name → list of approved suggestion
                  dicts {suggestion, reasoning, gap_identified}.
                  Injected as few-shot examples into the system prompt per pillar.

    Returns:
        list of dicts: pillar, suggestions [{suggestion, reasoning, gap_identified}]
    """
    fb = feedback or {}

    def _node(state: GapState) -> GapState:
        return _run_suggestions(state, fb)

    builder: StateGraph = StateGraph(GapState)
    builder.add_node("generate_suggestions", _node)
    builder.add_edge(START, "generate_suggestions")
    builder.add_edge("generate_suggestions", END)
    graph = builder.compile()

    final_state = graph.invoke({"pillars": pillars, "suggestions": []})
    suggestions = final_state["suggestions"]

    try:
        envelope = build_envelope(
            agent_id="gap_analysis",
            swot_items=[],
            structured_data={
                "input_pillars": pillars,
                "suggestions":   suggestions,
            },
        )
        run_id = save_envelope(envelope)
        if run_id:
            save_gap_analysis_items(run_id, suggestions)
    except Exception as e:
        print(f"[gap_analysis] unified envelope save failed: {e}")

    return suggestions


def generate_user_suggestion(
    pillar_data: dict,
    user_query: str,
    feedback_examples: list[dict] | None = None,
) -> dict:
    """
    Generate a single structured suggestion from a user's natural-language query.
    Called by the API for the HITL add-suggestion flow.

    Args:
        pillar_data:       dict with pillar, target_state, strengths, weaknesses
        user_query:        the administrator's stated intent in natural language
        feedback_examples: previously approved suggestions for this pillar (few-shot)

    Returns:
        Suggestion as a dict {suggestion, reasoning, gap_identified}
    """
    system = _USER_SUGGESTION_SYSTEM + _few_shot_block(feedback_examples or [])
    structured_llm = local_brain.with_structured_output(Suggestion)
    response: Suggestion = structured_llm.invoke([
        SystemMessage(content=system),
        HumanMessage(content=_USER_SUGGESTION_TEMPLATE.format(
            pillar=pillar_data["pillar"],
            target_state=pillar_data.get("target_state") or _NO_DATA,
            strengths=pillar_data.get("strengths") or _NO_DATA,
            weaknesses=pillar_data.get("weaknesses") or _NO_DATA,
            user_query=user_query,
        )),
    ])
    return response.model_dump()
