"""
Node 2 — ground_in_graph
Soft GraphRAG grounding: reads Neo4j, never writes to it.

For each TOWS pair the pillar is always known (inherited from the internal
S/W item). We use that to scope the vector search to the matching NAQAAE
Standard, then traverse up to find the exact Indicator.

Alignment levels (stored on each pair):
  'indicator'   — cosine ≥ GROUND_THRESHOLD and an Indicator node was found
  'pillar_only' — pillar is known but score is below threshold (or no Indicator)
  'strategic'   — no pillar (shouldn't happen in normal flow, but handled)
"""

from __future__ import annotations

import os

from langchain_community.embeddings import OllamaEmbeddings
from neo4j import GraphDatabase
from neo4j.exceptions import ConfigurationError

from .config import (
    EMBED_MODEL,
    GROUND_THRESHOLD,
    NEO4J_TOP_K,
    NEO4J_VECTOR_INDEX,
    PILLAR_TO_KEYWORD,
)

# ── Neo4j Cypher ──────────────────────────────────────────────────────────────
#
# Strategy: use the vector index to retrieve top-K chunks, filter by
# standard_title (stored on every Chunk node during ingestion), then
# traverse up to the Indicator that owns the chunk to capture indicator_id.
#
# Chunks at different levels carry these properties (from ingest_graph.py):
#   ch.standard_title, ch.criterion_title, ch.indicator_title, ch.content
# Indicator nodes carry: indicator_id, title, criterion_id, standard_id
#
_CYPHER_WITH_KEYWORD = """
CALL db.index.vector.queryNodes($index, $k, $embedding) YIELD node AS ch, score
WHERE toLower(ch.standard_title) CONTAINS toLower($keyword)
OPTIONAL MATCH (ind:Indicator)-[:HAS_CHUNK]->(ch)
RETURN
    ch.content          AS chunk_content,
    ch.standard_title   AS standard_title,
    ch.indicator_title  AS indicator_title,
    ind.indicator_id    AS indicator_id,
    score
ORDER BY score DESC
LIMIT 1
"""

_CYPHER_NO_KEYWORD = """
CALL db.index.vector.queryNodes($index, $k, $embedding) YIELD node AS ch, score
OPTIONAL MATCH (ind:Indicator)-[:HAS_CHUNK]->(ch)
RETURN
    ch.content          AS chunk_content,
    ch.standard_title   AS standard_title,
    ch.indicator_title  AS indicator_title,
    ind.indicator_id    AS indicator_id,
    score
ORDER BY score DESC
LIMIT 1
"""

# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_driver():
    # The vector query uses db.index.vector.queryNodes, which Neo4j flags as a
    # DEPRECATION notification on every call — harmless, but it floods the console
    # because grounding runs the query once per pair. Disable server notifications
    # so the logs stay readable. Falls back gracefully on older drivers that don't
    # support the kwarg.
    uri = os.getenv("NEO4J_URI")
    auth = (os.getenv("NEO4J_USERNAME"), os.getenv("NEO4J_PASSWORD"))
    # Bounded timeouts: on a flaky/high-latency link these caps stop a single bad
    # query from retrying for 30s × N pairs (which can blow the whole run past its
    # time budget). A failed query degrades to pillar_only instead.
    #   max_transaction_retry_time : total retry budget per query (default 30s → 6s)
    #   connection_acquisition_timeout / connection_timeout : fail fast if unreachable
    common = dict(
        max_transaction_retry_time=6,
        connection_acquisition_timeout=10,
        connection_timeout=10,
    )
    try:
        return GraphDatabase.driver(
            uri, auth=auth, notifications_min_severity="OFF", **common,
        )
    except (TypeError, ValueError, ConfigurationError):
        try:
            return GraphDatabase.driver(uri, auth=auth, **common)
        except (TypeError, ValueError, ConfigurationError):
            return GraphDatabase.driver(uri, auth=auth)


def _pillar_to_keyword(pillar_name: str | None) -> str | None:
    if not pillar_name:
        return None
    # Exact match
    if pillar_name in PILLAR_TO_KEYWORD:
        return PILLAR_TO_KEYWORD[pillar_name]
    # Fuzzy fallback: containment check (handles minor name drift)
    pn = pillar_name.lower()
    for key, kw in PILLAR_TO_KEYWORD.items():
        if pn in key.lower() or key.lower() in pn:
            return kw
    # No match — grounding will use the unscoped query and may ground to the
    # wrong standard. This means PILLAR_TO_KEYWORD in config.py is out of sync
    # with the pillar names in the DB.
    print(
        f"[grounding] WARNING: pillar_name {pillar_name!r} has no entry in "
        f"PILLAR_TO_KEYWORD — falling back to unscoped vector search. "
        f"Update config.py to fix this."
    )
    return None


