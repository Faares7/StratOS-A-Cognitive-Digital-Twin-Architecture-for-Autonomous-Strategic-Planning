"""
Per-section Block[] builders — fully deterministic, no LLM dependency.
Each builder returns a list[BlockModel] for one subchapter.

Provenance rule: every block stores the VERBATIM raw source so the XAI
panel can show "what the source said" vs "what's in the plan."
"""
from __future__ import annotations
import uuid
from typing import Any

from .schema import (
    BlockModel,
    ParagraphBlockModel,
    ListBlockModel,
    TableBlockModel,
    ProseMirrorNode,
    ProvenanceModel,
    make_pm_doc,
    make_pm_text,
    make_pm_bullets,
    MixedProvenanceModel,
)
from .provenance import ref_plan_prov, agent_prov, mixed_prov


def _uid() -> str:
    return str(uuid.uuid4())[:12]


def _para(text: str, prov: ProvenanceModel) -> ParagraphBlockModel:
    return ParagraphBlockModel(id=f"b-{_uid()}", provenance=prov, content=make_pm_doc(text))


def _list_blk(items: list[str], prov: ProvenanceModel, ordered: bool = False) -> ListBlockModel:
    return ListBlockModel(
        id=f"b-{_uid()}", provenance=prov, ordered=ordered,
        items=[make_pm_text(t) for t in items],
    )


def _table_blk(
    header: list[str] | None,
    rows:   list[list[str]],
    prov:   ProvenanceModel,
    caption: str | None = None,
) -> TableBlockModel:
    return TableBlockModel(
        id=f"b-{_uid()}", provenance=prov,
        header=header,
        rows=[[make_pm_text(cell) for cell in row] for row in rows],
        caption=caption,
    )


# ── Carryover builder ─────────────────────────────────────────────────────────

def build_carryover_blocks(section_data: dict) -> list[BlockModel]:
    """Convert a carryover JSON section into PlanDocument Block list.
    Source: Data/carryover_sections_en.json  (v1) → later: strategic_plan_sections table."""
    key   = section_data["section_key"]
    title = section_data["title_en"]
    p_raw = section_data.get("provenance", {})
    prov  = ref_plan_prov(
        section_key=key,
        section_heading=title,
        plan_title=p_raw.get("source_plan", "ITCS Strategic Plan 2020–2024"),
        page=p_raw.get("page_start"),
    )

    blocks: list[BlockModel] = []
    for raw in section_data.get("blocks", []):
        bid   = f"b-{_uid()}"
        btype = raw.get("type", "paragraph")

        if btype == "paragraph":
            blocks.append(ParagraphBlockModel(
                id=bid, provenance=prov,
                content=make_pm_doc(raw.get("text", "")),
            ))

        elif btype == "list":
            blocks.append(ListBlockModel(
                id=bid, provenance=prov,
                ordered=raw.get("ordered", False),
                items=[make_pm_text(item) for item in raw.get("items", [])],
            ))

        elif btype == "table":
            raw_rows = raw.get("rows", [])
            blocks.append(TableBlockModel(
                id=bid, provenance=prov,
                header=raw.get("header"),
                rows=[[make_pm_text(cell) for cell in row] for row in raw_rows],
                caption=raw.get("caption"),
            ))

    return blocks


# ── SWOT builder ──────────────────────────────────────────────────────────────

_SWOT_TYPES = ("strength", "weakness", "opportunity", "threat")

# Canonical NAQAAE program-accreditation pillar order (IDs 1–7 as stored in DB).
# Matches pillar_id integers in swot_items, gap_analysis_items, strategic_objectives.
# Pillar 4 canonical name is "Students and Graduate Outcomes" — swot_items has a
# legacy typo ("Students and Graduates") which _fuzzy_get handles via normalisation.
_NAQAAE_PILLAR_ORDER = [
    "Program Mission and Management",           # 1
    "Program Design",                           # 2
    "Teaching, Learning and Assessment",        # 3
    "Students and Graduate Outcomes",           # 4
    "Faculty and Teaching Assistants",          # 5
    "Resources and Learning Facilities",        # 6
    "Quality Assurance and Program Evaluation", # 7
]

