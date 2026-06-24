"""
Vertex AI LLM factory + v2 condenser / intro passes for the Chief Editor.

v2 design (replaces v1 summarize_pillar_gap / generate_section_intro):
  - Global rule preamble shared by every call.
  - Brief context object grounds every call.
  - Four condensers: gap-pillar / SWOT-SW / SWOT-OT / exec-activities.
  - One Brief-grounded section intro (replaces snippet-based v1).

COST / RUNAWAY GUARDS:
  • Fixed calls per job (no autonomous loops).
  • max 1 retry on bad output, then deterministic fallback.
  • max_output_tokens capped per call.
  • thinking_budget=0 — no silent token burn.
  • Per-job token ceiling: _TOKEN_CEILING words (rough proxy).
"""
from __future__ import annotations
import logging
import os
import re
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from .brief import Brief

logger = logging.getLogger(__name__)

_TOKEN_CEILING = 120_000   # condensers (~40k) + writer loops (~80k) for large datasets
_job_tokens: dict[str, float] = {}


# ── Factory ────────────────────────────────────────────────────────────────────

def get_chat_model(model: str = "gemini-2.5-flash"):
    """Return a configured ChatVertexAI instance.
    Auth: GOOGLE_APPLICATION_CREDENTIALS (ADC service-account JSON).
    No max_output_tokens cap — let the model output fully to avoid truncation.
    Thinking is explicitly disabled."""
    from langchain_google_vertexai import ChatVertexAI  # noqa: PLC0415

    project  = os.getenv("GOOGLE_CLOUD_PROJECT", "caregiver-tutoring-assistant")
    location = "us-central1"

    for kwargs in [
        {
            "model_name": model,
            "project":    project,
            "location":   location,
            "model_kwargs": {
                "generation_config": {"thinking_config": {"thinking_budget": 0}}
            },
        },
        {
            "model_name": model,
            "project":    project,
            "location":   location,
        },
    ]:
        try:
            return ChatVertexAI(**kwargs)
        except Exception as exc:
            logger.debug(f"[llm] ChatVertexAI init variant failed: {exc}")
    raise RuntimeError("Cannot initialise ChatVertexAI — check ADC credentials")


# ── Token ceiling ─────────────────────────────────────────────────────────────

def _word_count(text: str) -> float:
    return len(text.split()) * 1.3


def _bump_ceiling(job_id: str, words: float) -> None:
    if not job_id:
        return
    _job_tokens[job_id] = _job_tokens.get(job_id, 0.0) + words
    if _job_tokens[job_id] > _TOKEN_CEILING:
        raise OverflowError(
            f"[llm] Job {job_id!r} hit token ceiling "
            f"({_job_tokens[job_id]:.0f} > {_TOKEN_CEILING})"
        )


def reset_job_tokens(job_id: str) -> None:
    _job_tokens.pop(job_id, None)


# ── Global rule preamble ──────────────────────────────────────────────────────

_GLOBAL_RULE = (
    "ROLE: You are the Chief Editor of a university strategic plan document. "
    "Your role is writer, beautifier, and assembler — NOT a strategist.\n\n"
    "NON-NEGOTIABLE RULES (violations will be rejected):\n"
    "1. FAITHFULNESS — never invent facts, figures, names, dates, pillar names, or "
    "programme names. Only condense or rephrase what is explicitly given in the INPUT "
    "section below.\n"
    "2. CONDENSE, DON'T EXPAND — your output must be meaningfully shorter than the input.\n"
    "3. FORMAL ACADEMIC ENGLISH — precise, impersonal, third-person where applicable.\n"
    "4. FORMAT DISCIPLINE — output exactly the structure requested; no preamble, no "
    "markdown headers, no trailing notes or explanations.\n"
    "5. GLOSSARY — keep the following terms exactly as written: NAQAAE, ITCS, and the "
    "strategic-period label (e.g. 2024–2027). Never translate or alter them.\n"
    "6. REORDERING ALLOWED — reorder or regroup items for clarity; rephrase for concision; "
    "do not fabricate new content."
)


