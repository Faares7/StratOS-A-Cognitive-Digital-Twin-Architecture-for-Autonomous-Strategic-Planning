"""
Centralised LLM configuration for all StratOS agents.

All agents import `local_brain` from here so every model switch, temperature
tweak, or endpoint change is made in exactly one place.

Requires Ollama running locally:
    ollama run llama3.1:8b
"""
from langchain_openai import ChatOpenAI

local_brain: ChatOpenAI = ChatOpenAI(
    model="llama3.1:8b",
    api_key="ollama",
    base_url="http://localhost:11434/v1",
    temperature=0.2,
)

# Guardrail appended to every agent's system prompt so the local model
# stays inside its JSON schema even when it would otherwise wrap output
# in markdown fences.
JSON_GUARDRAIL = (
    "\nYou must respond ONLY with valid JSON matching the exact schema provided. "
    "Do not include markdown formatting like ```json or any introductory text."
)

# bge-m3 max safe character length per text.
# The model has an 8192-token context (4096 in Ollama's default config).
# Texts beyond ~3000 characters cause attention-score overflow that produces
# NaN in the output embedding vector, which Ollama then can't JSON-encode.
_EMBED_MAX_CHARS = 2000


def safe_embed_texts(texts: list[str]) -> list[str]:
    """Truncate and sanitize texts before sending to the embedding model.
    Replaces empty/whitespace-only strings with a single space to avoid
    degenerate zero-norm vectors, and hard-caps length to prevent NaN overflow."""
    result = []
    for t in texts:
        t = (t or "").strip()
        if not t:
            t = " "  # empty string → degenerate vector → NaN
        result.append(t[:_EMBED_MAX_CHARS])
    return result


def safe_embed_documents(emb, texts: list[str]) -> list[list[float]]:
    """Sanitize inputs, embed with NaN-safe fallback.

    Fast path: embed the full batch (almost always succeeds).
    Slow path: if Ollama returns HTTP 500 because bge-m3 produced NaN in the
    output vector (Go's json.Marshal can't encode NaN), retry each text
    individually so only the ONE bad text gets a zero vector — all other texts
    keep real embeddings and cosine scoring stays meaningful.
    """
    import math
    dim = 1024  # bge-m3 output dimension
    sanitized = safe_embed_texts(texts)

    # Fast path — works for the vast majority of batches
    try:
        vecs = emb.embed_documents(sanitized)
        return [[0.0 if not math.isfinite(v) else v for v in vec] for vec in vecs]
    except Exception as exc:
        print(f"[embedding] batch embed failed ({exc}); retrying one-by-one to isolate bad text(s).")

    # Slow path — embed each text individually; only the failing one(s) become zero
    results: list[list[float]] = []
    for t in sanitized:
        try:
            vec = emb.embed_query(t)
            results.append([0.0 if not math.isfinite(v) else v for v in vec])
        except Exception as exc2:
            print(f"[embedding] single embed failed for text {t[:60]!r} ({exc2}); using zero vector.")
            results.append([0.0] * dim)
    return results
