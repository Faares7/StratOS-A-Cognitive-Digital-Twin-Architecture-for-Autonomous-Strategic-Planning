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
from core.persistence import build_envelope, save_envelope  # noqa: E402


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


# ── Graph node ────────────────────────────────────────────────────────────────

def _generate_suggestions(state: GapState) -> GapState:
    structured_llm = local_brain.with_structured_output(PillarSuggestions)
    results: List[PillarSuggestion] = []

    for p in state["pillars"]:
        try:
            response: PillarSuggestions = structured_llm.invoke([
                SystemMessage(content=_SYSTEM_PROMPT),
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


# ── Public entry point ────────────────────────────────────────────────────────

def compile_and_run(pillars: list[dict]) -> list[dict]:
    """
    Called by api/main.py via the dynamic module loader.

    Args:
        pillars: list of dicts with keys:
                 pillar, target_state, strengths, weaknesses,
                 opportunities (optional), threats (optional)

    Returns:
        list of dicts with keys:
          pillar, suggestions (list of {suggestion, reasoning, gap_identified})
    """
    builder: StateGraph = StateGraph(GapState)
    builder.add_node("generate_suggestions", _generate_suggestions)
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
        save_envelope(envelope)
    except Exception as e:
        print(f"[gap_analysis] unified envelope save failed: {e}")

    return suggestions
