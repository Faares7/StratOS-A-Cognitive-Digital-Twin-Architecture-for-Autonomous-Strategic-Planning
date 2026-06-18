"""
Node 4 — draft_goals
Objective drafting with deterministic grouping and full provenance.

Within each goal (cluster) the pairs are grouped DETERMINISTICALLY into objective
buckets by (pillar, initiative) — the LLM never decides the grouping:
  • WO / WT pairs cluster on their improvement backbone (same backbone in the same
    pillar → ONE objective, killing the near-duplicate repetition),
  • SO / ST pairs cluster on the external opportunity/threat being addressed.
The key includes the pillar, so an objective can never span two pillars.

The LLM then writes exactly ONE SMART sentence per bucket. It never chooses what
merges, never echoes pair_ids, and never produces indicator ids.

Each objective carries FULL tracing, merged from all the pairs in its bucket:
  • pillar_id            — single (part of the bucket key)
  • grounded_indicators  — every NAQAAE indicator the bucket's pairs point to (+score)
  • source_swot_ids      — union of all source strengths/weaknesses + opportunities/threats
  • tows_types           — the TOWS quadrants represented
"""

from __future__ import annotations

from collections import Counter

from langchain_community.embeddings import OllamaEmbeddings
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel

from core.llm import JSON_GUARDRAIL, local_brain

from .config import (
    ACTION_CORE_DEDUP_THRESHOLD,
    CROSS_PILLAR_DEDUP_THRESHOLD,
    EMBED_MODEL,
    OBJECTIVE_DEDUP_THRESHOLD,
)
from .pairing import _cosine

_ALIGN_RANK = {"indicator": 2, "pillar_only": 1, "strategic": 0}


# ── Output schema (the LLM writes one objective per pre-formed bucket) ─────────

class _Objective(BaseModel):
    bucket_index: int     # which input bucket this objective is for
    text: str             # SMART objective sentence


class _ClusterObjectives(BaseModel):
    objectives: list[_Objective]


# ── Prompt construction ───────────────────────────────────────────────────────

_SYSTEM = (
    "You are a senior strategic planning consultant helping a university produce its "
    "multi-year strategic plan from SWOT analysis. Write in clear, formal English. "
    "Every objective must satisfy SMART criteria (Specific, Measurable, Achievable, "
    "Relevant, Time-bound) with concrete action verbs and quantified targets. "
    "Each objective must concretely address the specific weakness or strength in its "
    "source pairs; when an opportunity is present use it only as the MEANS — never write "
    "a generic employability statement that ignores the specific issue.\n"
    "ACTION-TARGET COHERENCE (critical): the quantified target MUST measure the DIRECT "
    "result of the action you describe. Never staple on a metric the action would not "
    "actually move. For example, do NOT write 'launch an alumni-tracking system ... by "
    "reducing the student-to-full-time-PhD ratio to 1:50' — tracking alumni does not "
    "change that ratio. If a number that appears in the source pair is not something the "
    "action would plausibly cause, drop it and choose a target that genuinely reflects "
    "the action's own outcome (an alumni-tracking system -> share of graduates tracked or "
    "their response rate; a faculty-hiring drive -> the staffing ratio; a training plan -> "
    "share of faculty trained). The verb and the metric must be causally linked.\n"
    "Each input bucket is ONE initiative: write EXACTLY one objective per bucket that "
    "covers all of its pairs, as ONE coherent sentence — never a multi-sentence run-on. "
    "Never reference accreditation standards (e.g. NAQAAE) or indicator numbers in the "
    "objective text."
    + JSON_GUARDRAIL
)


def _fmt_pair(p: dict) -> str:
    lines = [
        f"  type     : {p['tows_type']}",
        f"  {p['internal_type']:9}: {p['internal_text']}",
        f"  {p['external_type']:9}: {p['external_text']}",
    ]
    if p.get("improvement_backbone"):
        lines.append(
            f"  backbone (use as objective core for WO/WT): {p['improvement_backbone']}"
        )
    return "\n".join(lines)


# ── Deterministic objective buckets: group by (pillar, initiative) ─────────────

def _initiative_key(p: dict):
    """The 'initiative' a pair belongs to. WO/WT pairs cluster on their improvement
    backbone (same backbone = same initiative); SO/ST pairs cluster on the external
    opportunity/threat being addressed. A WO/WT pair with no backbone falls back to
    its own pair_id (it can't be safely merged with anything)."""
    if p["tows_type"] in ("WO", "WT"):
        bb = (p.get("improvement_backbone") or "").strip().lower()
        return ("backbone", bb) if bb else ("pair", p["pair_id"])
    return ("opportunity", p["external_item_id"])


