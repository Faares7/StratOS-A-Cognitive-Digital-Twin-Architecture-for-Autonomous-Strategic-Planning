"""
Stage 2 — writer → critic → revise loop for the Chief Editor.

Writer / reviser: Gemini 2.5 Pro via Vertex AI (ChatVertexAI).
  Default model:  gemini-2.5-pro    (env CE_WRITER_MODEL)
  Default region: us-central1       (env CE_WRITER_REGION)
  Thinking budget: 1024 tokens (falls back to no-thinking if param rejected).

  Upgrade path: once Claude on Vertex Model Garden access is granted, set
    CE_WRITER_MODEL=claude-opus-4-8
    CE_WRITER_REGION=us-east5
  and install langchain-anthropic.  No other code changes needed.

Critic: Gemini 2.5 Pro via Vertex AI (ChatVertexAI), thinking on by default.
  Default model:  gemini-2.5-pro    (env CE_CRITIC_MODEL)
  Default region: us-central1       (env CE_CRITIC_REGION)

Loop per agent section (never runs on carryover sections):
  writer → critic → [reviser → critic] × MAX_REVISE_ROUNDS
  → parse to BlockModel list → deterministic_blocks fallback on any failure.

Cost / safety:
  • max_output_tokens capped per call.
  • Max 1 JSON-parse repair attempt per response.
  • Per-job token ceiling shared with llm.py (OverflowError → fallback).
  • Any client / parse error → accept best draft so far, then deterministic.
  • No autonomous loops: critic round count is bounded by MAX_REVISE_ROUNDS.
"""
from __future__ import annotations

import datetime
import json
import logging
import os
import re
import uuid
from typing import TYPE_CHECKING, Any, Literal, Optional

from pydantic import BaseModel, ValidationError

from . import llm as _llm
from .prompts import (
    CRITIC_OUTPUT_SCHEMA,
    CRITIC_SYSTEM,
    REVISER_SYSTEM,
    SECTION_WRITER_CONTEXT,
    WRITER_SYSTEM,
    CriticVerdict,
)
from .provenance import agent_prov
from .schema import (
    BlockModel,
    ListBlockModel,
    ParagraphBlockModel,
    TableBlockModel,
    make_pm_doc,
    make_pm_text,
)

if TYPE_CHECKING:
    from .brief import Brief

logger = logging.getLogger(__name__)

MAX_REVISE_ROUNDS = 1
_FENCE_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.IGNORECASE)


class _SafeEncoder(json.JSONEncoder):
    """JSON encoder that handles datetime, UUID, and other non-serialisable DB types."""
    def default(self, obj: Any) -> Any:
        if isinstance(obj, (datetime.datetime, datetime.date)):
            return obj.isoformat()
        if hasattr(obj, "__str__"):
            return str(obj)
        return super().default(obj)


# ── Writer / reviser output spec (injected into human-turn prompts) ────────────

_WRITER_OUTPUT_SPEC = """\
OUTPUT FORMAT — return a single JSON object with this exact shape:

{
  "blocks": [
    {"type": "paragraph", "text": "<prose>"},
    {"type": "list",      "ordered": false, "items": ["<item>", "..."]},
    {"type": "table",     "header": ["Col1", "Col2"],
                          "rows":   [["cell", "cell"], ...],
                          "caption": "<optional caption or omit key>"}
  ]
}

Rules:
- Block types: paragraph | list | table only.  No other types.
- Do NOT include "id" or "provenance" — the pipeline adds those.
- Allowed inline marks inside text strings: **bold**, *italic*, [label](url).
  No colour, font size, or other HTML/CSS marks.
- No outer markdown, no preamble, no trailing commentary.  Strict JSON only.\
"""

_REVISER_OUTPUT_SPEC = """\
OUTPUT FORMAT — same JSON shape as the writer, plus an optional top-level key:

{
  "blocks": [ ... ],
  "revision_notes": [
    "0: fixed — replaced softened weakness with source phrasing",
    "1: unfixable — verbatim field; cannot alter per guardrails"
  ]
}

Strict JSON only.  No preamble or trailing text.\
"""