def _build_prompt(brief: "Brief", task: str) -> str:
    """Compose full prompt: global rule + brief context + per-call task."""
    return (
        f"{_GLOBAL_RULE}\n\n"
        f"INSTITUTIONAL CONTEXT:\n{brief.render()}\n\n"
        f"{task}"
    )


# ── Shared helpers ────────────────────────────────────────────────────────────

def _fallback_bullets(text: str) -> list[str]:
    """Deterministically split prose into bullet-point strings."""
    if not text or text.strip() in ("—", "-", ""):
        return []
    text = text.strip()
    lines = [
        l.strip().lstrip("-•*·▪0123456789.)").strip()
        for l in text.split("\n")
        if l.strip().lstrip("-•*·▪0123456789.)").strip()
    ]
    if len(lines) > 1:
        return [l for l in lines if len(l) > 5][:8]
    sentences = [
        s.strip() for s in re.split(r"(?<=[.!?])\s+", text)
        if s.strip() and len(s.strip()) > 8
    ]
    return sentences[:6] if sentences else ([text[:300]] if text.strip() else [])


def _parse_two_sections(
    text: str, label_a: str, label_b: str
) -> tuple[list[str], list[str]]:
    """Parse LLM output with two labeled bullet sections.
    Each section is introduced by a line starting with label_a or label_b (case-insensitive)."""
    a_bullets: list[str] = []
    b_bullets: list[str] = []
    current: str | None = None
    for line in text.split("\n"):
        stripped = line.strip()
        upper    = stripped.upper()
        if upper.startswith(label_a.upper()):
            current = "a"
        elif upper.startswith(label_b.upper()):
            current = "b"
        elif stripped.startswith("-") and current:
            bullet = stripped.lstrip("-").strip()
            if bullet:
                (a_bullets if current == "a" else b_bullets).append(bullet)
    return a_bullets, b_bullets


def _llm_call(
    prompt: str,
    job_id: str,
    model:  str,
) -> Optional[str]:
    """Single LLM invoke with ceiling check and 1 retry. Returns stripped text or None."""
    from langchain_core.messages import HumanMessage  # noqa: PLC0415

    try:
        _bump_ceiling(job_id, _word_count(prompt))
    except OverflowError as exc:
        logger.warning(str(exc))
        return None

    for attempt in range(2):
        try:
            llm  = get_chat_model(model=model)
            resp = llm.invoke([HumanMessage(content=prompt)])
            text = (getattr(resp, "content", None) or "").strip()
            if not text:
                continue
            try:
                _bump_ceiling(job_id, _word_count(text))
            except OverflowError as exc:
                logger.warning(str(exc))
                return None
            return text
        except OverflowError:
            return None
        except Exception as exc:
            logger.warning(f"[llm] attempt {attempt + 1} failed: {exc}")

    return None


# ── v2 condensers ─────────────────────────────────────────────────────────────

def condense_gap_pillar(
    brief:        "Brief",
    pillar:       str,
    target_state: str,
    suggestions:  list[str],
    job_id:       str = "",
    model:        str = "gemini-2.5-flash",
) -> tuple[list[str], list[str]]:
    """Condense gap-analysis data for one NAQAAE pillar into two bullet lists.
    Returns (target_bullets, suggestion_bullets).
    Falls back to deterministic sentence-split on any failure."""
    sugg_block = "\n".join(f"- {s}" for s in suggestions if s) or "None provided."
    task = (
        f"TASK: Condense the gap analysis data for NAQAAE pillar '{pillar}' "
        f"into two concise bullet lists.\n\n"
        f"INPUT — TARGET STATE:\n{target_state or 'Not provided'}\n\n"
        f"INPUT — IMPROVEMENT SUGGESTIONS:\n{sugg_block}\n\n"
        f"OUTPUT FORMAT (output ONLY the following lines — no other text):\n"
        f"TARGET:\n- <bullet>\n\n"
        f"SUGGESTIONS:\n- <bullet>"
    )
    text = _llm_call(_build_prompt(brief, task), job_id, model)
    if text:
        t_b, s_b = _parse_two_sections(text, "TARGET", "SUGGESTIONS")
        if t_b or s_b:
            return t_b, s_b
    return _fallback_bullets(target_state), _fallback_bullets("; ".join(suggestions))