def _objective_buckets(pairs: list[dict]) -> list[list[dict]]:
    """Group a goal's pairs into objective buckets by (pillar, initiative), fully
    deterministically — the LLM never decides this. Guarantees:
      • same backbone in the same pillar → ONE objective (no near-duplicates),
      • an objective never spans two pillars (the key includes the pillar).
    Returns buckets in first-seen order."""
    buckets: dict[tuple, list[dict]] = {}
    order: list[tuple] = []
    for p in pairs:
        key = (p.get("pillar_id"), p.get("pillar_name") or "General", _initiative_key(p))
        if key not in buckets:
            buckets[key] = []
            order.append(key)
        buckets[key].append(p)
    return [buckets[k] for k in order]


def _fallback_text(p: dict) -> str:
    """Deterministic objective text used only when the LLM drops a pair."""
    if p.get("improvement_backbone"):
        return p["improvement_backbone"]
    if p.get("internal_type") == "strength":
        return f"Leverage {p['internal_text']} to seize the opportunity: {p['external_text']}."
    return f"Address {p['internal_text']} in light of {p['external_text']}."


# ── One LLM call per goal (writes one objective per deterministic bucket) ──────

def _fmt_bucket(idx: int, pairs: list[dict]) -> str:
    pillar = pairs[0].get("pillar_name") or "General"
    pairs_fmt = "\n".join(_fmt_pair(p) for p in pairs)
    return f"[Bucket {idx}]  area: {pillar}\n{pairs_fmt}"


def _draft_cluster(theme_name: str, buckets: list[list[dict]]) -> list[_Objective]:
    """ONE structured LLM call for the whole goal. The buckets are pre-formed
    deterministically; the model only writes ONE SMART sentence per bucket."""
    body = "\n\n".join(_fmt_bucket(i, grp) for i, grp in enumerate(buckets))
    human = HumanMessage(content=(
        f"Strategic goal: {theme_name}\n\n"
        f"The TOWS pairs are pre-grouped into {len(buckets)} buckets. Each bucket is ONE "
        "initiative and must become EXACTLY one SMART objective covering all its pairs:\n"
        "  - WO / WT: the backbone is the direction; enrich it with the external context.\n"
        "  - SO / ST: leverage the strength(s) to seize the opportunity or mitigate the threat.\n"
        "  - One coherent sentence with a quantified target and timeframe, where the target "
        "measures the result of THIS bucket's action (causally linked — never an unrelated "
        "metric borrowed from the source text).\n"
        "  - Set bucket_index to the bucket number; produce one objective for EVERY bucket.\n\n"
        f"{body}"
    ))
    llm = local_brain.with_structured_output(_ClusterObjectives)
    return llm.invoke([SystemMessage(content=_SYSTEM), human]).objectives


# ── Enrichment (merge prose with deterministic provenance from all covered pairs)

def _enrich_objective(text: str, pair_ids: list[str],
                      pair_by_id: dict[str, dict]) -> dict:
    pairs = [pair_by_id[pid] for pid in pair_ids if pid in pair_by_id]
    if not pairs:
        return {
            "pair_id": pair_ids[0] if pair_ids else "",
            "pair_ids": pair_ids,
            "text": text,
            "tows_type": "SO", "tows_types": ["SO"],
            "alignment": "strategic", "pillar_id": None,
            "grounded_indicator_id": None, "grounding_score": None,
            "grounded_indicators": [], "source_swot_ids": [],
            "improvement_source": None,
        }

    # Union of source SWOT items (strengths/weaknesses + opportunities/threats).
    source_swot_ids: list[str] = []
    for p in pairs:
        for sid in (p["internal_item_id"], p["external_item_id"]):
            if sid not in source_swot_ids:
                source_swot_ids.append(sid)

    # Every distinct indicator these pairs point to, strongest first.
    indicators: list[dict] = []
    seen: set[str] = set()
    for p in pairs:
        iid = p.get("grounded_indicator_id")
        if iid and iid not in seen:
            seen.add(iid)
            indicators.append({"indicator_id": iid, "grounding_score": p.get("grounding_score")})
    indicators.sort(key=lambda d: (d["grounding_score"] or 0.0), reverse=True)
    primary = indicators[0] if indicators else None

    alignment = max((p.get("alignment") or "strategic" for p in pairs),
                    key=lambda a: _ALIGN_RANK.get(a, 0))
    tows_types = sorted({p["tows_type"] for p in pairs})
    tows_type = Counter(p["tows_type"] for p in pairs).most_common(1)[0][0]
    pillar_id = next((p.get("pillar_id") for p in pairs if p.get("pillar_id") is not None), None)
    improvement_source = next(
        (p.get("improvement_backbone") for p in pairs if p.get("improvement_backbone")), None
    )

    return {
        "pair_id": pair_ids[0],            # representative — keeps validation's check working
        "pair_ids": list(pair_ids),
        "text": text,
        "tows_type": tows_type,
        "tows_types": tows_types,
        "alignment": alignment,
        "pillar_id": pillar_id,
        "grounded_indicator_id": primary["indicator_id"] if primary else None,
        "grounding_score": primary["grounding_score"] if primary else None,
        "grounded_indicators": indicators,
        "source_swot_ids": source_swot_ids,
        "improvement_source": improvement_source,
    }


