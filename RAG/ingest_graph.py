#!/usr/bin/env python3
"""
ingest_graph.py — NAQAAE GraphRAG Ingestion Pipeline

Walks ./RAG/Pre-built/Naqaae_Immutable/, splits every English Markdown standards file
along its full 3-level header hierarchy, embeds each chunk with a local Ollama model,
and writes a hierarchical knowledge graph + vector index into Neo4j AuraDB.

Graph schema
────────────
  (Document)-[:HAS_STANDARD]->(Standard)
  (Standard)-[:HAS_CRITERION]->(Criterion)
  (Criterion)-[:HAS_INDICATOR]->(Indicator)
  (Document|Standard|Criterion|Indicator)-[:HAS_CHUNK]->(Chunk)
  (Chunk)-[:NEXT_CHUNK]->(Chunk)   ← sequential order within each document

Split levels
────────────
  #   → Standard   "Standard (1): Program Mission and Management"
  ##  → Criterion  "Programmatic Accreditation Standards — NAQAAE 2022"
  ### → Indicator  "Indicator 1-1: Program Mission"

Run (clean wipe + re-ingest)
────────────────────────────
  python RAG/ingest_graph.py --clean
  python RAG/ingest_graph.py          # incremental MERGE (safe to re-run)
"""

from __future__ import annotations

import argparse
import datetime
import os
import pathlib
import uuid
from typing import Optional

from dotenv import load_dotenv
from langchain_community.embeddings import OllamaEmbeddings
from langchain_text_splitters import MarkdownHeaderTextSplitter
from neo4j import GraphDatabase

load_dotenv()

# ── Tuneable constants ────────────────────────────────────────────────────────
OLLAMA_MODEL = "nomic-embed-text"   # ← swap to change the embedding model
EMBED_DIM    = 768                  # nomic-embed-text output dimension
EMBED_BATCH  = 32         # chunks per Ollama embed call
DATA_DIR     = pathlib.Path("./RAG/Pre-built/Naqaae_Immutable")

# ── Neo4j credentials (loaded from .env) ─────────────────────────────────────
NEO4J_URI      = os.getenv("NEO4J_URI")
NEO4J_USERNAME = os.getenv("NEO4J_USERNAME")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD")

# ── Header split levels ───────────────────────────────────────────────────────
# H1 (#)   → Standard   top-level standard
# H2 (##)  → Criterion  edition/scope header (one per file)
# H3 (###) → Indicator  individual indicator — this is what creates one chunk per indicator
HEADERS_TO_SPLIT_ON = [
    ("#",   "standard"),
    ("##",  "criterion"),
    ("###", "indicator"),
]

# ── Schema Cypher ─────────────────────────────────────────────────────────────
_CONSTRAINTS = [
    "CREATE CONSTRAINT doc_unique  IF NOT EXISTS FOR (d:Document)  REQUIRE d.doc_id        IS UNIQUE",
    "CREATE CONSTRAINT std_unique  IF NOT EXISTS FOR (s:Standard)  REQUIRE s.standard_id   IS UNIQUE",
    "CREATE CONSTRAINT crit_unique IF NOT EXISTS FOR (c:Criterion) REQUIRE c.criterion_id  IS UNIQUE",
    "CREATE CONSTRAINT ind_unique  IF NOT EXISTS FOR (i:Indicator) REQUIRE i.indicator_id  IS UNIQUE",
    "CREATE CONSTRAINT chk_unique  IF NOT EXISTS FOR (ch:Chunk)    REQUIRE ch.chunk_id     IS UNIQUE",
]

_VECTOR_INDEX = f"""
CREATE VECTOR INDEX chunk_embedding IF NOT EXISTS
FOR (ch:Chunk) ON ch.embedding
OPTIONS {{
    indexConfig: {{
        `vector.dimensions`:          {EMBED_DIM},
        `vector.similarity_function`: 'cosine'
    }}
}}
"""

