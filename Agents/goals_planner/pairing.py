"""
Node 1 — pair_tows
Build and cosine-score TOWS pairs from SWOT items.
No LLM. No Neo4j. Pure Postgres data + bge-m3 embeddings.
"""

from __future__ import annotations

import math
import uuid

from langchain_community.embeddings import OllamaEmbeddings

from core.llm import safe_embed_documents, safe_embed_texts
from .config import EMBED_MODEL, PAIR_THRESHOLD, TOP_K_EXTERNAL
from .mock_improvements import get_improvement_for_weakness

# ── Helpers ───────────────────────────────────────────────────────────────────

def _cosine(a: list[float], b: list[float]) -> float:
    dot    = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    result = dot / (norm_a * norm_b)
    return result if math.isfinite(result) else 0.0


def _item_text(item: dict) -> str:
    # Description only — the description already restates the title, so
    # concatenating both double/triple-counts the evaluative adjective
    # ("Excellent"/"Poor"/…) and makes embeddings cluster by sentiment polarity
    # instead of domain. Title is used only as a fallback when description is empty.
    desc  = (item.get("description") or "").strip()
    title = (item.get("title") or "").strip()
    return desc if desc else title


def _tows_type(internal_type: str, external_type: str) -> str:
    mapping = {
        ("strength",  "opportunity"): "SO",
        ("strength",  "threat"):      "ST",
        ("weakness",  "opportunity"): "WO",
        ("weakness",  "threat"):      "WT",
    }
    key = (internal_type, external_type)
    if key not in mapping:
        raise ValueError(f"Invalid TOWS combination: {internal_type} × {external_type}")
    return mapping[key]


# ── Public entry point ────────────────────────────────────────────────────────

def build_pairs(swot_items: list[dict]) -> list[dict]:
    """
    Embed all SWOT items, build TOWS pairs (internal × external only),
    score by cosine, prune below PAIR_THRESHOLD, keep top-K external per internal.

    Returns a list of pair dicts; each carries a stable `pair_id` derived
    deterministically from its two source item_ids.
    Grounding fields (alignment, grounded_indicator_id, …) are initialised
    to None — Node 2 fills them in.
    """
    internal = [i for i in swot_items if i["type"] in ("strength", "weakness")]
    external = [i for i in swot_items if i["type"] in ("opportunity", "threat")]

    if not internal or not external:
        return []

    embedder = OllamaEmbeddings(model=EMBED_MODEL)

    int_texts = [_item_text(i) for i in internal]
    ext_texts = [_item_text(e) for e in external]

    int_embeds = safe_embed_documents(embedder, int_texts)
    ext_embeds = safe_embed_documents(embedder, ext_texts)

    # ── Build ALL raw scores (no filtering yet) ──────────────────────────────
    # raw_all: list of (internal_item, external_item, score) for every combination
    raw_all: list[tuple[dict, dict, float]] = []
    for int_item, int_emb in zip(internal, int_embeds):
        for ext_item, ext_emb in zip(external, ext_embeds):
            score = _cosine(int_emb, ext_emb)
            raw_all.append((int_item, ext_item, score))

    # ── Debug: print ALL raw pairs before any filtering ───────────────────────
    col = 32
    raw_sorted = sorted(raw_all, key=lambda t: t[2], reverse=True)
    print("\n" + "─" * 95)
    print(f"  RAW TOWS PAIRS  ({len(raw_sorted)} combinations)  "
          f"threshold={PAIR_THRESHOLD}  top_k={TOP_K_EXTERNAL}")
    print("─" * 95)
    print(f"  {'KEEP':<5}  {'TYPE':<4}  {'SCORE':>6}  {'INTERNAL':<{col}}  {'EXTERNAL':<{col}}")
    print("─" * 95)
    # track which will survive threshold (top-k check is per-internal so mark provisionally)
    threshold_survivors: set[tuple] = set()
    for int_item, int_emb in zip(internal, int_embeds):
        top = sorted(
            [(e, _cosine(int_emb, ee)) for e, ee in zip(external, ext_embeds)],
            key=lambda t: t[1], reverse=True,
        )
        top_filtered = [(e, s) for e, s in top if s >= PAIR_THRESHOLD][:TOP_K_EXTERNAL]
        for ext_item, _ in top_filtered:
            threshold_survivors.add(
                (str(int_item["item_id"]), str(ext_item["item_id"]))
            )
    for int_item, ext_item, score in raw_sorted:
        key  = (str(int_item["item_id"]), str(ext_item["item_id"]))
        keep = "✓" if key in threshold_survivors else "✗"
        tows_label = _tows_type(int_item["type"], ext_item["type"])
        int_txt = (_item_text(int_item) or "")[:col].ljust(col)
        ext_txt = (_item_text(ext_item) or "")[:col].ljust(col)
        print(f"  {keep:<5}  {tows_label:<4}  {score:>6.4f}  {int_txt}  {ext_txt}")
    kept = len(threshold_survivors)
    dropped = len(raw_sorted) - kept
    print("─" * 95)
    print(f"  kept={kept}  dropped={dropped}  "
          f"(threshold<{PAIR_THRESHOLD} or outside top-{TOP_K_EXTERNAL} per internal)\n")

    # ── Now build the kept pairs ──────────────────────────────────────────────
    pairs: list[dict] = []
    for int_item, int_emb in zip(internal, int_embeds):
        scored: list[tuple[float, dict]] = []
        for ext_item, ext_emb in zip(external, ext_embeds):
            score = _cosine(int_emb, ext_emb)
            if score >= PAIR_THRESHOLD:
                scored.append((score, ext_item))

        scored.sort(key=lambda t: t[0], reverse=True)
        scored = scored[:TOP_K_EXTERNAL]

        for score, ext_item in scored:
            tows = _tows_type(int_item["type"], ext_item["type"])

            improvement_backbone: str | None = None
            if int_item["type"] == "weakness":
                improvement_backbone = get_improvement_for_weakness(
                    int_item.get("pillar_name") or "",
                    _item_text(int_item),
                )

            pair_seed = f"{int_item['item_id']}::{ext_item['item_id']}"
            pair_id   = str(uuid.uuid5(uuid.NAMESPACE_URL, pair_seed))

            pairs.append({
                "pair_id":   pair_id,
                "tows_type": tows,
                "cosine_score": score,
                "internal_item_id": str(int_item["item_id"]),
                "internal_type":    int_item["type"],
                "internal_text":    _item_text(int_item),
                "pillar_id":        int_item.get("pillar_id"),
                "pillar_name":      int_item.get("pillar_name"),
                "external_item_id": str(ext_item["item_id"]),
                "external_type":    ext_item["type"],
                "external_text":    _item_text(ext_item),
                "improvement_backbone": improvement_backbone,
                "alignment":              None,
                "grounded_indicator_id":  None,
                "grounding_score":        None,
                "indicator_text":         None,
            })

    return pairs
