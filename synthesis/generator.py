"""
Plan synthesis generator.

Calls Gemini per subchapter to produce blocks + provenance, then assembles
a complete PlanDocument. Falls back to deterministic synthesis on any failure
so the pipeline always completes regardless of model behaviour.

Usage:
    from synthesis.generator import generate_plan_document
    doc = generate_plan_document(org_id="...", language="en", ...)
    # doc is a camelCase dict ready for JSON storage / the TypeScript template
"""
from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from synthesis.mock_inputs import get_insight_cards, get_reference_outline
from synthesis.schema import (
    AgentProvenance,
    Block,
    Chapter,
    GenList,
    GenParagraph,
    GenSubchapter,
    GenTable,
    HumanProvenance,
    ImageBlock,
    ListBlock,
    MixedProvenance,
    ParagraphBlock,
    PlanDocument,
    PlanMeta,
    Provenance,
    ReferencePlanProvenance,
    Subchapter,
    TableBlock,
    text_to_prosemirror,
)

# ── JSON guardrail (mirrors core/llm.py pattern) ──────────────────────────────
_JSON_GUARDRAIL = (
    "\nRespond ONLY with valid JSON matching the exact schema provided. "
    "Do not include markdown fences, code blocks, or any introductory text."
)

_NOW = lambda: datetime.now(timezone.utc).isoformat()


# ── Gemini client (lazy init) ─────────────────────────────────────────────────

_llm: Any = None


def _get_llm() -> Any:
    global _llm
    if _llm is not None:
        return _llm
    api_key = os.getenv("CE_GEMINI_API_KEY", "")
    if not api_key:
        return None
    try:
        from langchain_google_genai import ChatGoogleGenerativeAI
        _llm = ChatGoogleGenerativeAI(
            model="gemini-2.0-flash",
            google_api_key=api_key,
            temperature=0.4,
        )
        return _llm
    except Exception as exc:
        print(f"[synthesis] Gemini init error: {exc}")
        return None


# ── JSON extraction ───────────────────────────────────────────────────────────

def _extract_json(text: str) -> dict:
    text = re.sub(r"^```(?:json)?\s*", "", text.strip(), flags=re.MULTILINE)
    text = re.sub(r"\s*```$", "", text.strip(), flags=re.MULTILINE)
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        return json.loads(match.group())
    raise ValueError("No valid JSON found in response")


# ── Provenance resolution ─────────────────────────────────────────────────────

def _build_lookups(
    insight_cards: list[dict],
    reference_outline: list[dict],
) -> tuple[dict[str, dict], dict[str, dict]]:
    """Return (insight_lookup by id, ref_lookup by canonical_key)."""
    insight_lookup = {c["id"]: c for c in insight_cards}
    ref_lookup: dict[str, dict] = {}
    for ch in reference_outline:
        for sub in ch.get("subchapters", []):
            ck = sub.get("canonical_key")
            if ck and sub.get("reference_meta"):
                ref_lookup[ck] = sub["reference_meta"]
    return insight_lookup, ref_lookup


def _resolve_provenance(
    source_ids: list[str],
    insight_lookup: dict[str, dict],
    ref_lookup: dict[str, dict],
    fallback_canonical_key: str | None,
) -> Provenance:
    resolved: list[Provenance] = []

    for sid in source_ids:
        if sid in insight_lookup:
            card = insight_lookup[sid]
            resolved.append(
                AgentProvenance(
                    kind="agent_signal",
                    agent=card["agent"],
                    category=card.get("category"),
                    source=card["source"],
                    finding=card["finding"],
                    insight_id=card["id"],
                    pillar_tag=card.get("pillar_tag"),
                    confidence=card.get("confidence"),
                    evidence=card.get("evidence", {}),
                )
            )
        elif sid in ref_lookup:
            meta = ref_lookup[sid]
            resolved.append(
                ReferencePlanProvenance(
                    kind="reference_plan",
                    plan_id=meta.get("plan_id", "unknown"),
                    plan_title=meta.get("plan_title", "Previous Plan"),
                    canonical_key=sid,
                    section_heading=meta.get("section_heading", ""),
                    page=meta.get("page"),
                )
            )

    if not resolved:
        # Fall back to reference_plan provenance for the subchapter's own key
        if fallback_canonical_key and fallback_canonical_key in ref_lookup:
            meta = ref_lookup[fallback_canonical_key]
            return ReferencePlanProvenance(
                kind="reference_plan",
                plan_id=meta.get("plan_id", "unknown"),
                plan_title=meta.get("plan_title", "Previous Plan"),
                canonical_key=fallback_canonical_key,
                section_heading=meta.get("section_heading", ""),
                page=meta.get("page"),
            )
        return HumanProvenance(kind="human", edited_at=_NOW())

    if len(resolved) == 1:
        return resolved[0]

    return MixedProvenance(kind="mixed", sources=resolved)