# Fixed SWOT methodology paragraph sourced from the task-force process description.
_SWOT_METHODOLOGY_INTRO = (
    "To evaluate the current situation and identify strengths and weaknesses within the "
    "internal environment, as well as opportunities and threats in the external environment, "
    "the task force conducted the following steps: "
    "(1) Designed internal and external data collection tools according to the NAQAAE quality "
    "and accreditation standards; "
    "(2) Conducted brainstorming sessions with faculty members, teaching assistants, staff, "
    "students, and alumni; "
    "(3) Conducted opinion surveys, analysed results, and monitored outputs; "
    "(4) Leveraged the expertise of the Advisory Board and university leadership."
)

# LLM placeholder phrases that should be treated as empty cells.
_PLACEHOLDER_WORDS = {
    "none", "none.", "none identified", "none identified.", "none provided",
    "none provided.", "n/a", "—", "-",
}


def _filter_placeholder_bullets(bullets: list[str]) -> list[str]:
    """Remove LLM-generated placeholder bullets that carry no real content."""
    return [
        b for b in bullets
        if b.strip().lower().rstrip(".") not in _PLACEHOLDER_WORDS
        and len(b.strip()) > 3
    ]


def _item_text(it: dict) -> str:
    title = (it.get("title") or "").strip()
    desc  = (it.get("description") or "").strip()
    return f"{title}: {desc}" if title and desc else (title or desc or "")


def _fuzzy_get(d: dict, pname: str):
    """Case-insensitive key lookup with pillar-4 alias normalisation.
    'Students and Graduates' and 'Students and Graduate Outcomes' are the same pillar."""
    _ALIASES = {
        "students and graduates": "students and graduate outcomes",
    }

    def _norm(s: str) -> str:
        s = s.lower().strip()
        return _ALIASES.get(s, s)

    if pname in d:
        return d[pname]
    pname_n = _norm(pname)
    for k, v in d.items():
        if _norm(k) == pname_n:
            return v
    return None