# ── Retrying read ──────────────────────────────────────────────────────────────

def _vector_search(tx, cypher: str, params: dict):
    """Transaction function for session.execute_read — gives automatic retry on
    transient failures (dropped/defunct connections, Aura blips, SessionExpired)."""
    return tx.run(cypher, **params).single()


# ── Public entry point ────────────────────────────────────────────────────────

def ground_pairs(pairs: list[dict]) -> list[dict]:
    """
    For every pair, vector-search the Neo4j chunk_embedding index,
    filter by the pair's pillar Standard, and soft-assign alignment.

    Mutates pairs in place (fills grounding fields). Returns the same list.
    Never writes anything to Neo4j.

    All pair texts are embedded in ONE batched call to avoid N sequential
    round-trips to Ollama (which is the main performance bottleneck on CPU).
    """
    if not pairs:
        return pairs

    embedder = OllamaEmbeddings(model=EMBED_MODEL)
    driver   = _get_driver()

    # Single batch call — replaces N sequential embed_query calls
    texts      = [f"{p['internal_text']} {p['external_text']}" for p in pairs]
    embeddings = embedder.embed_documents(texts)

    # Fast-fail: if Neo4j is unreachable, don't fire N retrying queries (which can
    # take tens of minutes on a flaky link). Degrade every pair to pillar_only now.
    try:
        driver.verify_connectivity()
    except Exception as exc:
        print(f"[grounding] Neo4j unreachable ({exc}); skipping grounding — "
              f"all pairs -> pillar_only/strategic.")
        for pair in pairs:
            pair["alignment"]             = "pillar_only" if pair.get("pillar_name") else "strategic"
            pair["grounded_indicator_id"] = None
            pair["grounding_score"]       = None
            pair["indicator_text"]        = None
        driver.close()
        return pairs

    try:
        with driver.session() as session:
            for pair, embedding in zip(pairs, embeddings):
                keyword   = _pillar_to_keyword(pair.get("pillar_name"))

                params = {
                    "index": NEO4J_VECTOR_INDEX,
                    "k": NEO4J_TOP_K,
                    "embedding": embedding,
                }
                cypher = _CYPHER_NO_KEYWORD
                if keyword:
                    cypher = _CYPHER_WITH_KEYWORD
                    params["keyword"] = keyword

                try:
                    # Managed read transaction → auto-retries on transient/defunct
                    # connection errors instead of failing the whole grounding pass.
                    row = session.execute_read(_vector_search, cypher, params)
                except Exception as exc:
                    print(f"[grounding] query failed for pair "
                          f"{pair.get('pair_id')} ({exc}); falling back to pillar_only.")
                    pair["alignment"]             = "pillar_only" if pair.get("pillar_name") else "strategic"
                    pair["grounded_indicator_id"] = None
                    pair["grounding_score"]       = None
                    pair["indicator_text"]        = None
                    continue

                if row is None:
                    # Keyword post-filter removed every top-K chunk — pillar is
                    # still known from the internal item, so this is pillar_only,
                    # not strategic. Strategic is reserved for pairs with no
                    # pillar at all (shouldn't happen in normal flow).
                    pair["alignment"]             = "pillar_only" if pair.get("pillar_name") else "strategic"
                    pair["grounded_indicator_id"] = None
                    pair["grounding_score"]       = None
                    pair["indicator_text"]        = None
                    continue

                score        = row["score"]
                indicator_id = row["indicator_id"]   # None if chunk not under Indicator
                chunk_text   = (row["chunk_content"] or "")[:500]

                if score >= GROUND_THRESHOLD and indicator_id:
                    pair["alignment"]             = "indicator"
                    pair["grounded_indicator_id"] = indicator_id
                    pair["grounding_score"]       = score
                    pair["indicator_text"]        = chunk_text
                elif pair.get("pillar_name"):
                    pair["alignment"]             = "pillar_only"
                    pair["grounded_indicator_id"] = None
                    pair["grounding_score"]       = score
                    pair["indicator_text"]        = None
                else:
                    pair["alignment"]             = "strategic"
                    pair["grounded_indicator_id"] = None
                    pair["grounding_score"]       = score
                    pair["indicator_text"]        = None

    finally:
        driver.close()

    return pairs