# ── Node / relationship Cypher ────────────────────────────────────────────────
_MERGE_DOC = """
MERGE (d:Document {doc_id: $doc_id})
SET d.filename    = $filename,
    d.source      = $source,
    d.ingested_at = $ingested_at
"""

_MERGE_STANDARD = """
MERGE (s:Standard {standard_id: $std_id})
SET s.title  = $title,
    s.doc_id = $doc_id
WITH s
MATCH (d:Document {doc_id: $doc_id})
MERGE (d)-[:HAS_STANDARD]->(s)
"""

_MERGE_CRITERION = """
MERGE (c:Criterion {criterion_id: $crit_id})
SET c.title       = $title,
    c.standard_id = $std_id,
    c.doc_id      = $doc_id
WITH c
MATCH (s:Standard {standard_id: $std_id})
MERGE (s)-[:HAS_CRITERION]->(c)
"""

_MERGE_INDICATOR = """
MERGE (i:Indicator {indicator_id: $ind_id})
SET i.title       = $title,
    i.criterion_id = $crit_id,
    i.standard_id  = $std_id,
    i.doc_id       = $doc_id
WITH i
MATCH (c:Criterion {criterion_id: $crit_id})
MERGE (c)-[:HAS_INDICATOR]->(i)
"""

_MERGE_CHUNK = """
MERGE (ch:Chunk {chunk_id: $chunk_id})
SET ch.content          = $content,
    ch.embedding        = $embedding,
    ch.doc_id           = $doc_id,
    ch.standard_title   = $standard_title,
    ch.criterion_title  = $criterion_title,
    ch.indicator_title  = $indicator_title,
    ch.position         = $position
"""

_NEXT_CHUNK = """
MATCH (prev:Chunk {chunk_id: $prev}), (curr:Chunk {chunk_id: $curr})
MERGE (prev)-[:NEXT_CHUNK]->(curr)
"""


# ── Helpers ───────────────────────────────────────────────────────────────────

def _batched(lst: list, n: int):
    for i in range(0, len(lst), n):
        yield lst[i : i + n]


def _setup_schema(driver) -> None:
    with driver.session() as s:
        for cypher in _CONSTRAINTS:
            s.run(cypher)
        s.run(_VECTOR_INDEX)
    print("[schema] Constraints and vector index ensured.")


def _wipe_graph(driver) -> None:
    with driver.session() as s:
        s.run("MATCH (n) DETACH DELETE n")
    print("[clean] All nodes and relationships deleted.")


