#!/usr/bin/env python3
"""
ingest_graph.py — NAQAAE GraphRAG Ingestion Pipeline

Walks ./RAG/Pre-built/Naqaae_Immutable/, splits every English Markdown standards file
along its header hierarchy, embeds each chunk with a local Ollama model, and
writes a hierarchical knowledge graph + vector index into Neo4j AuraDB.

Graph schema
────────────
  (Document)-[:HAS_STANDARD]->(Standard)
  (Standard)-[:HAS_CRITERION]->(Criterion)
  (Document|Standard|Criterion)-[:HAS_CHUNK]->(Chunk)
  (Chunk)-[:NEXT_CHUNK]->(Chunk)   ← sequential order within each document

Run
───
  python RAG/ingest_graph.py
"""

from __future__ import annotations

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
OLLAMA_MODEL = "bge-m3"   # ← swap this string to change the embedding model
EMBED_DIM    = 1024       # bge-m3 output dimension — update if you change the model
EMBED_BATCH  = 32         # chunks per Ollama embed call (tune for your hardware)
DATA_DIR     = pathlib.Path("./RAG/Pre-built/Naqaae_Immutable")

# ── Neo4j credentials (loaded from .env) ─────────────────────────────────────
NEO4J_URI      = os.getenv("NEO4J_URI")
NEO4J_USERNAME = os.getenv("NEO4J_USERNAME")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD")

# ── Header split levels ───────────────────────────────────────────────────────
# H1 (#)  → Standard   (top-level NAQAAE standard, e.g. "Standard One: Governance")
# H2 (##) → Criterion  (sub-criterion,               e.g. "1.1 Institutional Governance")
HEADERS_TO_SPLIT_ON = [
    ("#",  "standard"),
    ("##", "criterion"),
]

# ── Schema Cypher ─────────────────────────────────────────────────────────────
_CONSTRAINTS = [
    "CREATE CONSTRAINT doc_unique   IF NOT EXISTS FOR (d:Document)  REQUIRE d.doc_id       IS UNIQUE",
    "CREATE CONSTRAINT std_unique   IF NOT EXISTS FOR (s:Standard)  REQUIRE s.standard_id  IS UNIQUE",
    "CREATE CONSTRAINT crit_unique  IF NOT EXISTS FOR (c:Criterion) REQUIRE c.criterion_id IS UNIQUE",
    "CREATE CONSTRAINT chunk_unique IF NOT EXISTS FOR (ch:Chunk)    REQUIRE ch.chunk_id    IS UNIQUE",
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

_MERGE_CHUNK = """
MERGE (ch:Chunk {chunk_id: $chunk_id})
SET ch.content         = $content,
    ch.embedding       = $embedding,
    ch.doc_id          = $doc_id,
    ch.standard_title  = $standard_title,
    ch.criterion_title = $criterion_title,
    ch.position        = $position
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


def _ingest_file(
    driver,
    embedder: OllamaEmbeddings,
    md_file: pathlib.Path,
) -> None:
    content = md_file.read_text(encoding="utf-8")

    # Deterministic doc_id so re-runs are fully idempotent
    doc_id = str(uuid.uuid5(uuid.NAMESPACE_URL, str(md_file.resolve())))

    splitter = MarkdownHeaderTextSplitter(
        headers_to_split_on=HEADERS_TO_SPLIT_ON,
        strip_headers=False,   # keep headers inside chunk text for full context
    )
    docs = splitter.split_text(content)

    # Embed in batches to avoid overwhelming Ollama
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
            meta            = doc.metadata
            standard_title  = meta.get("standard")
            criterion_title = meta.get("criterion")

            # Deterministic chunk_id keyed on document + position
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
                        crit_id=crit_id,
                        title=criterion_title,
                        std_id=std_id,
                        doc_id=doc_id,
                    )
                    parent_label   = "Criterion"
                    parent_id_prop = "criterion_id"
                    parent_id      = crit_id
                else:
                    parent_label   = "Standard"
                    parent_id_prop = "standard_id"
                    parent_id      = std_id
            else:
                # Preamble text before any header — attach directly to Document
                parent_label   = "Document"
                parent_id_prop = "doc_id"
                parent_id      = doc_id

            # ── Chunk node ───────────────────────────────────────────────────
            session.run(
                _MERGE_CHUNK,
                chunk_id=chunk_id,
                content=doc.page_content,
                embedding=embedding,
                doc_id=doc_id,
                standard_title=standard_title,
                criterion_title=criterion_title,
                position=i,
            )

            # Link chunk to its nearest structural parent
            link_cypher = f"""
                MATCH (parent:{parent_label} {{{parent_id_prop}: $parent_id}}),
                      (ch:Chunk {{chunk_id: $chunk_id}})
                MERGE (parent)-[:HAS_CHUNK]->(ch)
            """
            session.run(link_cypher, parent_id=parent_id, chunk_id=chunk_id)

            # Sequential chain for context-window expansion during retrieval
            if prev_chunk_id:
                session.run(_NEXT_CHUNK, prev=prev_chunk_id, curr=chunk_id)

            prev_chunk_id = chunk_id


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    missing = [v for v in ("NEO4J_URI", "NEO4J_USERNAME", "NEO4J_PASSWORD") if not os.getenv(v)]
    if missing:
        raise EnvironmentError(f"Missing environment variables: {', '.join(missing)}")

    md_files = sorted(DATA_DIR.glob("**/*.md"))
    if not md_files:
        print(f"No .md files found in {DATA_DIR}. Ensure the data directory exists.")
        return

    print(f"Files found      : {len(md_files)}")
    print(f"Embedding model  : {OLLAMA_MODEL}  (dim={EMBED_DIM})")
    print(f"Neo4j endpoint   : {NEO4J_URI}\n")

    driver   = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USERNAME, NEO4J_PASSWORD))
    embedder = OllamaEmbeddings(model=OLLAMA_MODEL)

    _setup_schema(driver)

    for md_file in md_files:
        print(f"[ingest] {md_file.name} ...", end=" ", flush=True)
        _ingest_file(driver, embedder, md_file)
        print("done")

    driver.close()
    print(f"\nPipeline complete — {len(md_files)} document(s) ingested into Neo4j.")


if __name__ == "__main__":
    main()
