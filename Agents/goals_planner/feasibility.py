"""
Feasibility check (HITL) for goals and objectives.

Given a goal/objective text and the run's SWOT corpus, this:
  1. gathers EVIDENCE — the most relevant SWOT items (the baseline data/metrics)
     plus the NAQAAE indicators/pillars the text grounds to, and
  2. JUDGES whether the target is realistically achievable within the plan
     horizon (<= PLAN_HORIZON_YEARS), returning a binary-ish verdict.

The verdict is ADVISORY — the human decides. The LLM never invents the baseline;
it judges only against the evidence, and answers 'insufficient_data' when the
evidence doesn't contain the relevant baseline.

Verdicts: 'feasible' | 'infeasible' | 'insufficient_data'.
"""

from __future__ import annotations

from typing import Optional

from langchain_community.embeddings import OllamaEmbeddings
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel

from core.llm import JSON_GUARDRAIL, local_brain

from .config import EMBED_MODEL, NEO4J_TOP_K, NEO4J_VECTOR_INDEX, PLAN_HORIZON_YEARS
from .grounding import _get_driver
from .pairing import _cosine, _item_text

_TOP_SWOT = 5            # how many SWOT items to surface as evidence
_TOP_INDICATORS = 4      # how many NAQAAE indicators to surface
_VERDICTS = {"feasible", "infeasible", "insufficient_data"}

# Top-N indicators (aggregated per indicator, max chunk score).
_CYPHER_TOPN = """
CALL db.index.vector.queryNodes($index, $k, $embedding) YIELD node AS ch, score
MATCH (ind:Indicator)-[:HAS_CHUNK]->(ch)
WITH ind, max(score) AS score
RETURN ind.indicator_id AS indicator_id, ind.title AS indicator_title, score
ORDER BY score DESC
LIMIT $topn
"""


# ── Evidence gathering ──────────────────────────────────────────────────────────

def _retrieve_indicators(embedding: list[float]) -> list[dict]:
    """Top NAQAAE indicators for the query embedding (read-only Neo4j)."""
    driver = _get_driver()
    try:
        with driver.session() as session:
            rows = session.execute_read(
                lambda tx: list(tx.run(
                    _CYPHER_TOPN,
                    index=NEO4J_VECTOR_INDEX, k=NEO4J_TOP_K,
                    embedding=embedding, topn=_TOP_INDICATORS,
                ))
            )
        return [
            {"indicator_id": r["indicator_id"],
             "indicator_title": r["indicator_title"],
             "grounding_score": r["score"]}
            for r in rows
        ]
    except Exception as exc:
        print(f"[feasibility] indicator retrieval failed ({exc}); continuing without it.")
        return []
    finally:
        driver.close()


def gather_evidence(text: str, swot_items: list[dict]) -> dict:
    """The data a feasibility judgment is based on: the most relevant SWOT items
    (baseline metrics) + NAQAAE indicators + the pillars involved."""
    embedder = OllamaEmbeddings(model=EMBED_MODEL)

    # Embed the query text and all SWOT items with the SAME method (embed_documents),
    # in one batched call, so the cosine comparison is valid.
    texts = [text] + [_item_text(s) for s in swot_items]
    vecs = embedder.embed_documents(texts)
    qv, item_vecs = vecs[0], vecs[1:]

    scored = sorted(
        zip(swot_items, item_vecs),
        key=lambda pair: _cosine(qv, pair[1]),
        reverse=True,
    )
    top_swot = [s for s, _ in scored[:_TOP_SWOT]]

    indicators = _retrieve_indicators(qv)
    pillars = sorted({s.get("pillar_name") for s in top_swot if s.get("pillar_name")})

    return {
        "swot_items": [
            {
                "item_id":     str(s.get("item_id")),
                "type":        s.get("type"),
                "title":       s.get("title"),
                "description": s.get("description"),
                "pillar_name": s.get("pillar_name"),
            }
            for s in top_swot
        ],
        "indicators": indicators,
        "pillars": pillars,
    }


# ── The judge ────────────────────────────────────────────────────────────────

class _Verdict(BaseModel):
    verdict: str                         # feasible | infeasible | insufficient_data
    reason: str
    suggestion: str
    stated_timeframe_years: Optional[int] = None   # parsed from the text, null if none


def _assess(text: str, kind: str, evidence: dict, horizon: int) -> dict:
    facts = "\n".join(
        f"- [{s['type']}] {s.get('description') or s.get('title') or ''}"
        for s in evidence["swot_items"]
    ) or "(no closely-related baseline data was found)"

    system = (
        "You are a university strategic-planning analyst judging whether a "
        f"{kind} is realistically achievable. The plan horizon is AT MOST {horizon} "
        "years. Judge ONLY against the baseline facts provided — never invent data. "
        "If the facts do not contain the relevant baseline to judge the target, answer "
        "'insufficient_data'. Be conservative and concrete, and cite the baseline "
        "numbers in your reason. This assessment is advisory."
        + JSON_GUARDRAIL
    )
    human = (
        f"{kind.capitalize()} text:\n{text}\n\n"
        f"Baseline facts (from the institution's SWOT data):\n{facts}\n\n"
        f"Judge whether this {kind} is achievable within at most {horizon} years.\n"
        "Return:\n"
        "  - verdict: exactly one of 'feasible', 'infeasible', 'insufficient_data'\n"
        "  - reason: one sentence citing the baseline\n"
        "  - suggestion: one sentence (a more realistic target/timeframe if not "
        "feasible, else how to ensure success)\n"
        f"  - stated_timeframe_years: the timeframe stated in the {kind} text in whole "
        "years, or null if none is stated."
    )

    out = local_brain.with_structured_output(_Verdict).invoke(
        [SystemMessage(content=system), HumanMessage(content=human)]
    )

    verdict = (out.verdict or "").strip().lower().replace(" ", "_")
    if verdict not in _VERDICTS:
        verdict = "insufficient_data"
    reason = out.reason
    tf = out.stated_timeframe_years
    used_tf = tf if (tf and tf > 0) else horizon

    # Deterministic horizon override: nothing beyond the plan horizon is feasible.
    if tf and tf > horizon:
        verdict = "infeasible"
        reason = (f"The stated timeframe of {tf} years exceeds the {horizon}-year plan "
                  f"horizon. {reason}")

    return {
        "verdict": verdict,
        "reason": reason,
        "suggestion": out.suggestion,
        "timeframe_years": used_tf,
    }


# ── Public entry point ───────────────────────────────────────────────────────

def evaluate(text: str, kind: str, swot_items: list[dict],
             horizon: int = PLAN_HORIZON_YEARS) -> dict:
    """Full check: gather evidence + judge. `kind` is 'goal' or 'objective'.
    Returns {verdict, reason, suggestion, timeframe_years, evidence}."""
    evidence = gather_evidence(text, swot_items)
    result = _assess(text, kind, evidence, horizon)
    result["evidence"] = evidence
    return result