# ── GenBlock → Block conversion ───────────────────────────────────────────────

def _gen_block_to_block(
    gen: dict,
    block_id: str,
    provenance: Provenance,
) -> Block:
    btype = gen.get("type", "paragraph")

    if btype == "paragraph":
        return ParagraphBlock(
            id=block_id,
            type="paragraph",
            content=text_to_prosemirror(gen.get("text", "")),
            provenance=provenance,
        )

    if btype == "list":
        return ListBlock(
            id=block_id,
            type="list",
            ordered=gen.get("ordered", False),
            items=[text_to_prosemirror(str(item)) for item in gen.get("items", [])],
            provenance=provenance,
        )

    if btype == "table":
        rows = gen.get("rows", [])
        return TableBlock(
            id=block_id,
            type="table",
            header=gen.get("header"),
            rows=[[text_to_prosemirror(str(cell)) for cell in row] for row in rows],
            caption=gen.get("caption"),
            provenance=provenance,
        )

    # Fallback: treat as paragraph
    return ParagraphBlock(
        id=block_id,
        type="paragraph",
        content=text_to_prosemirror(str(gen)),
        provenance=provenance,
    )


# ── Gemini synthesis (per subchapter) ─────────────────────────────────────────

_SYSTEM_PROMPT = """\
You are a university strategic planning expert. Your task is to write one subchapter
of a formal institutional strategic plan. You will receive:
- The chapter and subchapter headings
- An excerpt from a previous strategic plan for this section (grounding context)
- A set of labelled InsightCards (SWOT signals from institutional data agents)
- The target language for the plan

Write the subchapter content as a JSON object with the following schema:
{
  "blocks": [
    {"type": "paragraph", "text": "...", "source_ids": ["id1"]},
    {"type": "list", "ordered": false, "items": ["item1", "item2"], "source_ids": ["id2", "id3"]},
    {"type": "table", "header": ["Col1","Col2"], "rows":[["val","val"]], "caption":"...", "source_ids": []}
  ]
}

Rules:
- Return 2–4 blocks per subchapter.
- For each block, include source_ids: a list of InsightCard ids or the reference canonical_key you actually used.
- "paragraph" blocks carry text: the prose content.
- "list" blocks carry items: array of strings.
- "table" blocks are appropriate for KPIs, metrics, or structured comparisons.
- Write in formal academic prose appropriate for an institutional strategic plan.
- If language is "ar", write ALL content in Arabic.
- No markdown inside string values. No explanations outside the JSON.
""" + _JSON_GUARDRAIL


def _call_gemini(
    chapter_title: str,
    subchapter_heading: str,
    reference_excerpt: str,
    insight_cards: list[dict],
    language: str,
) -> dict:
    llm = _get_llm()
    if llm is None:
        raise RuntimeError("Gemini client not available")

    from langchain_core.messages import HumanMessage, SystemMessage

    cards_text = "\n".join(
        f"  [{c['id']}] ({c['agent']} / {c['category']}) {c['finding']} "
        f"[confidence: {c.get('confidence', '?')}%]"
        for c in insight_cards
    )
    user_prompt = (
        f"Chapter: {chapter_title}\n"
        f"Subchapter: {subchapter_heading}\n"
        f"Language: {language}\n\n"
        f"Reference excerpt from the previous plan:\n{reference_excerpt}\n\n"
        f"InsightCards (label each source_id you use):\n{cards_text}\n\n"
        "Write the subchapter blocks JSON now."
    )

    response = llm.invoke([
        SystemMessage(content=_SYSTEM_PROMPT),
        HumanMessage(content=user_prompt),
    ])
    return _extract_json(str(response.content))


# ── Deterministic fallback ────────────────────────────────────────────────────

def _fallback_subchapter(
    subchapter: dict,
    chapter_title: str,
    insight_cards: list[dict],
) -> dict:
    """Build subchapter blocks from reference_excerpt + 2-3 insight findings."""
    blocks: list[dict] = []
    excerpt = subchapter.get("reference_excerpt", "")
    canonical_key = subchapter.get("canonical_key", "")

    if excerpt:
        blocks.append({
            "type": "paragraph",
            "text": excerpt,
            "source_ids": [canonical_key] if canonical_key else [],
        })

    relevant = insight_cards[:3]
    if relevant:
        blocks.append({
            "type": "list",
            "ordered": False,
            "items": [c["finding"] for c in relevant],
            "source_ids": [c["id"] for c in relevant],
        })

    if not blocks:
        blocks.append({
            "type": "paragraph",
            "text": f"This section covers {subchapter.get('heading', chapter_title)}.",
            "source_ids": [],
        })

    return {"blocks": blocks}