def build_swot_blocks(
    swot_items:   list[dict],
    sw_condensed: dict[str, tuple[list[str], list[str]]] | None = None,
    ot_condensed: tuple[list[str], list[str]] | None = None,
) -> list[BlockModel]:
    """SWOT as two tables:
    • SW table — one row per NAQAAE pillar (all 7 always present): [Pillar | Strengths | Weaknesses]
    • OT table — two rows:  [Opportunities | <bullets>] and [Threats | <bullets>]
    Prepended by a fixed methodology intro paragraph.
    When sw_condensed/ot_condensed are provided (from llm.condense_swot_*), those
    bullets replace verbatim item-text; originals are retained in provenance evidence."""
    strengths:     dict[str, list[dict]] = {}
    weaknesses:    dict[str, list[dict]] = {}
    opportunities: list[dict] = []
    threats:       list[dict] = []

    for item in swot_items:
        t     = (item.get("type") or "").lower()
        pname = (item.get("pillar_name") or "").strip() or "General"
        if t == "strength":
            strengths.setdefault(pname, []).append(item)
        elif t == "weakness":
            weaknesses.setdefault(pname, []).append(item)
        elif t == "opportunity":
            opportunities.append(item)
        elif t == "threat":
            threats.append(item)

    methodology_prov = agent_prov(
        agent="chief_editor",
        finding=_SWOT_METHODOLOGY_INTRO,
        source="methodology",
    )
    blocks: list[BlockModel] = [_para(_SWOT_METHODOLOGY_INTRO, methodology_prov)]

    # ── Strengths / Weaknesses table — all 7 NAQAAE pillars always shown ─────
    all_pillars = list(dict.fromkeys(
        _NAQAAE_PILLAR_ORDER
        + [p for p in strengths if p not in _NAQAAE_PILLAR_ORDER]
        + [p for p in weaknesses if p not in _NAQAAE_PILLAR_ORDER]
    ))

    sw_provs = [
        agent_prov(
            agent=it.get("agent_id") or "swot_runner",
            finding=_item_text(it),                              # VERBATIM
            source=str(it.get("source_metadata") or "swot_items"),
            category=cat,  # type: ignore[arg-type]
            pillar_tag=pname,
            evidence={"impact_level": it.get("impact_level"), "evidence": it.get("evidence")},
        )
        for cat, grp in [("strength", strengths), ("weakness", weaknesses)]
        for pname, items in grp.items()
        for it in items
    ]
    if sw_condensed:
        sw_provs.append(agent_prov(
            agent="chief_editor",
            finding="LLM-condensed strengths and weaknesses per NAQAAE pillar",
            source="swot_items+llm:gemini-2.5-flash",
            evidence={"editorRefined": True},
        ))
    sw_prov = mixed_prov(sw_provs) if len(sw_provs) > 1 else (
        sw_provs[0] if sw_provs else agent_prov("swot_runner", "SW analysis", "swot_items")
    )

    sw_rows = []
    for pname in all_pillars:
        condensed_pair = _fuzzy_get(sw_condensed, pname) if sw_condensed else None
        if condensed_pair:
            s_bullets, w_bullets = condensed_pair
        else:
            s_bullets = [_item_text(it) for it in strengths.get(pname, []) if _item_text(it)]
            w_bullets = [_item_text(it) for it in weaknesses.get(pname, []) if _item_text(it)]
        s_bullets = _filter_placeholder_bullets(s_bullets)
        w_bullets = _filter_placeholder_bullets(w_bullets)
        sw_rows.append([
            make_pm_text(pname),
            make_pm_bullets(s_bullets) if s_bullets else make_pm_text("—"),
            make_pm_bullets(w_bullets) if w_bullets else make_pm_text("—"),
        ])

    blocks.append(TableBlockModel(
        id=f"b-{_uid()}", provenance=sw_prov,
        header=["NAQAAE Pillar", "Strengths", "Weaknesses"],
        rows=sw_rows,
        caption="Internal Environment — Strengths and Weaknesses by NAQAAE Pillar",
    ))

    # ── Opportunities / Threats table — two rows (one per category) ───────────
    ot_provs = [
        agent_prov(
            agent=it.get("agent_id") or "swot_runner",
            finding=_item_text(it),                              # VERBATIM
            source=str(it.get("source_metadata") or "swot_items"),
            category=cat,  # type: ignore[arg-type]
        )
        for cat, grp in [("opportunity", opportunities), ("threat", threats)]
        for it in grp
    ]
    if ot_condensed:
        ot_provs.append(agent_prov(
            agent="chief_editor",
            finding="LLM-condensed opportunities and threats",
            source="swot_items+llm:gemini-2.5-flash",
            evidence={"editorRefined": True},
        ))
    ot_prov = mixed_prov(ot_provs) if len(ot_provs) > 1 else (
        ot_provs[0] if ot_provs else agent_prov("swot_runner", "OT analysis", "swot_items")
    )

    if ot_condensed:
        o_bullets, t_bullets = ot_condensed
    else:
        o_bullets = [_item_text(it) for it in opportunities if _item_text(it)]
        t_bullets = [_item_text(it) for it in threats if _item_text(it)]

    o_bullets = _filter_placeholder_bullets(o_bullets)
    t_bullets = _filter_placeholder_bullets(t_bullets)

    # Two-row table: Opportunities row, then Threats row
    blocks.append(TableBlockModel(
        id=f"b-{_uid()}", provenance=ot_prov,
        header=["Category", "Details"],
        rows=[
            [
                make_pm_text("Opportunities"),
                make_pm_bullets(o_bullets) if o_bullets else make_pm_text("—"),
            ],
            [
                make_pm_text("Threats"),
                make_pm_bullets(t_bullets) if t_bullets else make_pm_text("—"),
            ],
        ],
        caption="External Environment — Opportunities and Threats",
    ))

    return blocks


