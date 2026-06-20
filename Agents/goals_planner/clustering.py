"""
Node 3 — cluster_into_goals
Group grounded TOWS pairs into strategic themes (الغايات) via Leiden community
detection on a semantic similarity graph, then label each theme with ONE LLM call.

Flow inside this node:
    embed INTERNAL text (bge-m3) → k-NN cosine similarity graph → Leiden with a
    DYNAMICALLY-selected resolution (the best-separated stable partition whose
    goal-count is in [MIN_GOALS, MAX_GOALS]) → one batched LLM call that gives
    each theme a mutually-DISTINCT title/description.

Design decisions (validated by benchmarking five architectures on real data):
  • Embed INTERNAL text only — the handful of repeated opportunities
    ("AI assistants", "skills frameworks") otherwise act as hubs that collapse
    unrelated pairs into one theme. The external text stays on every pair dict
    and is still used by drafting; we only change what *clustering* sees.
  • The LLM LABELS, it never groups — LLM-led grouping dropped ~32% of pairs in
    testing. Grouping is done by Leiden (reproducible, modularity-scored).
  • Resolution is not hard-coded; it is selected per run, so granularity adapts
    to the dataset. The only knob is the semantic goal band in config.py.

Each pair keeps all of its fields (grounding metadata, external text); clustering
only *groups* them, so drafting / validation / persistence are unaffected.
"""

from __future__ import annotations

import numpy as np
from langchain_community.embeddings import OllamaEmbeddings

from core.llm import JSON_GUARDRAIL, local_brain

from .config import (
    CLUSTER_KNN,
    CLUSTER_SCALE_WARN,
    EMBED_MODEL,
    MAX_GOALS,
    MIN_GOALS,
)

# Resolution grid swept by the dynamic selector.
_RES_GRID = (0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.5, 3.0)
# A partition must persist over at least this many grid steps to count as "stable".
_STABLE_MIN = 2


# ── Embedding ──────────────────────────────────────────────────────────────────

