"""
Pillar categorizer for StratOS SWOT items.

Maps each strength/weakness statement to ONE of the 7 NAQAAE pillars using
the local Ollama brain (llama3.1:8b). Opportunities and threats are skipped
by design — only S/W get pillar tags.

The categorizer batches items into a single LLM call to amortise per-call
overhead. Items without a confident pillar fall back to pillar_id = None.
"""
from __future__ import annotations

from typing import List
from pydantic import BaseModel, Field
from langchain_core.messages import SystemMessage, HumanMessage

from core.llm import local_brain, JSON_GUARDRAIL
from .pillars import PILLARS, get_pillar, pillars_prompt_block


class _PillarAssignment(BaseModel):
    index: int = Field(description="Zero-based index of the input item")
    pillar_id: int = Field(description="The chosen NAQAAE pillar id (1-7)")
    reason: str = Field(description="One short sentence explaining the choice")


class _PillarAssignments(BaseModel):
    items: List[_PillarAssignment]


_SYSTEM_PROMPT = (
    "You are a NAQAAE accreditation categorizer. For each input statement "
    "(a strength or weakness about a university program), choose the ONE pillar "
    "from the list below that best fits the statement's intent.\n\n"
    "The 7 NAQAAE pillars:\n"
    f"{pillars_prompt_block()}\n\n"
    "Rules:\n"
    "- Pick exactly one pillar_id (1-7) per item.\n"
    "- Choose based on the dominant concept of the statement, not surface keywords.\n"
    "- If a statement could fit multiple pillars, pick the one whose indicators "
    "most directly cover the issue raised."
    + JSON_GUARDRAIL
)


def _build_user_message(items: list[dict]) -> str:
    lines = ["Categorize the following statements. Respond with one assignment per item.\n"]
    for i, item in enumerate(items):
        title = item.get("title") or ""
        desc = item.get("description") or ""
        text = f"{title} — {desc}" if title and title != desc else (desc or title)
        lines.append(f"[{i}] ({item['type']}) {text}")
    return "\n".join(lines)


def _is_sw(item: dict) -> bool:
    return item.get("type") in ("strength", "weakness")


def categorize_swot_items(items: list[dict]) -> list[dict]:
    """
    Mutates each S/W item in `items` by adding `pillar_id` and `pillar_name`.
    Opportunities and threats are left untouched (pillar_id stays None).
    Returns the same list for chaining.
    """
    sw_items = [it for it in items if _is_sw(it)]
    if not sw_items:
        return items

    structured_llm = local_brain.with_structured_output(_PillarAssignments)
    try:
        response: _PillarAssignments = structured_llm.invoke([
            SystemMessage(content=_SYSTEM_PROMPT),
            HumanMessage(content=_build_user_message(sw_items)),
        ])
    except Exception as e:
        print(f"[categorizer] LLM call failed: {e}. Leaving items uncategorized.")
        return items

    by_index = {a.index: a for a in response.items}
    for i, item in enumerate(sw_items):
        assignment = by_index.get(i)
        if not assignment:
            continue
        pillar = get_pillar(assignment.pillar_id)
        if not pillar:
            print(f"[categorizer] Invalid pillar_id {assignment.pillar_id} for item {i}; skipping.")
            continue
        item["pillar_id"] = pillar["pillar_id"]
        item["pillar_name"] = pillar["name"]

    return items


def categorize_one(item: dict) -> dict:
    """Convenience wrapper for a single item."""
    if not _is_sw(item):
        return item
    return categorize_swot_items([item])[0]