# ── Subchapter assembly ───────────────────────────────────────────────────────

def _synthesise_subchapter(
    chapter: dict,
    subchapter: dict,
    insight_cards: list[dict],
    insight_lookup: dict[str, dict],
    ref_lookup: dict[str, dict],
    language: str,
    chapter_idx: int,
    sub_idx: int,
) -> Subchapter:
    canonical_key = subchapter.get("canonical_key")

    # Try Gemini, fall back to deterministic on any failure
    raw: dict | None = None
    try:
        raw = _call_gemini(
            chapter_title=chapter["title"],
            subchapter_heading=subchapter["heading"],
            reference_excerpt=subchapter.get("reference_excerpt", ""),
            insight_cards=insight_cards,
            language=language,
        )
        # Validate shape
        GenSubchapter.model_validate(raw)
    except Exception as exc:
        print(f"[synthesis] Gemini failed for {canonical_key!r}: {exc} — using fallback")
        raw = None

    if raw is None:
        try:
            raw = _call_gemini(  # one retry
                chapter_title=chapter["title"],
                subchapter_heading=subchapter["heading"],
                reference_excerpt=subchapter.get("reference_excerpt", ""),
                insight_cards=insight_cards,
                language=language,
            )
            GenSubchapter.model_validate(raw)
        except Exception:
            raw = _fallback_subchapter(subchapter, chapter["title"], insight_cards)

    blocks: list[Block] = []
    for b_idx, gen_block in enumerate(raw.get("blocks", [])):
        block_id = f"b-{chapter_idx + 1}-{sub_idx + 1}-{b_idx + 1}"
        source_ids: list[str] = gen_block.get("source_ids", [])
        prov = _resolve_provenance(source_ids, insight_lookup, ref_lookup, canonical_key)
        blocks.append(_gen_block_to_block(gen_block, block_id, prov))

    return Subchapter(
        id=f"s-{chapter_idx + 1}-{sub_idx + 1}",
        canonical_key=canonical_key,
        heading=subchapter["heading"],
        order=sub_idx,
        status="auto",
        generation="complete",
        user_added=False,
        blocks=blocks,
    )


# ── Top-level entry point ─────────────────────────────────────────────────────

def generate_plan_document(
    org_id: str,
    language: str = "en",
    title: str = "Strategic Plan 2025–2030",
    org_name: str = "Nile University",
    period_label: str = "2025–2030",
    org_logo_url: str | None = None,
    partner_logo_urls: list[str] | None = None,
) -> dict[str, Any]:
    """
    Generate a complete PlanDocument from mock inputs using Gemini.
    Returns a camelCase dict ready for JSONB storage and TypeScript rendering.
    Falls back deterministically if Gemini is unavailable.
    """
    plan_id = str(uuid.uuid4())
    now = _NOW()
    reference_outline = get_reference_outline(org_id)
    insight_cards = get_insight_cards(org_id)
    insight_lookup, ref_lookup = _build_lookups(insight_cards, reference_outline)

    print(f"[synthesis] Starting generation — plan_id={plan_id}  lang={language}")

    chapters: list[Chapter] = []
    for ch_idx, ch_data in enumerate(reference_outline):
        print(f"[synthesis]   Chapter {ch_idx + 1}: {ch_data['title']}")
        subchapters: list[Subchapter] = []
        for sub_idx, sub_data in enumerate(ch_data.get("subchapters", [])):
            print(f"[synthesis]     Subchapter: {sub_data['heading']}")
            sub = _synthesise_subchapter(
                chapter=ch_data,
                subchapter=sub_data,
                insight_cards=insight_cards,
                insight_lookup=insight_lookup,
                ref_lookup=ref_lookup,
                language=language,
                chapter_idx=ch_idx,
                sub_idx=sub_idx,
            )
            subchapters.append(sub)

        chapters.append(
            Chapter(
                id=f"ch-{ch_idx + 1}",
                number=ch_idx + 1,
                title=ch_data["title"],
                canonical_key=ch_data.get("canonical_key"),
                sections=subchapters,
                user_added=False,
            )
        )

    doc = PlanDocument(
        id=plan_id,
        org_id=org_id,
        meta=PlanMeta(
            title=title,
            org_name=org_name,
            org_logo_url=org_logo_url or "/logos/nu-itcs.png",
            period_label=period_label,
            partner_logo_urls=partner_logo_urls or ["/logos/qau.png"],
        ),
        template_id="formal-gov",
        language=language,  # type: ignore[arg-type]
        dir="rtl" if language == "ar" else "ltr",
        chapters=chapters,
        doc_status="draft",
        created_at=now,
        updated_at=now,
    )

    print(f"[synthesis] Generation complete — {len(chapters)} chapters")
    return doc.to_frontend_dict()