# ── Gap builder ───────────────────────────────────────────────────────────────

def _text_to_bullets(text: str) -> list[str]:
    """Deterministically split prose into bullet-point strings."""
    import re
    if not text or text.strip() in ("—", "-", ""):
        return []
    text = text.strip()
    lines = [l.strip().lstrip("-•*·▪0123456789.)").strip()
             for l in text.split("\n")
             if l.strip().lstrip("-•*·▪0123456789.)").strip()]
    if len(lines) > 1:
        return [l for l in lines if len(l) > 5][:8]
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text)
                 if s.strip() and len(s.strip()) > 8]
    return sentences[:6] if sentences else ([text[:300]] if text.strip() else [])


def _bold_para(text: str, prov: ProvenanceModel) -> ParagraphBlockModel:
    """Paragraph with bolded text — used as a sub-section label inside a section."""
    from .schema import ProseMirrorMark
    return ParagraphBlockModel(
        id=f"b-{_uid()}", provenance=prov,
        content=ProseMirrorNode(
            type="doc",
            content=[ProseMirrorNode(
                type="paragraph",
                content=[ProseMirrorNode(
                    type="text", text=text,
                    marks=[ProseMirrorMark(type="bold")],
                )],
            )],
        ),
    )


def build_gap_blocks_llm(
    gap_items:     list[dict],
    input_pillars: dict[str, dict],
    sw_condensed:  dict[str, tuple[list[str], list[str]]] | None = None,
) -> list[BlockModel]:
    """5-column gap table — all 7 NAQAAE pillars always present as baseline rows:
    [Pillar | Strengths | Weaknesses | Target State | Improvement Suggestions]

    S/W: uses sw_condensed (shared with SWOT table) when provided, else input_pillars prose.
    Target state: taken directly from input_pillars.target_state (pre-resolved by generator).
    Suggestions: verbatim from gap_analysis_items, never LLM-condensed.
    Pillar name matching is case-insensitive to tolerate minor DB/JSON key divergence.
    input_pillars key is "pillar" (not "pillar_name").
    """
    suggestions_by_pillar: dict[str, list[str]] = {}
    per_item_provs: list = []

    for item in gap_items:
        pname = item.get("pillar_name", "Unknown")
        s = item.get("suggestion", "")
        g = item.get("gap_identified", "")
        if s:
            suggestions_by_pillar.setdefault(pname, []).append(s)
        per_item_provs.append(
            agent_prov(
                agent="gap_analysis",
                finding=g,                      # VERBATIM
                source="gap_analysis_items",
                pillar_tag=pname,
                evidence={
                    "reasoning": item.get("reasoning"),
                    "position":  item.get("position"),
                },
            )
        )

    table_prov_sources = list(per_item_provs)
    if sw_condensed:
        table_prov_sources.append(
            agent_prov(
                agent="chief_editor",
                finding="SWOT S/W condensed per NAQAAE pillar (shared with SWOT table)",
                source="swot_items+llm:gemini-2.5-flash",
                evidence={"editorRefined": True},
            )
        )
    table_prov = (
        mixed_prov(table_prov_sources) if len(table_prov_sources) > 1
        else (table_prov_sources[0] if table_prov_sources
              else agent_prov("gap_analysis", "Gap analysis", "gap_analysis_items"))
    )

    # Always show all 7 NAQAAE pillars, plus any extras from agent data
    all_gap_pillars = list(dict.fromkeys(
        _NAQAAE_PILLAR_ORDER
        + [p for p in input_pillars if p not in _NAQAAE_PILLAR_ORDER]
        + [p for p in suggestions_by_pillar
           if p not in _NAQAAE_PILLAR_ORDER and p not in input_pillars]
    ))

    rows: list = []
    for pname in all_gap_pillars:
        pd         = _fuzzy_get(input_pillars, pname) or {}
        sugg_list  = _fuzzy_get(suggestions_by_pillar, pname) or []

        # Target state: already resolved by generator._resolve_target_states
        # (summary if hash matches, user's text if edited, raw if no summary).
        t_bullets = _text_to_bullets(pd.get("target_state") or "")

        # Suggestions: verbatim from DB — never LLM-condensed.
        sg_bullets = sugg_list

        # S/W: shared condensed output (from SWOT table) takes precedence
        sw_pair = _fuzzy_get(sw_condensed, pname) if sw_condensed else None
        if sw_pair:
            s_bullets, w_bullets = sw_pair
        else:
            s_bullets = _text_to_bullets(pd.get("strengths") or "")
            w_bullets = _text_to_bullets(pd.get("weaknesses") or "")

        s_bullets  = _filter_placeholder_bullets(s_bullets)
        w_bullets  = _filter_placeholder_bullets(w_bullets)
        t_bullets  = _filter_placeholder_bullets(t_bullets)
        sg_bullets = _filter_placeholder_bullets(sg_bullets)

        rows.append([
            make_pm_text(pname),
            make_pm_bullets(s_bullets)  if s_bullets  else make_pm_text("—"),
            make_pm_bullets(w_bullets)  if w_bullets  else make_pm_text("—"),
            make_pm_bullets(t_bullets)  if t_bullets  else make_pm_text("—"),
            make_pm_bullets(sg_bullets) if sg_bullets else make_pm_text("—"),
        ])

    if not rows:
        return []

    return [TableBlockModel(
        id=f"b-{_uid()}", provenance=table_prov,
        header=["NAQAAE Pillar", "Strengths", "Weaknesses", "Target State", "Improvement Suggestions"],
        rows=rows,
        caption="Gap Analysis by NAQAAE Pillar",
    )]


