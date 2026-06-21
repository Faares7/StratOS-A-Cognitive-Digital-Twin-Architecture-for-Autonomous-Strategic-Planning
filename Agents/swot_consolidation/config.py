"""
SWOT consolidation pipeline — tunable constants.

All thresholds, weights and caps live here so they can be adjusted in one place
without touching pipeline logic. Per docs/SWOT_PIPELINE.md the concrete values are
hand-set defaults meant to be revisited after a few reviewer cycles (decision #2);
the per-candidate factor breakdown is persisted so they can be tuned from data later.
"""

from __future__ import annotations

# ── Embedding ─────────────────────────────────────────────────────────────────
EMBED_MODEL: str = "bge-m3"   # must match goals_planner/config.py + ingest_graph.py

# ── Concept normalization (Fix 1) ─────────────────────────────────────────────
# Each raw item is rewritten to a short style-neutral CONCEPT phrase so that
# differently-worded items about the same concern (audit metrics vs sentiment
# colloquial vs old-plan prose) become comparable. Dedup / corroboration / lifecycle
# all operate on the concept; the original text stays as the display medoid.
NORMALIZE_BATCH: int = 15     # items per LLM normalization call

# ── History window (decision #1) ──────────────────────────────────────────────
# Static-input agents re-emit identical output every run, so frequency is
# meaningless for them → latest run only. Only these two agents take changing
# input → windowed over distinct snapshots.
CHANGING_AGENTS: frozenset[str] = frozenset({"tech", "social_media"})
WINDOW_SNAPSHOTS: int = 12     # changing agents: keep the last N DISTINCT snapshots

# ── Dedup / canonicalization (decision #4 — coverage heuristic; Fix 5 retune) ──
DEDUP_KNN: int = 8                  # neighbours per node in the similarity graph
DEDUP_RES_GRID: tuple[float, ...] = (0.6, 0.8, 1.0, 1.4, 1.8, 2.4, 3.0, 4.0)
DEDUP_DUP_SIM: float = 0.78         # cosine ≥ this ⇒ a pair that SHOULD be merged (a "duplicate")
DEDUP_MIN_PURITY: float = 0.55      # reject a resolution whose merges are below this purity
DEDUP_NEAR_DUP: float = 0.93        # Fix 5 safety net: cosine ≥ this is force-merged (union-find)
                                    # regardless of Leiden, so identical/near-identical items
                                    # never survive as separate clusters

# ── Salience weights — internal S/W (corroboration + severity) ────────────────
# Fix B: persistence is NO LONGER a score term — it became a display-only tag (the
# lifecycle badge). Against a comprehensive previous plan "persistent" was near-default
# and its boost floated low-value anecdotes above hard metrics, so ranking is now driven
# purely by evidence quality. Weights sum to 1.
W_CORROBORATION: float = 0.60
W_SEVERITY:      float = 0.40
SENTIMENT_COUNT_FULL: int = 10      # Fix 3: sentiment severity = min(count / this, 1.0)
SOCIAL_REF_FULL:      int = 5       # Fix A': social severity = min(reference_count / this, 1.0)
                                    # — the social agent already groups posts into themes and
                                    # stamps reference_count; a 1-post theme is an anecdote.

# ── Salience weights — external O/T (agreement-driven) ────────────────────────
# salience_ext = base_priority · recency_weight + agreement_boost
# Fix B: no persistence term here either — it's a display tag, not a score booster.
AGREEMENT_BOOST: float = 0.50       # both tech AND social_media present in the cluster
RECENCY_LAMBDA:  float = 0.0030     # per-day decay; ~0.0030 ⇒ half-weight at ~230 days

# Map producer-assigned impact_level → [0,1] base priority.
IMPACT_MAP: dict[str, float] = {
    "critical": 1.00, "high": 0.75, "medium": 0.50, "low": 0.25,
}

# ── Lifecycle matching vs previous plan (decision #5; Fix 2) ──────────────────
# Calibrated from the Fix 0 diagnostic on concept embeddings (internal p50≈0.65,
# external p50≈0.71). 0.70 captures genuine carry-over without matching on mere
# topical proximity. Precision is non-critical now: unmatched-previous = carried_forward
# (retained, never dropped), so a missed/spurious match only nudges the persistence boost.
LIFECYCLE_MATCH_THRESHOLD: float = 0.70   # cosine ≥ this ⇒ "same concern as previous plan"

# ── Selection — hybrid per namespace (decision #6) ────────────────────────────
SELECT_MIN_PER_GROUP: int = 1       # every group with evidence keeps ≥ this many
SELECT_MAX_PER_GROUP: int = 5       # K — cap per group
SELECT_THRESHOLD:     float = 0.35  # salience ≥ this is kept (within the min/max band)

# ── Previous-plan SWOT (re-categorized 12→7 on load) ──────────────────────────
PREV_PLAN_INTERNAL: str = "Data/Internal_Environment_Analysis_EN.json"
PREV_PLAN_EXTERNAL: str = "Data/External_Environment_Analysis_EN.json"
