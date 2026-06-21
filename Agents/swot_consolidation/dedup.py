"""
Dedup / canonicalization.

Cross-run text is not stable (tech regenerates ids/text every run; sentiment
relabels), so dedup is SEMANTIC. Reuses the goals_planner Leiden primitives
(`_knn_graph`, `_leiden`) but NOT its goal-band resolution selector — that one is
tuned to land 5–8 *goals*. For dedup we want tight "same-thing" clusters, so the
resolution is chosen by a COVERAGE HEURISTIC (decision #4): the lowest resolution
(most merging) whose merges stay PURE — i.e. the pairs it places together are
genuinely near-duplicates.

Each call clusters ONE namespace (a single pillar+type, or a single external type);
callers never mix namespaces.
"""

from __future__ import annotations

import numpy as np
from langchain_community.embeddings import OllamaEmbeddings

# Reuse the validated graph + community-detection primitives from the goals planner.
from Agents.goals_planner.clustering import _knn_graph, _leiden

from .config import (
    DEDUP_DUP_SIM,
    DEDUP_KNN,
    DEDUP_MIN_PURITY,
    DEDUP_NEAR_DUP,
    DEDUP_RES_GRID,
    EMBED_MODEL,
)


def _item_text(it: dict) -> str:
    # Prefer the style-neutral concept phrase (Fix 1) so cross-agent / cross-altitude
    # items cluster; fall back to raw text if normalization was skipped.
    concept = (it.get("concept_text") or "").strip()
    if concept:
        return concept
    title = (it.get("title") or "").strip()
    desc = (it.get("description") or "").strip()
    return f"{title} — {desc}" if title and title != desc else (desc or title)


def _embed(items: list[dict]) -> np.ndarray:
    """Embed each item, L2-normalised so dot == cosine."""
    texts = [_item_text(it) for it in items]
    X = np.asarray(OllamaEmbeddings(model=EMBED_MODEL).embed_documents(texts), dtype=float)
    norms = np.linalg.norm(X, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return X / norms


def _coverage_purity(sim: np.ndarray, labels: list[int]) -> tuple[float, float]:
    """For all node-pairs that ARE near-duplicates (cosine ≥ DEDUP_DUP_SIM):
        coverage = fraction placed in the same cluster (did we catch the dups?)
    For all pairs we PLACED together:
        purity   = fraction that are genuinely near-duplicates (did we over-merge?)
    """
    n = sim.shape[0]
    dup_total = same_dup = placed_total = placed_dup = 0
    for i in range(n):
        for j in range(i + 1, n):
            is_dup = sim[i, j] >= DEDUP_DUP_SIM
            together = labels[i] == labels[j]
            if is_dup:
                dup_total += 1
                if together:
                    same_dup += 1
            if together:
                placed_total += 1
                if is_dup:
                    placed_dup += 1
    coverage = (same_dup / dup_total) if dup_total else 1.0
    purity = (placed_dup / placed_total) if placed_total else 1.0
    return coverage, purity


def _select_resolution(sim: np.ndarray, edges, weights, n: int) -> list[int]:
    """Coverage heuristic: sweep resolutions; among those whose merge purity clears
    DEDUP_MIN_PURITY pick the best F1(coverage, purity); if none are pure enough,
    fall back to the highest resolution (finest split — safest against over-merge)."""
    best = None  # (f1, labels)
    fallback = None  # (resolution, labels) at the finest split
    for res in DEDUP_RES_GRID:
        labels = _leiden(n, edges, weights, res)
        cov, pur = _coverage_purity(sim, labels)
        if fallback is None or res >= fallback[0]:
            fallback = (res, labels)
        if pur >= DEDUP_MIN_PURITY:
            f1 = (2 * cov * pur / (cov + pur)) if (cov + pur) else 0.0
            if best is None or f1 > best[0]:
                best = (f1, labels)
    if best is not None:
        return best[1]
    print("[swot-consolidation] dedup: no resolution met the purity floor; "
          "using the finest split (no merging risk).")
    return fallback[1]


def cluster_namespace(items: list[dict]) -> list[dict]:
    """
    Cluster one namespace's items into canonical clusters.

    Returns a list of cluster dicts:
        { "members": [...], "title": str|None, "description": str, "embedding": np.ndarray }
    The canonical title/description come from the cluster MEDOID (the member most
    central to its cluster); `embedding` is that medoid's vector.
    """
    if not items:
        return []
    if len(items) == 1:
        return [_make_cluster(items, _embed(items)[0])]

    X = _embed(items)
    sim = X @ X.T
    edges, weights = _knn_graph(X, knn=min(DEDUP_KNN, len(items) - 1))
    labels = _select_resolution(sim, edges, weights, len(items))
    buckets = _components(labels, sim)        # Leiden groups + near-dup force-merge (Fix 5)

    clusters: list[dict] = []
    for member_idx in buckets.values():
        sub_sim = sim[np.ix_(member_idx, member_idx)]
        medoid_local = int(np.argmax(sub_sim.sum(axis=1)))   # most central member
        medoid_global = member_idx[medoid_local]
        clusters.append(_make_cluster(
            [items[i] for i in member_idx], X[medoid_global], medoid=items[medoid_global]
        ))
    return clusters


def _components(labels: list[int], sim: np.ndarray) -> dict[int, list[int]]:
    """Union-find over items: merge by shared Leiden label AND by near-duplicate cosine
    (≥ DEDUP_NEAR_DUP). The near-dup edges guarantee identical/near-identical items never
    survive as separate clusters even if Leiden's resolution split them (Fix 5)."""
    n = len(labels)
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    by_label: dict[int, list[int]] = {}
    for i, lab in enumerate(labels):
        by_label.setdefault(lab, []).append(i)
    for members in by_label.values():
        for k in range(1, len(members)):
            union(members[0], members[k])

    for i in range(n):
        for j in range(i + 1, n):
            if sim[i, j] >= DEDUP_NEAR_DUP:
                union(i, j)

    comps: dict[int, list[int]] = {}
    for i in range(n):
        comps.setdefault(find(i), []).append(i)
    return comps


def _make_cluster(members: list[dict], embedding: np.ndarray, medoid: dict | None = None) -> dict:
    med = medoid or members[0]
    return {
        "members": members,
        "title": med.get("title"),
        "description": med.get("description", ""),
        "embedding": np.asarray(embedding, dtype=float),
    }