# ── Goals builder ─────────────────────────────────────────────────────────────

def build_goals_blocks(goals: list[dict], objectives: list[dict]) -> list[BlockModel]:
    """Strategic goals as bold numbered headings + verbatim objectives as numbered lists.
    NEVER rewrites objective.text — it is already SMART prose with provenance."""
    by_goal: dict[str, list[dict]] = {}
    for obj in objectives:
        by_goal.setdefault(obj["goal_id"], []).append(obj)

    blocks: list[BlockModel] = []
    for n, goal in enumerate(goals, 1):
        gid   = goal["goal_id"]
        title = goal.get("title", "Untitled Goal")
        goal_prov = agent_prov(
            agent="goals_planner",
            finding=goal.get("description") or title,  # VERBATIM
            source="strategic_goals",
        )
        blocks.append(_bold_para(f"Goal {n}: {title}", goal_prov))

        goal_objs = sorted(by_goal.get(gid, []), key=lambda o: o.get("position") or 0)
        if goal_objs:
            per_obj = [
                agent_prov(
                    agent="goals_planner",
                    finding=obj.get("text", ""),     # VERBATIM objective text
                    source="strategic_objectives",
                    pillar_tag=str(obj.get("pillar_id", "")) or None,
                    evidence={
                        "source_swot_ids":     obj.get("source_swot_ids"),
                        "grounded_indicators": obj.get("grounded_indicators"),
                        "tows_type":           obj.get("tows_type"),
                    },
                )
                for obj in goal_objs
            ]
            obj_prov = mixed_prov(per_obj) if len(per_obj) > 1 else per_obj[0]
            blocks.append(_list_blk(
                [obj.get("text", "") for obj in goal_objs],
                obj_prov,
                ordered=True,
            ))

    return blocks