# ── Simplified block schema (writer / reviser I/O) ────────────────────────────

class _SimpleBlock(BaseModel):
    type:    Literal["paragraph", "list", "table"]
    text:    Optional[str]             = None   # paragraph
    ordered: bool                      = False  # list
    items:   Optional[list[str]]       = None   # list
    header:  Optional[list[str]]       = None   # table
    rows:    Optional[list[list[str]]] = None   # table
    caption: Optional[str]             = None   # table


class _WriterOutput(BaseModel):
    blocks:         list[_SimpleBlock]
    revision_notes: Optional[list[str]] = None


# ── Client factories ───────────────────────────────────────────────────────────

def _get_writer_client() -> tuple[Any, str]:
    """Return (client, label).  Gemini 2.5 Pro on Vertex AI.
    No max_output_tokens cap — let the model output fully to avoid JSON truncation."""
    from langchain_google_vertexai import ChatVertexAI  # noqa: PLC0415

    model   = os.getenv("CE_WRITER_MODEL",  "gemini-2.5-pro")
    region  = os.getenv("CE_WRITER_REGION", "us-central1")
    project = os.getenv("GOOGLE_CLOUD_PROJECT", "caregiver-tutoring-assistant")

    for kwargs in [
        {
            "model_name": model, "project": project, "location": region,
            "model_kwargs": {
                "generation_config": {"thinking_config": {"thinking_budget": 1024}}
            },
        },
        {
            "model_name": model, "project": project, "location": region,
        },
    ]:
        try:
            client = ChatVertexAI(**kwargs)
            logger.info("[refine] writer client ready: %s @ %s", model, region)
            return client, f"gemini:{model}"
        except Exception as exc:
            logger.debug("[refine] writer init variant failed: %s", exc)

    raise RuntimeError("[refine] Cannot initialise writer (ChatVertexAI)")


def _get_critic_client() -> Any:
    """Gemini 2.5 Pro on Vertex.  Thinking enabled, no output cap."""
    from langchain_google_vertexai import ChatVertexAI  # noqa: PLC0415

    model   = os.getenv("CE_CRITIC_MODEL",  "gemini-2.5-pro")
    region  = os.getenv("CE_CRITIC_REGION", "us-central1")
    project = os.getenv("GOOGLE_CLOUD_PROJECT", "caregiver-tutoring-assistant")

    for kwargs in [
        {
            "model_name": model, "project": project, "location": region,
            "model_kwargs": {
                "generation_config": {"thinking_config": {"thinking_budget": 1024}}
            },
        },
        {
            "model_name": model, "project": project, "location": region,
        },
    ]:
        try:
            return ChatVertexAI(**kwargs)
        except Exception as exc:
            logger.debug("[refine] ChatVertexAI init variant failed: %s", exc)

    raise RuntimeError("[refine] Cannot initialise critic (ChatVertexAI)")


# ── Single model call ──────────────────────────────────────────────────────────

def _call(
    client: Any,
    system: str,
    human:  str,
    job_id: str,
) -> Optional[str]:
    """System + human → text.  Ceiling check, max 1 retry on empty response."""
    from langchain_core.messages import HumanMessage, SystemMessage  # noqa: PLC0415

    try:
        _llm._bump_ceiling(job_id, _llm._word_count(system + human))
    except OverflowError as exc:
        logger.warning("[refine] %s", exc)
        return None

    for attempt in range(2):
        try:
            resp = client.invoke([
                SystemMessage(content=system),
                HumanMessage(content=human),
            ])

            # Claude thinking responses: content is a list of typed blocks.
            raw = getattr(resp, "content", None) or ""
            if isinstance(raw, list):
                text = " ".join(
                    block.get("text", "")
                    for block in raw
                    if isinstance(block, dict) and block.get("type") == "text"
                ).strip()
            else:
                text = str(raw).strip()

            if not text:
                logger.debug("[refine] attempt %d returned empty", attempt + 1)
                continue

            try:
                _llm._bump_ceiling(job_id, _llm._word_count(text))
            except OverflowError as exc:
                logger.warning("[refine] %s", exc)
                return None

            return text

        except OverflowError:
            return None
        except Exception as exc:
            logger.warning("[refine] call attempt %d failed: %s", attempt + 1, exc)

    return None


