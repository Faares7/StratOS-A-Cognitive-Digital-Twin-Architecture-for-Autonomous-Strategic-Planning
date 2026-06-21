"""
Chief Editor orchestrator — v2 pipeline.

router → per-section block builders (deterministic fallback)
       → writer→critic→revise loop for agent sections
       → assemble → validate → store

Design guarantees:
  • Always completes: any builder or LLM failure falls back to a placeholder block.
  • Bounded LLM calls per job (no autonomous loops).
  • Per-job token ceiling enforced in llm.py / refine.py.
  • Carryover sections are always deterministic — never routed through the writer.
"""
from __future__ import annotations
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

import re

from . import adapters, builders
from . import llm as _llm
from .brief import build_brief
from .provenance import agent_prov
from .refine import refine_section
from .schema import (
    BlockModel,
    ChapterModel,
    ParagraphBlockModel,
    PlanDocumentModel,
    PlanMetaModel,
    SubchapterModel,
    make_pm_doc,
)
from .skeleton import PREFACE, SKELETON, SectionDef
from .storage import insert_plan

logger = logging.getLogger(__name__)

_DEFAULT_ORG_ID = "06427de6-c8ac-46fc-bb0f-6d1714cc3cf9"

# Per-section (max_tokens_writer, max_tokens_critic) — sized for full table output.
_SECTION_BUDGETS: dict[str, tuple[int, int]] = {
    "swot_analysis":       (4096, 1500),
    "gap_analysis":        (4096, 1500),
    "strategic_goals":     (3000, 1000),
    "implementation_plan": (6000, 1500),
}


def _uid() -> str:
    return str(uuid.uuid4())[:12]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _resolve_target_states(
    input_pillars:    dict[str, dict],
    pillar_summaries: dict[str, dict],
) -> dict[str, dict]:
    """Replace each pillar's target_state with the pre-computed NAQAAE summary when
    the hash still matches (user hasn't changed the field). If hash differs or no
    summary row exists, the original target_state is kept. Returns a new dict."""
    import hashlib
    resolved: dict[str, dict] = {}
    for pname, pd in input_pillars.items():
        raw = pd.get("target_state") or ""
        row = pillar_summaries.get(pname) or {}
        if row and raw:
            current_hash = hashlib.md5(raw.encode("utf-8")).hexdigest()[:12]
            if current_hash == row.get("naqaae_hash", ""):
                resolved[pname] = {**pd, "target_state": row["summary"]}
                continue
        resolved[pname] = pd
    return resolved


# ── Main entry point ──────────────────────────────────────────────────────────