# ── Exec builder ──────────────────────────────────────────────────────────────

def build_exec_blocks(
    actions:              list[dict],
    goals:                list[dict] | None = None,
    objectives:           list[dict] | None = None,
    activity_condense_fn  = None,   # fn(actions: list[dict], job_id: str) → list[dict]
    job_id:               str  = "",
) -> list[BlockModel]:
    """Hierarchical execution plan:
      Goal heading → Objective sub-heading → Activities table per objective.
    Falls back to a flat table when goals/objectives are not provided.
    Timeline and Responsible cells are STRICTLY VERBATIM — never LLM-rewritten.
    Funding column is excluded from the public-facing table (retained in DB for XAI).
    activity_condense_fn condenses activity_text + kpi_name only when provided.
    """
    if not goals or not objectives or not actions:
        return _build_exec_flat(actions, activity_condense_fn=activity_condense_fn, job_id=job_id)

    # Build lookup maps
    objs_by_goal: dict[str, list[dict]] = {}
    for obj in objectives:
        objs_by_goal.setdefault(str(obj.get("goal_id", "")), []).append(obj)

    # Group actions by objective_id first, then goal_id as fallback
    actions_by_obj:  dict[str, list[dict]] = {}
    actions_by_goal: dict[str, list[dict]] = {}
    for a in actions:
        obj_id  = str(a.get("objective_id") or "")
        goal_id = str(a.get("goal_id") or "")
        if obj_id:
            actions_by_obj.setdefault(obj_id, []).append(a)
        elif goal_id:
            actions_by_goal.setdefault(goal_id, []).append(a)

    blocks: list[BlockModel] = []
    used_action_ids: set[str] = set()

    for goal_n, goal in enumerate(goals, 1):
        gid     = str(goal.get("goal_id", ""))
        g_title = (goal.get("title") or "Untitled Goal").strip()
        goal_prov = agent_prov(
            agent="operational_audit",
            finding=goal.get("description") or g_title,  # VERBATIM
            source="strategic_goals",
        )
        blocks.append(_bold_para(f"Goal {goal_n}: {g_title}", goal_prov))

        goal_objs = sorted(objs_by_goal.get(gid, []), key=lambda o: o.get("position") or 0)

        if goal_objs:
            for obj_n, obj in enumerate(goal_objs, 1):
                oid      = str(obj.get("objective_id") or obj.get("id") or "")
                obj_text = (obj.get("text") or "Untitled Objective").strip()
                obj_prov = agent_prov(
                    agent="operational_audit",
                    finding=obj_text,               # VERBATIM — objectives never rewritten
                    source="strategic_objectives",
                    pillar_tag=str(obj.get("pillar_id") or "") or None,
                )
                blocks.append(_bold_para(f"Objective {obj_n}: {obj_text}", obj_prov))

                obj_actions = [a for a in actions_by_obj.get(oid, [])]
                used_action_ids.update(str(a.get("action_id") or id(a)) for a in obj_actions)
                if obj_actions:
                    blocks.append(_build_actions_table(
                        obj_actions, obj_prov,
                        activity_condense_fn=activity_condense_fn, job_id=job_id,
                    ))
        else:
            # No objectives — list actions grouped at the goal level
            goal_actions = [a for a in actions_by_goal.get(gid, [])]
            used_action_ids.update(str(a.get("action_id") or id(a)) for a in goal_actions)
            if goal_actions:
                blocks.append(_build_actions_table(
                    goal_actions, goal_prov,
                    activity_condense_fn=activity_condense_fn, job_id=job_id,
                ))

    # Orphaned actions (not matched to any goal or objective in this run)
    orphans = [
        a for a in actions
        if str(a.get("action_id") or id(a)) not in used_action_ids
        and not a.get("objective_id")
        and not a.get("goal_id")
    ]
    if orphans:
        orphan_prov = agent_prov("operational_audit", "Unassigned activities", "strategic_actions")
        blocks.append(_bold_para("Additional Activities", orphan_prov))
        blocks.append(_build_actions_table(
            orphans, orphan_prov,
            activity_condense_fn=activity_condense_fn, job_id=job_id,
        ))

    return blocks if blocks else _build_exec_flat(
        actions, activity_condense_fn=activity_condense_fn, job_id=job_id,
    )