# ── JSON parsing helpers ───────────────────────────────────────────────────────

def _extract_json(text: str) -> str:
    """Strip markdown fences if present; return raw JSON string.
    Handles unclosed fences (truncated Gemini output) by extracting to end of text."""
    m = _FENCE_RE.search(text)
    if m:
        return m.group(1).strip()
    # Unclosed fence: extract everything after the opening marker
    m2 = re.search(r"```(?:json)?\s*([\s\S]+)", text, re.IGNORECASE)
    if m2:
        return m2.group(1).strip()
    return text.strip()


def _parse_writer_output(text: str) -> Optional[_WriterOutput]:
    """Parse writer / reviser JSON → _WriterOutput.  Max 1 repair attempt."""
    raw = _extract_json(text)
    for attempt in range(2):
        try:
            return _WriterOutput.model_validate_json(raw)
        except (ValueError, ValidationError) as exc:
            if attempt == 0:
                # Light repair: trailing commas, leading/trailing junk
                raw = re.sub(r",\s*([\]}])", r"\1", raw)
                logger.debug("[refine] writer JSON repair attempt")
            else:
                logger.warning("[refine] writer JSON parse failed after repair: %s", exc)
    return None


def _parse_critic_verdict(text: str) -> Optional[CriticVerdict]:
    """Parse critic JSON → CriticVerdict.  Max 1 repair attempt."""
    raw = _extract_json(text)
    for attempt in range(2):
        try:
            return CriticVerdict.model_validate_json(raw)
        except (ValueError, ValidationError) as exc:
            if attempt == 0:
                raw = re.sub(r",\s*([\]}])", r"\1", raw)
                logger.debug("[refine] critic JSON repair attempt")
            else:
                logger.warning("[refine] critic JSON parse failed after repair: %s", exc)
    return None


# ── Block conversion ───────────────────────────────────────────────────────────

def _uid() -> str:
    return uuid.uuid4().hex


def _blocks_from_writer(
    output: _WriterOutput,
    section_key: str,
    writer_label: str,
    source_sample: str,
) -> list[BlockModel]:
    """Convert _WriterOutput to BlockModel list.
    Stamps each block with "editorially phrased" provenance.
    Skips malformed blocks rather than raising."""
    prov = agent_prov(
        agent="chief_editor",
        finding=source_sample,
        source=f"{section_key}+{writer_label}",
        evidence={"editorRefined": True, "editoriallyPhrased": True},
    )

    blocks: list[BlockModel] = []
    for sb in output.blocks:
        bid = f"b-{_uid()}"
        try:
            if sb.type == "paragraph" and sb.text:
                blocks.append(ParagraphBlockModel(
                    id=bid, provenance=prov,
                    content=make_pm_doc(sb.text),
                ))
            elif sb.type == "list" and sb.items:
                blocks.append(ListBlockModel(
                    id=bid, provenance=prov,
                    ordered=sb.ordered,
                    items=[make_pm_text(item) for item in sb.items],
                ))
            elif sb.type == "table" and sb.rows is not None:
                blocks.append(TableBlockModel(
                    id=bid, provenance=prov,
                    header=sb.header,
                    rows=[[make_pm_text(cell) for cell in row] for row in sb.rows],
                    caption=sb.caption,
                ))
        except Exception as exc:
            logger.debug("[refine] block conversion skipped (%s): %s", sb.type, exc)

    return blocks


# ── Human-turn prompt builders ─────────────────────────────────────────────────

def _brief_text(brief: Optional["Brief"]) -> str:
    if brief is None:
        return "(institutional context unavailable)"
    try:
        return brief.render()
    except Exception:
        return str(brief)