def generate_plan(
    org_id:  str  = _DEFAULT_ORG_ID,
    use_llm: bool = True,
    job_id:  str  = "",
) -> str:
    """
    Build, validate, store, and return the plan_id of a new PlanDocument.
    Never raises: all errors fall back to placeholder blocks.
    """
    _llm.reset_job_tokens(job_id)
    conn = adapters.get_conn()

    try:
        # ── 1. Org metadata ────────────────────────────────────────────────────
        org      = adapters.fetch_org(conn, org_id)
        period   = org.get("strategic_period") or "2024–2027"
        faculty  = org.get("faculty")          or "ITCS"
        org_name = org.get("display_name")     or "Nile University"

        approval_date = datetime.now(timezone.utc).strftime("%B %Y")
        meta = PlanMetaModel(
            title=f"Strategic Plan {period}",
            orgName=f"{faculty} — {org_name}",
            orgLogoUrl=None,
            periodLabel=period,
            approvalDate=approval_date,
            partnerLogoUrls=[],
        )

        # ── 2. Load all source data upfront ───────────────────────────────────
        carryover    = _safe(adapters.load_carryover, {})

        gap_run   = _safe(lambda: adapters.fetch_gap_run_id(conn))
        goals_run = _safe(lambda: adapters.fetch_goals_run_id(conn))
        exec_run  = _safe(lambda: adapters.fetch_exec_run_id(conn))

        swot_items    = _safe(lambda: adapters.fetch_swot_items_all_types(conn),   [])
        gap_items     = _safe(lambda: adapters.fetch_gap_items(conn, gap_run),     []) if gap_run   else []
        input_pillars = _safe(lambda: adapters.fetch_gap_input_pillars(conn, gap_run), {}) if gap_run else {}
        pillar_summaries      = _safe(lambda: adapters.fetch_gap_pillar_summaries(conn), {})
        effective_input_pillars = _resolve_target_states(input_pillars, pillar_summaries)
        goals         = _safe(lambda: adapters.fetch_goals(conn, goals_run),       []) if goals_run else []
        goal_ids      = [g["goal_id"] for g in goals]
        objectives    = _safe(lambda: adapters.fetch_objectives(conn, goal_ids),   []) if goal_ids  else []
        actions       = _safe(lambda: adapters.fetch_actions(conn, exec_run),      []) if exec_run  else []

        logger.info(
            "[generator] run_ids → gap=%s goals=%s exec=%s | "
            "items → swot=%d gap=%d goals=%d actions=%d",
            gap_run, goals_run, exec_run,
            len(swot_items), len(gap_items), len(goals), len(actions),
        )

        # ── 2a. Build Brief (deterministic, zero LLM calls) ───────────────────
        brief_obj = _safe(
            lambda: build_brief(org, carryover, swot_items, gap_items, goals, objectives, actions),
            None,
        )

        # ── 2b. Pre-condense SWOT SW/OT once — shared by SWOT and Gap builders
        sw_condensed: dict = {}
        ot_condensed      = None
        if use_llm and brief_obj:
            try:
                sw_condensed, ot_condensed = _prepare_swot_condensed(
                    brief_obj, swot_items, job_id
                )
            except Exception as exc:
                logger.warning("[generator] SWOT condensing step failed: %s", exc)

        # ── 3a. Build preface sections ─────────────────────────────────────────
        dean_name   = _extract_dean_name(carryover)
        preface_subs: list[SubchapterModel] = []

        for order, sec_def in enumerate(PREFACE):
            heading = sec_def.heading
            if sec_def.section_key == "dean_message" and dean_name:
                heading = f"A Message from Dean {dean_name}"

            data   = carryover.get(sec_def.section_key)
            blocks: list[BlockModel] = (
                _safe(lambda d=data: builders.build_carryover_blocks(d), [])
                if data else []
            )
            needs_review = bool(carryover.get(sec_def.section_key, {}).get("needs_review")) if data else False

            preface_subs.append(SubchapterModel(
                id=f"sub-pre-{_uid()}",
                canonicalKey=sec_def.section_key,
                heading=heading,
                order=order,
                status="auto",
                generation="complete",
                userAdded=False,
                needsReview=needs_review,
                textAlign=sec_def.text_align,
                blocks=blocks or [_placeholder_block(sec_def)],
            ))

        # ── 3b. Build numbered chapters ────────────────────────────────────────
        chapters: list[ChapterModel] = []

        for ch_def in SKELETON:
            subs: list[SubchapterModel] = []

            for order, sec_def in enumerate(ch_def.sections):
                blocks = _dispatch_builder(
                    sec_def, carryover, swot_items, gap_items,
                    effective_input_pillars, goals, objectives, actions,
                    use_llm=use_llm, job_id=job_id,
                    brief_obj=brief_obj,
                    sw_condensed=sw_condensed,
                    ot_condensed=ot_condensed,
                )

                # Writer→critic→revise for agent sections; carryover is always deterministic.
                if use_llm and sec_def.mode == "agent" and brief_obj:
                    wt, ct = _SECTION_BUDGETS.get(sec_def.section_key, (2048, 1024))
                    blocks = refine_section(
                        section_key=sec_def.section_key,
                        section_title=sec_def.heading,
                        source_data=_build_source_data(
                            sec_def.section_key,
                            swot_items, gap_items, effective_input_pillars,
                            goals, objectives, actions,
                            sw_condensed or None,
                            ot_condensed,
                        ),
                        deterministic_blocks=blocks,
                        brief=brief_obj,
                        job_id=job_id,
                        max_tokens_writer=wt,
                        max_tokens_critic=ct,
                    )

                needs_review = (
                    bool(carryover.get(sec_def.section_key, {}).get("needs_review"))
                    if sec_def.mode == "carryover"
                    else False
                )

                subs.append(SubchapterModel(
                    id=f"sub-{_uid()}",
                    canonicalKey=sec_def.section_key,
                    heading=sec_def.heading,
                    order=order,
                    status="auto",
                    generation="complete",
                    userAdded=False,
                    needsReview=needs_review,
                    blocks=blocks or [_placeholder_block(sec_def)],
                ))

            chapters.append(ChapterModel(
                id=f"ch-{_uid()}",
                number=ch_def.number,
                title=ch_def.title,
                canonicalKey=ch_def.canonical_key,
                sections=subs,
                userAdded=False,
            ))

        # ── 4. Assemble + validate ─────────────────────────────────────────────
        now = _now()
        doc = PlanDocumentModel(
            id=str(uuid.uuid4()),
            orgId=org_id,
            meta=meta,
            templateId="formal-gov",
            language="en",
            dir="ltr",
            preface=preface_subs,
            chapters=chapters,
            docStatus="draft",
            createdAt=now,
            updatedAt=now,
        )

        # ── 5. Store ───────────────────────────────────────────────────────────
        plan_id = insert_plan(conn, doc)
        logger.info("[generator] stored plan_id=%s", plan_id)
        return plan_id

    finally:
        try:
            conn.close()
        except Exception:
            pass


