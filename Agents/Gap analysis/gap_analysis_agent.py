"""
Agents/gap_analysis_agent.py — Human-in-the-Loop Gap Analysis LangGraph Agent

Single-node graph:
    START → generate_suggestions → END

For each of the 7 Strategic Pillars received in the state, the node calls the
shared local LLM (llama3.1:8b via core.llm) acting as a QA expert to produce
actionable improvement suggestions in professional English bullet points.
"""

import sys
from pathlib import Path
from typing import List, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph

# Ensure project root is on sys.path so `core.llm` is importable regardless
# of how this module is loaded by the API's dynamic module loader.
_ROOT = Path(__file__).parent.parent.resolve()
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

# CRITICAL: import the shared brain — never instantiate a new LLM here
from core.llm import local_brain  # noqa: E402


# ── State schema ─────────────────────────────────────────────────────────────

class PillarInput(TypedDict):
    pillar: str
    target_state: str
    strengths: str
    weaknesses: str


class PillarSuggestion(TypedDict):
    pillar: str
    suggestions: List[str]


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
    "CRITICAL OUTPUT RULES:\n"
    "- Output ONLY in professional English.\n"
    "- Respond ONLY with a bullet-point list using '•' as the prefix character.\n"
    "- Each bullet must be a specific, actionable recommendation — not a generic "
    "  observation or restatement of the problem.\n"
    "- Generate exactly 4 to 6 bullet points.\n"
    "- Do not include any headings, introductory sentences, or closing remarks."
)

_USER_TEMPLATE = (
    "Pillar: {pillar}\n\n"
    "Target State (NAQAAE Standard Requirement):\n{target_state}\n\n"
    "Current Strengths:\n{strengths}\n\n"
    "Current Weaknesses:\n{weaknesses}\n\n"
    "Analyze the gap between the current state and the target state. "
    "Produce 4–6 actionable improvement suggestions as English bullet points."
)


# ── Graph node ────────────────────────────────────────────────────────────────

def _generate_suggestions(state: GapState) -> GapState:
    results: List[PillarSuggestion] = []

    for p in state["pillars"]:
        response = local_brain.invoke([
            SystemMessage(content=_SYSTEM_PROMPT),
            HumanMessage(content=_USER_TEMPLATE.format(
                pillar=p["pillar"],
                target_state=p["target_state"],
                strengths=p["strengths"],
                weaknesses=p["weaknesses"],
            )),
        ])

        raw = response.content.strip()

        # Parse bullet points — accept •, -, or * prefixes
        bullets = [
            line.lstrip("•-* \t").strip()
            for line in raw.splitlines()
            if line.strip() and line.strip()[0] in ("•", "-", "*")
        ]

        # Fallback: if the model didn't use bullets, take non-empty lines
        if not bullets:
            bullets = [line.strip() for line in raw.splitlines() if line.strip()]

        results.append({"pillar": p["pillar"], "suggestions": bullets})

    return {**state, "suggestions": results}


# ── Public entry point ────────────────────────────────────────────────────────

def compile_and_run(pillars: list[dict]) -> list[dict]:
    """
    Called by api/main.py via the dynamic module loader.

    Args:
        pillars: list of dicts with keys: pillar, target_state, strengths, weaknesses

    Returns:
        list of dicts with keys: pillar, suggestions (list[str])
    """
    builder: StateGraph = StateGraph(GapState)
    builder.add_node("generate_suggestions", _generate_suggestions)
    builder.add_edge(START, "generate_suggestions")
    builder.add_edge("generate_suggestions", END)
    graph = builder.compile()

    final_state = graph.invoke({"pillars": pillars, "suggestions": []})
    return final_state["suggestions"]