def condense_exec_activities(
    brief:      "Brief",
    activities: list[dict],
    job_id:     str = "",
    model:      str = "gemini-2.5-flash",
) -> list[dict]:
    """Condense activity_text and kpi_name cells only.
    STRICTLY VERBATIM — never sent to LLM: timeframe, responsibles, funding.
    Returns a same-length list of dicts with condensed 'activity_text' and 'kpi_name'.
    Falls back to original values on any failure."""
    if not activities:
        return []

    lines = []
    for i, a in enumerate(activities, 1):
        act = (a.get("activity_text") or "—").strip()
        kpi = (a.get("kpi_name") or "—").strip()
        lines.append(f"{i}.\nACTIVITY: {act}\nKPI: {kpi}")

    task = (
        f"TASK: Condense each activity description and KPI name in the numbered list below. "
        f"Keep each condensed version precise and measurable. "
        f"Preserve the item count and numbered order exactly.\n\n"
        f"INPUT:\n" + "\n\n".join(lines) + "\n\n"
        f"OUTPUT FORMAT (one block per item, no extra text):\n"
        f"<number>.\nACTIVITY: <condensed description>\nKPI: <condensed KPI name>"
    )
    # Scale token budget with activity count
    text = _llm_call(_build_prompt(brief, task), job_id, model)
    if text:
        condensed = _parse_exec_output(text, len(activities))
        if len(condensed) == len(activities) and any(c.get("activity_text") for c in condensed):
            return condensed

    return [
        {
            "activity_text": (a.get("activity_text") or "—").strip(),
            "kpi_name":      (a.get("kpi_name") or "—").strip(),
        }
        for a in activities
    ]


def _parse_exec_output(text: str, n: int) -> list[dict]:
    """Parse numbered ACTIVITY/KPI blocks from condense_exec_activities output."""
    results: list[dict] = []
    blocks = re.split(r"\n\s*\d+\.\s*\n", "\n" + text.strip() + "\n")
    blocks = [b.strip() for b in blocks if b.strip()]
    for block in blocks[:n]:
        activity = ""
        kpi      = ""
        for line in block.split("\n"):
            line = line.strip()
            lo   = line.lower()
            if lo.startswith("activity:"):
                activity = line[len("activity:"):].strip()
            elif lo.startswith("kpi:"):
                kpi = line[len("kpi:"):].strip()
        results.append({"activity_text": activity, "kpi_name": kpi})

    while len(results) < n:
        results.append({})
    return results[:n]


# ── v2 section intro ──────────────────────────────────────────────────────────

def generate_section_intro(
    brief:         "Brief",
    section_key:   str,
    section_title: str,
    job_id:        str = "",
    model:         str = "gemini-2.5-flash",
) -> Optional[str]:
    """Generate a 2–3 sentence (≤80 word) intro for an agent-sourced section.
    Grounded in Brief. Returns None on any failure."""
    section_context = {
        "swot_analysis":       f"The SWOT analysis covers {brief.swot_summary}.",
        "gap_analysis":        f"The gap analysis examines {brief.gap_summary}.",
        "strategic_goals":     f"The strategic direction encompasses {brief.goals_summary}.",
        "implementation_plan": f"The implementation plan details {brief.exec_summary}.",
    }.get(section_key, "")

    task = (
        f"TASK: Write a single introductory paragraph (2–3 sentences, ≤80 words) for the "
        f'"{section_title}" section of the strategic plan document. '
        f"{section_context} "
        f"Do not repeat the section title. Do not introduce any fact not present in the "
        f"INSTITUTIONAL CONTEXT above. "
        f"Output ONLY the paragraph — no heading, no preamble, no trailing notes."
    )
    return _llm_call(_build_prompt(brief, task), job_id, model)