# ── Section dispatcher ────────────────────────────────────────────────────────

def _dispatch_builder(
    sec:           SectionDef,
    carryover:     dict,
    swot_items:    list,
    gap_items:     list,
    input_pillars: dict,
    goals:         list,
    objectives:    list,
    actions:       list,
    use_llm:       bool = False,
    job_id:        str  = "",
    brief_obj      = None,
    sw_condensed:  dict | None = None,
    ot_condensed   = None,
) -> list[BlockModel]:
    try:
        if sec.mode == "carryover":
            data = carryover.get(sec.section_key)
            return builders.build_carryover_blocks(data) if data else []

        if sec.agent == "swot":
            return builders.build_swot_blocks(
                swot_items,
                sw_condensed=sw_condensed if use_llm else None,
                ot_condensed=ot_condensed if use_llm else None,
            )

        if sec.agent == "gap":
            return builders.build_gap_blocks_llm(
                gap_items, input_pillars,
                sw_condensed=sw_condensed if use_llm else None,
            )

        if sec.agent == "goals":
            return builders.build_goals_blocks(goals, objectives)

        if sec.agent == "exec":
            activity_condense_fn = (
                (lambda acts, jid="": _llm.condense_exec_activities(
                    brief_obj, acts, job_id=jid
                ))
                if use_llm and brief_obj else None
            )
            return builders.build_exec_blocks(
                actions, goals=goals, objectives=objectives,
                activity_condense_fn=activity_condense_fn,
                job_id=job_id,
            )

    except Exception as exc:
        logger.warning("[generator] builder failed for %s: %s", sec.section_key, exc)
    return []


# ── Source data assembler (feeds refine_section) ─────────────────────────────

def _build_source_data(
    section_key:   str,
    swot_items:    list,
    gap_items:     list,
    input_pillars: dict,
    goals:         list,
    objectives:    list,
    actions:       list,
    sw_condensed:  dict | None = None,
    ot_condensed              = None,
) -> dict:
    """Slim source_data dict for refine_section — writer-relevant fields only.
    Strips DB noise (created_at, run_id, pricing_provenance, etc.) to reduce prompt size."""

    if section_key == "swot_analysis":
        d: dict = {
            "swot_items": [
                {k: v for k, v in item.items()
                 if k in ("type", "title", "description", "pillar_id", "pillar_name", "impact_level")}
                for item in swot_items
            ]
        }
        if sw_condensed:
            # tuple(list,list) → list[list] for JSON
            d["sw_condensed"] = {k: [list(v[0]), list(v[1])] for k, v in sw_condensed.items()}
        if ot_condensed is not None:
            d["ot_condensed"] = [list(ot_condensed[0]), list(ot_condensed[1])]
        return d

    if section_key == "gap_analysis":
        d = {
            "gap_items": [
                {k: v for k, v in item.items()
                 if k in ("pillar_id", "pillar_name", "gap_identified", "suggestion")}
                for item in gap_items
            ],
            "input_pillars": {
                name: {k: v for k, v in data.items()
                       if k in ("pillar", "target_state", "strengths", "weaknesses")}
                for name, data in input_pillars.items()
            },
        }
        if sw_condensed:
            d["sw_condensed"] = {k: [list(v[0]), list(v[1])] for k, v in sw_condensed.items()}
        return d

    if section_key == "strategic_goals":
        return {
            "goals": [
                {k: v for k, v in g.items()
                 if k in ("goal_id", "title", "description", "position")}
                for g in goals
            ],
            "objectives": [
                {k: v for k, v in o.items()
                 if k in ("objective_id", "goal_id", "text", "position", "tows_type")}
                for o in objectives
            ],
        }

    if section_key == "implementation_plan":
        return {
            "goals": [
                {k: v for k, v in g.items()
                 if k in ("goal_id", "title", "description", "position")}
                for g in goals
            ],
            "objectives": [
                {k: v for k, v in o.items()
                 if k in ("objective_id", "goal_id", "text", "position")}
                for o in objectives
            ],
            "actions": [
                {k: v for k, v in a.items()
                 if k in ("action_id", "objective_id", "activity_text", "kpi_name",
                          "start_quarter", "end_quarter", "responsible_exec",
                          "responsible_monitor", "inflated_cost_egp")}
                for a in actions
            ],
        }

    return {}


