"""
Concept normalization (Fix 1).

Rewrites each raw SWOT statement into a short, style-neutral CONCEPT phrase so that
items describing the same underlying concern/asset become comparable regardless of who
wrote them:

  operational_audit  "The number of training courses decreased from 55 in 2020 to 30"  ┐
  sentiment_analysis "Heavy Workload: heavy workload"                                   ├─► comparable
  old plan (prose)   "Weak training plan for academic leadership"                       ┘

Downstream stages (dedup, corroboration, lifecycle) embed `concept_text`; the original
text is kept untouched as the display/canonical wording. This is what makes cross-agent
clustering — and therefore corroboration — actually fire, and what lets the old formal
plan match current metric-driven items.
"""

from __future__ import annotations

from pydantic import BaseModel, Field
from langchain_core.messages import HumanMessage, SystemMessage

from core.llm import JSON_GUARDRAIL, local_brain

from .config import NORMALIZE_BATCH


class _Concept(BaseModel):
    index: int = Field(description="Zero-based index of the input item")
    concept: str = Field(description="3–8 word style-neutral concept phrase")


class _Concepts(BaseModel):
    items: list[_Concept]


_SYSTEM = (
    "You normalize university SWOT statements into short, style-neutral CONCEPT phrases so "
    "that differently-worded statements about the SAME underlying concern or asset become "
    "comparable. For each input, output a 3-8 word phrase naming the concern/asset only.\n"
    "Rules:\n"
    "- NO numbers, metrics, dates, percentages, proper names, or emotional tone.\n"
    "- Keep the SUBJECT specific (e.g. 'faculty training', 'laboratory capacity', "
    "'tuition affordability'). Do NOT collapse different subjects into a vague phrase.\n"
    "- Preserve polarity and subject so a strength and its matching weakness share the same "
    "subject (e.g. 'sufficient faculty training' vs 'insufficient faculty training').\n"
    "Examples:\n"
    "  'The number of training courses held annually decreased from 55 to 30' -> 'declining faculty training provision'\n"
    "  'Heavy Workload: heavy workload' -> 'excessive faculty workload'\n"
    "  'Labs are state-of-the-art but often crowded' -> 'crowded laboratory capacity'\n"
    "  'Weak training plan for academic leadership' -> 'insufficient leadership training'"
    + JSON_GUARDRAIL
)


def _raw_text(it: dict) -> str:
    title = (it.get("title") or "").strip()
    desc = (it.get("description") or "").strip()
    return f"{title} — {desc}" if title and title != desc else (desc or title)


def normalize_items(items: list[dict]) -> list[dict]:
    """Add `concept_text` to each item in place (batched LLM calls). On any batch
    failure the items in that batch fall back to their raw text, so the pipeline never
    breaks on a normalization error."""
    if not items:
        return items

    structured = local_brain.with_structured_output(_Concepts)
    for start in range(0, len(items), NORMALIZE_BATCH):
        batch = items[start:start + NORMALIZE_BATCH]
        human = "\n".join(f"[{i}] ({it.get('type')}) {_raw_text(it)}" for i, it in enumerate(batch))
        try:
            out: _Concepts = structured.invoke(
                [SystemMessage(content=_SYSTEM), HumanMessage(content=human)]
            )
            by_idx = {c.index: c.concept for c in out.items}
        except Exception as exc:
            print(f"[swot-consolidation] normalize batch {start}: failed ({exc}); using raw text.")
            by_idx = {}
        for i, it in enumerate(batch):
            it["concept_text"] = (by_idx.get(i) or "").strip() or _raw_text(it)

    print(f"[swot-consolidation] normalized {len(items)} items to concept phrases.")
    return items