def _ctx(section_key: str) -> tuple[str, str]:
    """Return (source_description, section_rule) from SECTION_WRITER_CONTEXT."""
    entry = SECTION_WRITER_CONTEXT.get(section_key, {})
    return (
        entry.get("source_description", "(no description)"),
        entry.get("section_rule", "(no section-specific rule)"),
    )


def _writer_human(
    section_key:   str,
    section_title: str,
    source_data:   dict,
    brief:         Optional["Brief"],
) -> str:
    src_desc, rule = _ctx(section_key)
    return (
        f"SECTION: {section_title} (key: {section_key})\n\n"
        f"BRIEF (institutional context):\n{_brief_text(brief)}\n\n"
        f"SOURCE DESCRIPTION:\n{src_desc}\n\n"
        f"SOURCE DATA:\n{json.dumps(source_data, cls=_SafeEncoder, ensure_ascii=False, indent=2)}\n\n"
        f"SECTION-SPECIFIC RULE:\n{rule}\n\n"
        f"{_WRITER_OUTPUT_SPEC}"
    )


def _critic_human(
    section_key:   str,
    section_title: str,
    source_data:   dict,
    draft_json:    str,
) -> str:
    src_desc, _ = _ctx(section_key)
    return (
        f"SECTION: {section_title} (key: {section_key})\n\n"
        f"SOURCE DESCRIPTION:\n{src_desc}\n\n"
        f"SOURCE DATA:\n{json.dumps(source_data, cls=_SafeEncoder, ensure_ascii=False, indent=2)}\n\n"
        f"DRAFT:\n{draft_json}\n\n"
        f"CRITIC OUTPUT SCHEMA (your response must match this shape exactly):\n"
        f"{CRITIC_OUTPUT_SCHEMA}\n\n"
        f"Return only the JSON verdict.  No preamble."
    )


def _reviser_human(
    section_key:   str,
    section_title: str,
    source_data:   dict,
    draft_json:    str,
    verdict_json:  str,
) -> str:
    src_desc, rule = _ctx(section_key)
    return (
        f"SECTION: {section_title} (key: {section_key})\n\n"
        f"SOURCE DESCRIPTION:\n{src_desc}\n\n"
        f"SOURCE DATA:\n{json.dumps(source_data, cls=_SafeEncoder, ensure_ascii=False, indent=2)}\n\n"
        f"CURRENT DRAFT:\n{draft_json}\n\n"
        f"CRITIC REPORT:\n{verdict_json}\n\n"
        f"SECTION-SPECIFIC RULE (obey while fixing):\n{rule}\n\n"
        f"{_REVISER_OUTPUT_SPEC}"
    )


# ── Main entry point ───────────────────────────────────────────────────────────