# ── SWOT pre-condensing ───────────────────────────────────────────────────────

def _prepare_swot_condensed(
    brief_obj:  object,
    swot_items: list[dict],
    job_id:     str,
) -> tuple[dict, object]:
    """Group SWOT items then condense SW per pillar + OT once.
    Returns (sw_condensed, ot_condensed) — internal failures are logged, not raised."""
    strengths_by:  dict[str, list[str]] = {}
    weaknesses_by: dict[str, list[str]] = {}
    o_texts: list[str] = []
    t_texts: list[str] = []

    for item in swot_items:
        t     = (item.get("type") or "").lower()
        pname = (item.get("pillar_name") or "").strip() or "General"
        title = (item.get("title") or "").strip()
        desc  = (item.get("description") or "").strip()
        text  = f"{title}: {desc}" if title and desc else (title or desc)
        if not text:
            continue
        if t == "strength":
            strengths_by.setdefault(pname, []).append(text)
        elif t == "weakness":
            weaknesses_by.setdefault(pname, []).append(text)
        elif t == "opportunity":
            o_texts.append(text)
        elif t == "threat":
            t_texts.append(text)

    sw_condensed: dict[str, tuple[list[str], list[str]]] = {}
    for pname in {*strengths_by, *weaknesses_by}:
        s_raw = strengths_by.get(pname, [])
        w_raw = weaknesses_by.get(pname, [])
        try:
            s_b, w_b = _llm.condense_swot_sw_pillar(brief_obj, pname, s_raw, w_raw, job_id=job_id)  # type: ignore[arg-type]
            sw_condensed[pname] = (s_b, w_b)
        except Exception as exc:
            logger.warning("[generator] SW condense failed for '%s': %s", pname, exc)

    ot_condensed = None
    if o_texts or t_texts:
        try:
            ot_condensed = _llm.condense_swot_ot(brief_obj, o_texts, t_texts, job_id=job_id)  # type: ignore[arg-type]
        except Exception as exc:
            logger.warning("[generator] OT condense failed: %s", exc)

    return sw_condensed, ot_condensed


# ── Fallback block ────────────────────────────────────────────────────────────

def _placeholder_block(sec: SectionDef) -> ParagraphBlockModel:
    prov = agent_prov(
        agent="chief_editor",
        finding=f"No source data available for '{sec.heading}'",
        source="pipeline",
    )
    return ParagraphBlockModel(
        id=f"b-ph-{_uid()}",
        provenance=prov,
        content=make_pm_doc(
            f"[{sec.heading}: no data available — run the relevant agent first]"
        ),
    )


# ── Safe caller ───────────────────────────────────────────────────────────────

def _safe(fn, default=None):
    try:
        return fn()
    except Exception as exc:
        logger.warning("[generator] safe call failed: %s", exc)
        return default


# ── Dean name extractor ───────────────────────────────────────────────────────

def _extract_dean_name(carryover: dict) -> str:
    """Extract the current dean's name from prep_team carryover blocks.
    Searches text blocks first (team leader line), then list items.
    Prioritises 'team leader' over generic 'dean' to avoid picking up former deans."""
    pt = carryover.get("prep_team", {})
    _PROF_RE = re.compile(r"Prof\.?\s+([A-Za-z\s.\-]+?)(?:\s*[—–]|\s*$)")

    # Collect all candidate strings: text blocks first, then list items.
    candidates: list[str] = []
    for block in pt.get("blocks", []):
        if not isinstance(block, dict):
            continue
        text = block.get("text", "")
        if text:
            candidates.append(text)
        for item in block.get("items", []):
            if isinstance(item, str):
                candidates.append(item)

    # First pass: prefer explicit "team leader" designation (current dean).
    for c in candidates:
        if "team leader" in c.lower():
            m = _PROF_RE.search(c)
            if m:
                return f"Prof. {m.group(1).strip()}"

    # Second pass: any line that names a dean but is NOT a former dean.
    for c in candidates:
        lo = c.lower()
        if "dean" in lo and "former" not in lo:
            m = _PROF_RE.search(c)
            if m:
                return f"Prof. {m.group(1).strip()}"

    return ""