def _embed_internal(pairs: list[dict]) -> np.ndarray:
    """Embed each pair by its INTERNAL text only, L2-normalised so dot == cosine."""
    texts = [(p.get("internal_text") or p.get("external_text") or "") for p in pairs]
    X = np.asarray(OllamaEmbeddings(model=EMBED_MODEL).embed_documents(texts), dtype=float)
    norms = np.linalg.norm(X, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return X / norms


# ── Similarity graph ─────────────────────────────────────────────────────────

def _knn_graph(X: np.ndarray, knn: int):
    """Symmetric k-NN cosine graph. Each node connects to its `knn` most-similar
    nodes; k-NN (not a flat threshold) keeps the graph connected without one giant
    hub component. Returns (edges, weights)."""
    n = X.shape[0]
    sim = X @ X.T
    np.fill_diagonal(sim, -1.0)              # never self-connect
    edge_w: dict[tuple[int, int], float] = {}
    for i in range(n):
        for j in np.argsort(sim[i])[::-1][:knn]:
            j = int(j)
            a, b = (i, j) if i < j else (j, i)
            edge_w[(a, b)] = max(edge_w.get((a, b), 0.0), float(sim[i, j]))
    return list(edge_w.keys()), list(edge_w.values())


# ── Leiden + dynamic resolution ────────────────────────────────────────────────

def _leiden(n: int, edges, weights, resolution: float) -> list[int]:
    """Leiden community detection (modularity-style objective). Discovers the
    number of communities itself; deterministic via fixed seed. Hard dependency
    on leidenalg+igraph (see Requirements.txt) — no silent fallback."""
    import igraph as ig
    import leidenalg

    g = ig.Graph(n=n, edges=edges)
    g.es["weight"] = weights
    part = leidenalg.find_partition(
        g, leidenalg.RBConfigurationVertexPartition,
        weights="weight", resolution_parameter=resolution, seed=42,
    )
    return list(part.membership)


def _silhouette(X: np.ndarray, labels: list[int]) -> float | None:
    from sklearn.metrics import silhouette_score
    if len(set(labels)) < 2:
        return None
    try:
        return float(silhouette_score(X, labels, metric="cosine"))
    except Exception:
        return None


def _select_resolution(X: np.ndarray, edges, weights) -> list[int]:
    """Choose the resolution per-run instead of hard-coding it.

    Sweep the grid; a community count that persists over >= _STABLE_MIN
    consecutive resolutions is 'stable' (a natural scale, not a lucky value).

    Tiers, in order:
      1. stable AND in [MIN_GOALS, MAX_GOALS]      → best silhouette (the ideal).
      2. no stable in band, but stable EXISTS      → nearest stable partition
         anywhere on the grid (band becomes a soft preference). Stability beats
         silhouette here: a persistent count is a real scale, whereas a high-
         silhouette singleton-heavy split is just fragmentation. This is what
         keeps sparse-theme data from being force-split up to MAX_GOALS.
      3. in band, no stability anywhere            → best silhouette in band.
      4. nothing in band at all                    → count closest to midpoint.
    Returns the chosen label assignment.
    """
    n = X.shape[0]
    rows = []  # (res, labels, count, silhouette)
    for res in _RES_GRID:
        labels = _leiden(n, edges, weights, res)
        rows.append((res, labels, len(set(labels)), _silhouette(X, labels)))

    # Contiguous plateaus → width per row.
    plateaus, i = [], 0
    while i < len(rows):
        j = i
        while j + 1 < len(rows) and rows[j + 1][2] == rows[i][2]:
            j += 1
        plateaus.append((i, j))
        i = j + 1
    width_of = {k: (e - s + 1) for (s, e) in plateaus for k in range(s, e + 1)}

    def sil(k: int) -> float:
        return rows[k][3] if rows[k][3] is not None else -1.0

    # Tier 1 — stable AND in band: the ideal. Best silhouette among them.
    stable = [k for k in range(len(rows))
              if MIN_GOALS <= rows[k][2] <= MAX_GOALS and width_of[k] >= _STABLE_MIN]
    if stable:
        k = max(stable, key=sil)
        print(f"[cluster] Leiden auto-resolution={rows[k][0]} -> {rows[k][2]} goals "
              f"(silhouette={sil(k):.4f})")
        return rows[k][1]

    # Tier 2 — no stable partition in band, but a stable scale exists elsewhere on
    # the grid: take the NEAREST stable partition even if slightly out of band. The
    # band is a soft preference; stability is the real signal. Tie-break prefers the
    # SMALLER count so it resolves toward the coherent scale, never the fragmented
    # singleton-split (which silhouette alone would have chosen).
    stable_any = [k for k in range(len(rows))
                  if width_of[k] >= _STABLE_MIN and rows[k][2] >= 2]
    if stable_any:
        def band_dist(k: int) -> int:
            c = rows[k][2]
            if MIN_GOALS <= c <= MAX_GOALS:
                return 0
            return min(abs(c - MIN_GOALS), abs(c - MAX_GOALS))
        k = min(stable_any, key=lambda k: (band_dist(k), rows[k][2]))
        print(f"[cluster] no STABLE partition within [{MIN_GOALS},{MAX_GOALS}] goals; "
              f"used the nearest stable scale: {rows[k][2]} goals at res={rows[k][0]} "
              f"(silhouette={sil(k):.4f}). The data's natural structure is {rows[k][2]} "
              f"themes — widen/narrow the band in config.py to prefer more/fewer goals.")
        return rows[k][1]

    # Tier 3 — in band but no stable scale anywhere: best silhouette in band (this
    # CAN fragment; it only fires when the data has no persistent structure at all).
    in_band = [k for k in range(len(rows)) if MIN_GOALS <= rows[k][2] <= MAX_GOALS]
    if in_band:
        k = max(in_band, key=sil)
        print(f"[cluster] WARNING: no STABLE partition anywhere; picked {rows[k][2]} goals "
              f"at res={rows[k][0]} on silhouette alone — sensitive to the resolution "
              f"parameter. If the dataset has grown, revisit MIN_GOALS / MAX_GOALS / "
              f"CLUSTER_KNN in config.py.")
        return rows[k][1]

    # Tier 4 — no count lands in band anywhere: fall back to whatever sits closest
    # to the band midpoint (data has drifted far from the configured band).
    counts = [r[2] for r in rows]
    target = (MIN_GOALS + MAX_GOALS) // 2
    k = min(range(len(rows)), key=lambda i: (abs(rows[i][2] - target), -sil(i)))
    print(f"[cluster] WARNING: NO partition with {MIN_GOALS}-{MAX_GOALS} goals exists "
          f"anywhere on the resolution grid (counts ranged {min(counts)}..{max(counts)}). "
          f"The data has likely drifted in size or structure. Fell back to {rows[k][2]} "
          f"goals at res={rows[k][0]} — re-tune the goal band or CLUSTER_KNN in config.py.")
    return rows[k][1]


# ── Grouping ───────────────────────────────────────────────────────────────────

def _pillar_ids(pairs: list[dict]) -> list[int]:
    return sorted({p["pillar_id"] for p in pairs if p.get("pillar_id")})


def _group(pairs: list[dict], labels: list[int]) -> dict[int, list[dict]]:
    """Bucket pairs by community label, then renumber 0..k-1 by descending size
    so cluster ids are stable and readable."""
    raw: dict[int, list[dict]] = {}
    for p, lab in zip(pairs, labels):
        raw.setdefault(lab, []).append(p)
    ordered = sorted(raw.values(), key=len, reverse=True)
    return {cid: members for cid, members in enumerate(ordered)}


# ── Joint LLM labeling (the ONLY LLM call here; it labels, never groups) ───────

def _label_clusters(groups: dict[int, list[dict]]) -> dict[int, tuple[str, str]]:
    """One batched call names every cluster at once. Titles must FAITHFULLY reflect
    each cluster's actual pairs (no invented themes) and be outcome-oriented; thin
    1-2 pair clusters are named after their specific subject rather than inflated.
    Returns {cluster_id: (theme_name, theme_description)}; empty dict on failure
    (callers fall back to drafting-supplied titles)."""
    from langchain_core.messages import HumanMessage, SystemMessage
    from pydantic import BaseModel

    class _Theme(BaseModel):
        cluster_id: int
        theme_name: str
        theme_description: str

    class _Themes(BaseModel):
        themes: list[_Theme]

    body = "\n\n".join(
        f"Cluster {cid} ({len(ms)} pairs):\n"
        + "\n".join(f"  - [{m['tows_type']}] {(m.get('internal_text') or '')[:80]}"
                    for m in ms[:12])
        for cid, ms in groups.items()
    )
    system = (
        "You are a senior university strategic-planning consultant writing the goals "
        "(الغايات) of a multi-year strategic plan. For each cluster, write a title and a "
        "one-sentence description that FAITHFULLY summarise the pairs in THAT cluster.\n"
        "ABSOLUTE RULE: never introduce a theme, topic, or word that does not appear in "
        "the cluster's pairs. For example, do NOT title a cluster about tuition and PhD "
        "ratios 'Wellness'. The title must be about what the pairs are genuinely about.\n"
        "  - title: 4 to 9 words naming the strategic direction of this cluster's ACTUAL "
        "content. Phrase it as a positive outcome (lead with Strengthen, Expand, Elevate, "
        "Build, Advance, Modernize, Improve, Embed) rather than a problem label — but the "
        "outcome must match the content. If a cluster has only one or two pairs, name it "
        "SPECIFICALLY after that subject; do NOT inflate it into a broad invented theme.\n"
        "  - description: one sentence stating the concrete aim, grounded in the cluster's "
        "pairs. Never begin with 'Strategies related to' and never merely restate the title.\n"
        "Make titles distinct WHEN the content differs, but accuracy to the content always "
        "wins — never invent a difference just to look distinct from another cluster.\n"
        "Examples (problem -> faithful outcome title):\n"
        "  reliance on part-time PhDs / staffing ratios -> 'Strengthen Full-Time Faculty Capacity'\n"
        "  missing nursing / computer-science programs -> 'Expand the Academic Program Portfolio'\n"
        "  poorly maintained labs and lecture halls -> 'Modernize Learning and Research Facilities'"
        + JSON_GUARDRAIL
    )
    human = (
        f"{body}\n\n"
        "Produce one entry per cluster, with cluster_id matching the number shown. Each "
        "title and description must faithfully reflect that cluster's pairs above — do NOT "
        "name a cluster after a topic absent from its pairs, and for a 1-2 pair cluster name "
        "it directly after its subject. Prefer distinct titles, but accuracy comes first."
    )
    try:
        out = local_brain.with_structured_output(_Themes).invoke(
            [SystemMessage(content=system), HumanMessage(content=human)]
        )
        return {t.cluster_id: (t.theme_name, t.theme_description) for t in out.themes}
    except Exception as exc:
        print(f"[cluster] joint labeling failed ({exc}); drafting will title the goals.")
        return {}


# ── Public entry point ─────────────────────────────────────────────────────────

def cluster_into_goals(pairs: list[dict]) -> list[dict]:
    """
    Group grounded TOWS pairs into strategic themes.

    Returns a list of cluster dicts:
        {
            "cluster_id":        int,
            "pairs":             list[dict],   # grounded pair dicts (untouched)
            "pillar_ids":        list[int],
            "theme_name":        str | None,   # from the joint LLM labeling
            "theme_description": str | None,
        }
    A superset of the legacy shape, so draft_goals / validate / persistence are
    unaffected (extra keys are simply ignored by code that doesn't read them).
    """
    if not pairs:
        return []

    n = len(pairs)
    if n > CLUSTER_SCALE_WARN:
        # Heads-up only — the run still proceeds normally.
        print(f"[cluster] HEADS-UP: {n} pairs far exceeds the scale the clustering was "
              f"tuned at (~96, threshold {CLUSTER_SCALE_WARN}). CLUSTER_KNN={CLUSTER_KNN} "
              f"is fixed and may be proportionally too sparse, and the goal band "
              f"[{MIN_GOALS},{MAX_GOALS}] may no longer fit. Re-validate the clustering on "
              f"this larger dataset and adjust config.py if the goals look off.")

    if n <= MIN_GOALS:
        # Too few pairs to cluster meaningfully → one goal per pair.
        groups = {i: [p] for i, p in enumerate(pairs)}
    else:
        X = _embed_internal(pairs)
        edges, weights = _knn_graph(X, knn=min(CLUSTER_KNN, n - 1))
        labels = _select_resolution(X, edges, weights)
        groups = _group(pairs, labels)

    # Imbalance heads-up: one goal swallowing most pairs usually means a "grab-bag"
    # that should be split — widening MAX_GOALS is the usual fix.
    biggest = max((len(m) for m in groups.values()), default=0)
    if n and biggest / n > 0.40:
        print(f"[cluster] WARNING: largest goal holds {biggest}/{n} pairs "
              f"({biggest / n:.0%}) — possible grab-bag. Consider raising MAX_GOALS "
              f"so it splits further.")

    named = _label_clusters(groups)

    clusters: list[dict] = []
    for cid, members in groups.items():
        name, desc = named.get(cid, (None, None))
        clusters.append({
            "cluster_id":        cid,
            "pairs":             members,
            "pillar_ids":        _pillar_ids(members),
            "theme_name":        name,
            "theme_description": desc,
        })
    return clusters