# ── Build one goal (deterministic buckets → one LLM sentence each → enrich) ─────

def _build_goal(cluster: dict, pair_by_id: dict[str, dict]) -> dict:
    theme = cluster.get("theme_name") or f"Goal {cluster['cluster_id']}"
    buckets = _objective_buckets(cluster["pairs"])

    try:
        drafted = _draft_cluster(theme, buckets)
    except Exception as exc:
        print(f"[drafting] cluster {cluster['cluster_id']} draft failed ({exc}); "
              f"deterministic fallback text.")
        drafted = []
    text_by_idx = {o.bucket_index: o.text for o in drafted}

    # Exactly one objective per bucket — coverage is guaranteed by construction.
    objectives: list[dict] = []
    for idx, grp in enumerate(buckets):
        pair_ids = [p["pair_id"] for p in grp]
        text = (text_by_idx.get(idx) or "").strip() or _fallback_text(grp[0])
        objectives.append(_enrich_objective(text, pair_ids, pair_by_id))

    return {
        "cluster_id":  cluster["cluster_id"],
        "title":       cluster.get("theme_name") or "",
        "description": cluster.get("theme_description") or "",
        "pillar_ids":  cluster.get("pillar_ids") or [],
        "objectives":  objectives,
    }


# ── Plan-wide objective dedup (hybrid: initiative identity + action-core + text) ─

# Cues that mark the start of an objective's measurable-result / timeframe clause.
# Trimming there leaves the ACTION, so dedup compares what is done — not the program
# name or quantified target glued on the end (which differ across program variants).
_RESULT_CUES = (
    ", resulting in", ", achieving", ", ensuring", ", leading to", ", reducing",
    ", increasing", " within the next", " within two", " within three",
    " within the", " by increasing", " by reducing", " by achieving",
)


def _action_core(text: str) -> str:
    """The action clause of an objective with its trailing result/timeframe clause
    removed, so program/metric variation can't hide that two objectives are the same
    initiative. The whole remaining clause is kept (NOT truncated to a prefix): the
    LLM often reorders clauses — leading with the action in one objective and with the
    goal in another — and a prefix cut would capture different words for each. Keeping
    the full clause lets the order-robust sentence embedding see they are the same."""
    low = text.lower()
    cut = len(text)
    for cue in _RESULT_CUES:
        i = low.find(cue)
        if i != -1:
            cut = min(cut, i)
    core = text[:cut].strip()
    return core if core else text


def _merge_into(keep: dict, drop: dict) -> None:
    """Fold drop's provenance into keep (union SWOT ids, indicators, TOWS types,
    pair ids); keep's text is retained. On a cross-pillar merge the stronger-grounded
    pillar becomes primary. Recomputes the primary indicator so the strongest grounding
    still surfaces after the merge."""
    # Stronger-grounded pillar wins as primary (no-op when both share a pillar).
    if drop.get("pillar_id") is not None and \
            (drop.get("grounding_score") or 0.0) > (keep.get("grounding_score") or 0.0):
        keep["pillar_id"] = drop["pillar_id"]

    for sid in drop.get("source_swot_ids", []):
        if sid not in keep["source_swot_ids"]:
            keep["source_swot_ids"].append(sid)

    seen = {d["indicator_id"] for d in keep.get("grounded_indicators", [])}
    for d in drop.get("grounded_indicators", []):
        if d["indicator_id"] not in seen:
            seen.add(d["indicator_id"])
            keep["grounded_indicators"].append(d)
    keep["grounded_indicators"].sort(key=lambda d: (d["grounding_score"] or 0.0), reverse=True)
    if keep["grounded_indicators"]:
        keep["grounded_indicator_id"] = keep["grounded_indicators"][0]["indicator_id"]
        keep["grounding_score"]       = keep["grounded_indicators"][0]["grounding_score"]

    keep["tows_types"] = sorted(set(keep.get("tows_types", [])) | set(drop.get("tows_types", [])))
    for pid in drop.get("pair_ids", []):
        if pid not in keep.setdefault("pair_ids", []):
            keep["pair_ids"].append(pid)
    if not keep.get("improvement_source"):
        keep["improvement_source"] = drop.get("improvement_source")
    keep["alignment"] = max(
        keep.get("alignment", "strategic"), drop.get("alignment", "strategic"),
        key=lambda a: _ALIGN_RANK.get(a, 0),
    )