def _format_cost(cost_egp) -> str:
    """Format cost in EGP thousands (÷1000, no decimals)."""
    if cost_egp is None:
        return "—"
    try:
        return f"{float(cost_egp) / 1000:,.0f}k"
    except (TypeError, ValueError):
        return str(cost_egp)


def _build_actions_table(
    actions:             list[dict],
    prov:                ProvenanceModel,
    activity_condense_fn = None,   # fn(actions, job_id) → list[dict]
    job_id:              str  = "",
) -> TableBlockModel:
    """One activities table for a single objective (or goal fallback).
    activity_condense_fn condenses activity_text + kpi_name only.
    Timeline and Responsible columns are STRICTLY VERBATIM.
    Funding column is excluded from the public-facing table."""
    import logging as _log
    condensed_list: list[dict] | None = None
    table_prov = prov

    if activity_condense_fn and actions:
        try:
            result = activity_condense_fn(actions, job_id)
            if result and len(result) == len(actions):
                condensed_list = result
                verbatim_sample = "; ".join(
                    (a.get("activity_text") or "—")[:60] for a in actions[:2]
                )
                table_prov = agent_prov(
                    agent="chief_editor",
                    finding=verbatim_sample,
                    source="strategic_actions+llm:gemini-2.5-flash",
                    evidence={"editorRefined": True, "condensedFrom": len(actions)},
                )
        except Exception as exc:
            _log.getLogger(__name__).warning("[builders] exec condense failed: %s", exc)

    rows = []
    for i, a in enumerate(actions):
        if condensed_list:
            act_text = (condensed_list[i].get("activity_text") or (a.get("activity_text") or "—")).strip()
            kpi_text = (condensed_list[i].get("kpi_name") or (a.get("kpi_name") or "—")).strip()
        else:
            act_text = (a.get("activity_text") or "—").strip()
            kpi_text = (a.get("kpi_name") or "—").strip()
        rows.append([
            make_pm_text(act_text),
            make_pm_text(kpi_text),
            make_pm_text(
                f"{a.get('start_quarter') or ''}–{a.get('end_quarter') or ''}".strip("–") or "—"
            ),
            make_pm_text((a.get("responsible_exec") or "—").strip()),
            make_pm_text((a.get("responsible_monitor") or "—").strip()),
            make_pm_text(_format_cost(a.get("inflated_cost_egp"))),
        ])

    return TableBlockModel(
        id=f"b-{_uid()}", provenance=table_prov,
        header=["Activity", "KPI", "Timeline", "Responsible (Exec)", "Responsible (Monitor)", "Cost (EGP k)"],
        rows=rows,
    )


def _build_exec_flat(
    actions:             list[dict],
    activity_condense_fn = None,
    job_id:              str  = "",
) -> list[BlockModel]:
    """Fallback: all actions in a single flat table."""
    if not actions:
        return []
    per_action = [
        agent_prov(
            agent="operational_audit",
            finding=f"{a.get('activity_text', '')}: {a.get('kpi_name', '')}",  # VERBATIM
            source="strategic_actions",
            evidence={
                "start_quarter": a.get("start_quarter"),
                "end_quarter":   a.get("end_quarter"),
                "cost_egp":      a.get("inflated_cost_egp"),
            },
        )
        for a in actions
    ]
    prov = mixed_prov(per_action) if len(per_action) > 1 else per_action[0]
    return [_build_actions_table(
        actions, prov,
        activity_condense_fn=activity_condense_fn, job_id=job_id,
    )]