def refine_section(
    section_key:          str,
    section_title:        str,
    source_data:          dict,
    deterministic_blocks: list[BlockModel],
    brief:                Optional["Brief"] = None,
    job_id:               str              = "",
    max_revise_rounds:    int              = MAX_REVISE_ROUNDS,
) -> list[BlockModel]:
    """
    Run the writer→critic→revise loop for one agent-sourced section.

    Returns polished BlockModel list on success, or deterministic_blocks on
    any failure.  Never raises.

    Args:
        section_key:          skeleton key, e.g. "swot_analysis"
        section_title:        display heading, e.g. "SWOT Analysis"
        source_data:          serialisable dict of raw source for this section.
                              Expected keys per section:
                                swot_analysis:      {swot_items, sw_condensed?, ot_condensed?}
                                gap_analysis:       {gap_items, input_pillars, sw_condensed?}
                                strategic_goals:    {goals, objectives}
                                implementation_plan:{actions, goals, objectives}
        deterministic_blocks: output of the deterministic builder (the fallback)
        brief:                Brief object for institutional grounding
        job_id:               for shared per-job token ceiling
        max_revise_rounds:    critic→revise iterations allowed (default 1)
        max_tokens_writer:    max output tokens for writer and reviser calls
        max_tokens_critic:    max output tokens for critic call
    """
    # ── Initialise clients ─────────────────────────────────────────────────────
    try:
        writer_client, writer_label = _get_writer_client()
    except Exception as exc:
        logger.warning("[refine] writer client init failed for %s: %s", section_key, exc)
        return deterministic_blocks

    try:
        critic_client = _get_critic_client()
    except Exception as exc:
        logger.warning("[refine] critic client init failed for %s: %s", section_key, exc)
        return deterministic_blocks

    # Short verbatim sample for provenance "finding" field
    source_sample = json.dumps(source_data, cls=_SafeEncoder, ensure_ascii=False)[:200]

    # ── 1. Writer drafts ───────────────────────────────────────────────────────
    writer_h = _writer_human(section_key, section_title, source_data, brief)
    draft_text = _call(writer_client, WRITER_SYSTEM, writer_h, job_id)

    if not draft_text:
        logger.warning("[refine] writer no output for %s; using deterministic", section_key)
        return deterministic_blocks

    writer_output = _parse_writer_output(draft_text)
    if not writer_output or not writer_output.blocks:
        logger.warning("[refine] writer unparseable for %s; using deterministic", section_key)
        return deterministic_blocks

    best_text   = draft_text
    best_output = writer_output
    logger.info(
        "[refine] %s writer OK [%s] job=%s blocks=%d",
        section_key, writer_label, job_id, len(writer_output.blocks),
    )

    # ── 2 + 3. Critic → optional revise rounds ─────────────────────────────────
    for round_n in range(max_revise_rounds + 1):
        critic_h = _critic_human(section_key, section_title, source_data, best_text)
        critic_text = _call(critic_client, CRITIC_SYSTEM, critic_h, job_id)

        if not critic_text:
            logger.warning(
                "[refine] critic silent round %d for %s; accepting draft", round_n, section_key
            )
            break

        verdict = _parse_critic_verdict(critic_text)
        if not verdict:
            logger.warning(
                "[refine] critic unparseable round %d for %s; accepting draft", round_n, section_key
            )
            break

        logger.info(
            "[refine] %s critic round %d pass=%s issues=%d",
            section_key, round_n, verdict.pass_, len(verdict.issues),
        )

        # pass: True or no blocking issues — accept current draft
        blocking = [i for i in verdict.issues if i.type != "clarity"]
        if verdict.pass_ or not blocking:
            logger.info(
                "[refine] %s critic round %d PASSED (pass_=%s blocking=%d); accepting draft",
                section_key, round_n, verdict.pass_, len(blocking),
            )
            break

        if round_n >= max_revise_rounds:
            logger.info("[refine] %s max rounds reached; accepting best draft", section_key)
            break

        # ── Reviser ────────────────────────────────────────────────────────────
        # Reviser reuses the writer client (same model, same guardrails).
        try:
            verdict_json = verdict.model_dump_json(by_alias=True)
        except Exception as exc:
            logger.warning(
                "[refine] verdict serialisation failed round %d for %s: %s; accepting draft",
                round_n, section_key, exc,
            )
            break
        reviser_h    = _reviser_human(
            section_key, section_title, source_data, best_text, verdict_json
        )
        revised_text = _call(writer_client, REVISER_SYSTEM, reviser_h, job_id)

        if not revised_text:
            logger.warning(
                "[refine] reviser silent round %d for %s; keeping current draft", round_n, section_key
            )
            break

        revised_output = _parse_writer_output(revised_text)
        if not revised_output or not revised_output.blocks:
            logger.warning(
                "[refine] reviser unparseable round %d for %s; keeping current draft",
                round_n, section_key,
            )
            break

        best_text   = revised_text
        best_output = revised_output
        logger.info(
            "[refine] %s reviser round %d OK blocks=%d",
            section_key, round_n, len(revised_output.blocks),
        )

    # ── 4. Convert to BlockModel list ─────────────────────────────────────────
    blocks = _blocks_from_writer(best_output, section_key, writer_label, source_sample)
    if not blocks:
        logger.warning(
            "[refine] block conversion empty for %s; using deterministic", section_key
        )
        return deterministic_blocks

    return blocks