def _ingest_file(
    driver,
    embedder: OllamaEmbeddings,
    md_file: pathlib.Path,
) -> int:
    """Ingest one Markdown file. Returns number of chunks written."""
    content = md_file.read_text(encoding="utf-8")
    doc_id  = str(uuid.uuid5(uuid.NAMESPACE_URL, str(md_file.resolve())))

    splitter = MarkdownHeaderTextSplitter(
        headers_to_split_on=HEADERS_TO_SPLIT_ON,
        strip_headers=False,
    )
    docs = splitter.split_text(content)

    # Embed all chunks in batches
    all_embeddings: list[list[float]] = []
    for batch in _batched([d.page_content for d in docs], EMBED_BATCH):
        all_embeddings.extend(embedder.embed_documents(batch))

    with driver.session() as session:
        session.run(
            _MERGE_DOC,
            doc_id=doc_id,
            filename=md_file.stem,
            source=str(md_file),
            ingested_at=datetime.datetime.utcnow().isoformat(),
        )

        prev_chunk_id: Optional[str] = None

        for i, (doc, embedding) in enumerate(zip(docs, all_embeddings)):
            meta             = doc.metadata
            standard_title   = meta.get("standard")
            criterion_title  = meta.get("criterion")
            indicator_title  = meta.get("indicator")

            chunk_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{doc_id}::{i}"))

            # ── Standard node (H1) ───────────────────────────────────────────
            if standard_title:
                std_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{doc_id}::{standard_title}"))
                session.run(_MERGE_STANDARD, std_id=std_id, title=standard_title, doc_id=doc_id)

                # ── Criterion node (H2) ──────────────────────────────────────
                if criterion_title:
                    crit_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{std_id}::{criterion_title}"))
                    session.run(
                        _MERGE_CRITERION,
                        crit_id=crit_id, title=criterion_title,
                        std_id=std_id, doc_id=doc_id,
                    )

                    # ── Indicator node (H3) ──────────────────────────────────
                    if indicator_title:
                        ind_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{crit_id}::{indicator_title}"))
                        session.run(
                            _MERGE_INDICATOR,
                            ind_id=ind_id, title=indicator_title,
                            crit_id=crit_id, std_id=std_id, doc_id=doc_id,
                        )
                        parent_label, parent_id_prop, parent_id = "Indicator", "indicator_id", ind_id
                    else:
                        parent_label, parent_id_prop, parent_id = "Criterion", "criterion_id", crit_id
                else:
                    parent_label, parent_id_prop, parent_id = "Standard", "standard_id", std_id
            else:
                parent_label, parent_id_prop, parent_id = "Document", "doc_id", doc_id

            # ── Chunk node ───────────────────────────────────────────────────
            session.run(
                _MERGE_CHUNK,
                chunk_id=chunk_id,
                content=doc.page_content,
                embedding=embedding,
                doc_id=doc_id,
                standard_title=standard_title,
                criterion_title=criterion_title,
                indicator_title=indicator_title,
                position=i,
            )

            # Link chunk to its nearest structural parent
            link_cypher = f"""
                MATCH (parent:{parent_label} {{{parent_id_prop}: $parent_id}}),
                      (ch:Chunk {{chunk_id: $chunk_id}})
                MERGE (parent)-[:HAS_CHUNK]->(ch)
            """
            session.run(link_cypher, parent_id=parent_id, chunk_id=chunk_id)

            if prev_chunk_id:
                session.run(_NEXT_CHUNK, prev=prev_chunk_id, curr=chunk_id)

            prev_chunk_id = chunk_id

    return len(docs)


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="NAQAAE GraphRAG ingestion pipeline")
    parser.add_argument(
        "--clean", action="store_true",
        help="Wipe all existing nodes before ingesting (required when schema changes).",
    )
    args = parser.parse_args()

    missing = [v for v in ("NEO4J_URI", "NEO4J_USERNAME", "NEO4J_PASSWORD") if not os.getenv(v)]
    if missing:
        raise EnvironmentError(f"Missing environment variables: {', '.join(missing)}")

    md_files = sorted(DATA_DIR.glob("**/*.md"))
    # The 00_*_Index file is a table-of-contents / file map with no indicator
    # content. Its chunks never sit under an Indicator node and only add noise
    # to vector retrieval, so we skip it during ingestion.
    skipped = [f for f in md_files if "index" in f.stem.lower()]
    md_files = [f for f in md_files if f not in skipped]
    for f in skipped:
        print(f"[skip] {f.name} (index / table of contents — not ingested)")
    if not md_files:
        print(f"No .md files found in {DATA_DIR}. Ensure the data directory exists.")
        return

    print(f"Files found      : {len(md_files)}")
    print(f"Embedding model  : {OLLAMA_MODEL}  (dim={EMBED_DIM})")
    print(f"Neo4j endpoint   : {NEO4J_URI}\n")

    driver   = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USERNAME, NEO4J_PASSWORD))
    embedder = OllamaEmbeddings(model=OLLAMA_MODEL)

    if args.clean:
        _wipe_graph(driver)

    _setup_schema(driver)

    total_chunks = 0
    for md_file in md_files:
        print(f"[ingest] {md_file.name} ...", end=" ", flush=True)
        n = _ingest_file(driver, embedder, md_file)
        total_chunks += n
        print(f"{n} chunks")

    driver.close()
    print(f"\nPipeline complete — {len(md_files)} document(s), {total_chunks} chunk(s) ingested.")


if __name__ == "__main__":
    main()
