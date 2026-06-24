"""
Strategy planner — tunable constants.

All thresholds and caps live here so they can be adjusted in one place
without touching pipeline logic.
"""

# ── Pairing (Node 1) ──────────────────────────────────────────────────────────
PAIR_THRESHOLD: float = 0.45   # minimum cosine similarity to keep a TOWS pair
TOP_K_EXTERNAL: int   = 2      # max external items to pair with each internal item

# ── Grounding (Node 2) ────────────────────────────────────────────────────────
GROUND_THRESHOLD: float = 0.50  # cosine ≥ this → alignment='indicator'; below → 'pillar_only'

# ── Clustering (Node 3) ───────────────────────────────────────────────────────
# Strategic-theme grouping via Leiden community detection on a semantic graph.
# The resolution is chosen DYNAMICALLY per run: the best-separated (silhouette)
# stable partition whose goal count falls in [MIN_GOALS, MAX_GOALS]. These bounds
# are the only knob — a semantic choice (how many غايات a plan should have), not
# a raw hyperparameter.
MIN_GOALS:   int = 4    # lower bound on number of goals (الغايات)
MAX_GOALS:   int = 9    # upper bound on number of goals
CLUSTER_KNN: int = 10   # neighbours per node in the similarity graph
# The band + knn above were validated at ~96 pairs. When a run produces many more
# pairs than this, the fixed knn is proportionally sparser and the band may need
# re-tuning — the node prints a heads-up past this threshold (no behaviour change).
CLUSTER_SCALE_WARN: int = 200

# ── Feasibility (HITL check) ──────────────────────────────────────────────────
PLAN_HORIZON_YEARS: int = 5   # hard max horizon; anything beyond → infeasible

# ── Drafting / validation (Node 4) ────────────────────────────────────────────
MAX_RETRIES:  int = 2   # LLM retry attempts after validation failure
SMART_MIN_WORDS: int = 12  # objective must have at least this many words
OBJECTIVE_DEDUP_THRESHOLD: float = 0.95  # plan-wide near-verbatim safety net: full-sentence
                                         # cosine this high → same objective (any pillar)
ACTION_CORE_DEDUP_THRESHOLD: float = 0.90  # plan-wide, SAME pillar: merge objectives whose
                                           # action-core (sentence minus the metric/timeframe
                                           # clause) is this cosine-similar — catches one
                                           # initiative re-emerging as several program variants
                                           # (e.g. the same 'develop faculty training' written
                                           # once per program) that the 0.95 gate misses
CROSS_PILLAR_DEDUP_THRESHOLD: float = 0.93  # DIFFERENT pillars: stricter action-core gate, so
                                            # near-verbatim twins (e.g. 'update curriculum' vs
                                            # 'update curriculum in Math') collapse while genuine
                                            # scope variants stay separate. Merged objective keeps
                                            # the stronger-grounded pillar as primary.

# ── Embedding / Neo4j ─────────────────────────────────────────────────────────
EMBED_MODEL:         str = "bge-m3"           # must match ingest_graph.py
NEO4J_VECTOR_INDEX:  str = "chunk_embedding"  # must match ingest_graph.py
NEO4J_TOP_K:         int = 60                 # must exceed total chunk count (currently 46) so the
                                             # keyword post-filter always sees every pillar's chunks

# ── Pillar → Neo4j Standard keyword mapping ───────────────────────────────────
# Keys match swot_items.pillar_name values (from _GAP_PILLARS in api/main.py).
# Values are substrings of the Neo4j Standard node titles searched with CONTAINS.
# Keep in sync with api/main.py _PILLAR_KEYWORDS.
PILLAR_TO_KEYWORD: dict[str, str] = {
    "Program Mission and Management":           "Mission and Management",
    "Program Design":                           "Program Design",
    "Teaching, Learning and Assessment":        "Teaching, Learning",
    "Students and Graduates":                   "Students and Graduates",
    "Faculty and Teaching Assistants":          "Faculty and Teaching",
    "Resources and Learning Facilities":        "Learning Sources",
    "Quality Assurance and Program Evaluation": "Quality Assurance and Program Evaluation",
}