def _should_merge(c: dict, k: dict, full_c, full_k, core_c, core_k) -> bool:
    """True if candidate objective `c` is the same as already-kept `k`:
      1. identity     — same improvement backbone in the same pillar,
      2. action-core  — same pillar AND near-identical action clause (program variants),
      3. cross-pillar — DIFFERENT pillars but a NEAR-VERBATIM action clause (stricter gate,
                        so true twins collapse but genuine scope variants stay separate),
      4. safety net   — near-verbatim full sentence (any pillar).
    """
    same_pillar = c.get("pillar_id") is not None and c.get("pillar_id") == k.get("pillar_id")
    core_sim = _cosine(core_c, core_k)
    if same_pillar:
        bb_c = (c.get("improvement_source") or "").strip().lower()
        bb_k = (k.get("improvement_source") or "").strip().lower()
        if bb_c and bb_c == bb_k:
            return True
        if core_sim >= ACTION_CORE_DEDUP_THRESHOLD:
            return True
    elif core_sim >= CROSS_PILLAR_DEDUP_THRESHOLD:
        return True
    return _cosine(full_c, full_k) >= OBJECTIVE_DEDUP_THRESHOLD


def _dedup_objectives(goals: list[dict]) -> list[dict]:
    """Plan-wide dedup. Walks every objective in plan order; if it matches an
    already-kept objective (same backbone, same-pillar action-core, or near-verbatim
    text) it is merged into that one (provenance unioned) rather than dropped, so no
    traceability is lost and a clone split across two goals collapses to a single
    objective under the first goal it appeared in."""
    flat = [(g, o) for g in goals for o in g["objectives"]]
    if not flat:
        return goals

    emb        = OllamaEmbeddings(model=EMBED_MODEL)
    full_vecs  = emb.embed_documents([o["text"] for _, o in flat])
    core_vecs  = emb.embed_documents([_action_core(o["text"]) for _, o in flat])

    kept: list[tuple[dict, dict, list, list]] = []   # (goal, obj, full_vec, core_vec)
    merged = 0
    for (g, o), fv, cv in zip(flat, full_vecs, core_vecs):
        target = next((ko for (_, ko, kfv, kcv) in kept
                       if _should_merge(o, ko, fv, kfv, cv, kcv)), None)
        if target is not None:
            _merge_into(target, o)
            merged += 1
        else:
            kept.append((g, o, fv, cv))

    if merged:
        print(f"[drafting] merged {merged} duplicate objective(s) plan-wide "
              f"({len(flat)} -> {len(kept)})")

    by_goal: dict[int, list[dict]] = {}
    for (g, o, _, _) in kept:
        by_goal.setdefault(id(g), []).append(o)
    for g in goals:
        g["objectives"] = by_goal.get(id(g), [])
        if not g["objectives"]:
            print(f"[drafting] WARNING: goal {g.get('cluster_id')} '{g.get('title')}' "
                  f"has no objectives left after dedup (all were duplicates of other goals).")
    return goals


# ── Main entry point ──────────────────────────────────────────────────────────

def draft_all_goals(clusters: list[dict]) -> list[dict]:
    """
    Draft SMART objectives for every cluster, grouped by pillar with full provenance.
    A single cluster failing is logged and skipped so it can't take down the plan.
    """
    if not clusters:
        return []

    pair_by_id: dict[str, dict] = {
        p["pair_id"]: p for c in clusters for p in c["pairs"]
    }

    goals: list[dict] = []
    for cluster in clusters:
        try:
            goals.append(_build_goal(cluster, pair_by_id))
        except Exception as exc:
            print(f"[drafting] cluster {cluster.get('cluster_id')} failed ({exc}); skipping.")

    return _dedup_objectives(goals)
