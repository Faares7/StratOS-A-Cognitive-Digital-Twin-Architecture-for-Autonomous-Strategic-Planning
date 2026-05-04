import os
import json
import time
import glob
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────
GROQ_API_KEY   = os.getenv("GROQ_API_KEY")
RAW_DATA_DIR   = "raw_data"
OUTPUT_DIR     = "output"
MODEL_LARGE    = "llama-3.3-70b-versatile"   # translation + classification
DELAY_SECS     = 2.0                          # delay between API calls (rate limit)
MIN_CONFIDENCE = 0.70                         # drop anything below this

os.makedirs(OUTPUT_DIR, exist_ok=True)
client = Groq(api_key=GROQ_API_KEY)


# ── Groq helpers ──────────────────────────────────────────────────────────────
def groq_call(prompt: str, system: str, max_tokens: int = 500) -> str:
    """Single Groq API call with basic retry logic."""
    for attempt in range(3):
        try:
            response = client.chat.completions.create(
                model=MODEL_LARGE,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user",   "content": prompt},
                ],
                max_tokens=max_tokens,
                temperature=0.1,
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            print(f"    [!] Groq error (attempt {attempt+1}/3): {e}")
            time.sleep(5)
    return ""


def translate(arabic_text: str) -> str:
    """Step 1 — Translate Arabic/Arabizi post to English."""
    system = (
        "You are an expert translator specializing in Egyptian Arabic dialect "
        "and Arabizi (Arabic written in Latin script). "
        "Translate the following social media post to natural English. "
        "Preserve the meaning and sentiment exactly. "
        "Return ONLY the translated text, nothing else."
    )
    result = groq_call(arabic_text, system, max_tokens=300)
    return result if result else arabic_text  # fallback to original if failed


def classify(english_text: str) -> dict:
    """
    Step 2 — Classify translated text as OPPORTUNITY, THREAT, or IRRELEVANT.
    Returns a dict with: type, theme, signal, confidence
    """
    system = (
        "You are a SWOT analyst for Nile University's ITCS AI faculty in Egypt. "
        "You analyze social media posts from university student groups to identify "
        "external Opportunities and Threats for the faculty.\n\n"
        "Classify the post as one of:\n"
        "- OPPORTUNITY: positive external factor (industry demand, scholarships, "
        "partnerships, emerging tech trends, job market growth)\n"
        "- THREAT: negative external factor (brain drain, market saturation, "
        "competitor universities doing better, economic pressures, outdated curriculum "
        "relative to market, lack of industry connections)\n"
        "- IRRELEVANT: personal chat, unrelated topics, jokes, birthday wishes\n\n"
        "Respond ONLY with a JSON object in this exact format:\n"
        "{\n"
        '  "type": "OPPORTUNITY" | "THREAT" | "IRRELEVANT",\n'
        '  "theme": "short theme label e.g. Brain drain / Industry demand / Tuition costs",\n'
        '  "signal": "one sentence summarizing the O/T signal found",\n'
        '  "confidence": 0.0 to 1.0\n'
        "}\n"
        "If IRRELEVANT, set theme and signal to empty strings and confidence to 1.0."
    )
    raw = groq_call(english_text, system, max_tokens=200)

    # Parse JSON safely
    try:
        # Strip markdown fences if model adds them
        clean = raw.replace("```json", "").replace("```", "").strip()
        return json.loads(clean)
    except Exception:
        print(f"    [!] JSON parse failed: {raw[:80]}")
        return {
            "type":       "IRRELEVANT",
            "theme":      "",
            "signal":     "",
            "confidence": 0.0,
        }


# ── Main pipeline ─────────────────────────────────────────────────────────────
def process_file(json_path: str):
    print(f"\n[*] Loading: {json_path}")
    with open(json_path, "r", encoding="utf-8") as f:
        posts = json.load(f)

    print(f"[*] Total posts to process: {len(posts)}")

    results      = []
    opportunities = 0
    threats       = 0
    irrelevant    = 0
    low_conf      = 0

    for i, post in enumerate(posts):
        text = post.get("post_text", "").strip()
        if not text:
            continue

        print(f"\n  [{i+1:03d}/{len(posts)}] Processing...")
        print(f"  Post: {text[:70]}...")

        # ── Step 1: Translate ──────────────────────────────────────────────
        translated = translate(text)
        print(f"  Trans: {translated[:70]}...")
        time.sleep(DELAY_SECS)

        # ── Step 2: Classify ───────────────────────────────────────────────
        classification = classify(translated)
        time.sleep(DELAY_SECS)

        sig_type   = classification.get("type", "IRRELEVANT")
        theme      = classification.get("theme", "")
        signal     = classification.get("signal", "")
        confidence = float(classification.get("confidence", 0.0))

        # ── Confidence filter ──────────────────────────────────────────────
        if sig_type != "IRRELEVANT" and confidence < MIN_CONFIDENCE:
            print(f"  [drop] low confidence ({confidence:.2f}) — discarding")
            low_conf += 1
            sig_type = "IRRELEVANT"

        # ── Count ──────────────────────────────────────────────────────────
        if sig_type == "OPPORTUNITY":
            opportunities += 1
        elif sig_type == "THREAT":
            threats += 1
        else:
            irrelevant += 1

        print(f"  → {sig_type} | conf={confidence:.2f} | theme='{theme}'")
        if signal:
            print(f"  → signal: {signal[:80]}")

        # ── Build result record ────────────────────────────────────────────
        result = {
            # Original fields
            "post_text":          text,
            "date_str":           post.get("date_str", "unknown"),
            "source_group":       post.get("source_group", ""),
            "source_university":  post.get("source_university", ""),
            "scraped_at":         post.get("scraped_at", ""),
            "matched_categories": post.get("matched_categories", []),
            "matched_keywords":   post.get("matched_keywords", []),
            # NLP output
            "translated_text":    translated,
            "swot_type":          sig_type,
            "theme":              theme,
            "signal":             signal,
            "confidence":         confidence,
            # Comments (only relevant ones)
            "relevant_comments": [
                c for c in post.get("comments", [])
                if c.get("relevant", False)
            ],
        }
        results.append(result)

    # ── Save all results ───────────────────────────────────────────────────
    all_path = os.path.join(OUTPUT_DIR, "all_results.json")
    with open(all_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    # ── Save only O and T signals ──────────────────────────────────────────
    signals = [r for r in results if r["swot_type"] in ("OPPORTUNITY", "THREAT")]
    signals_path = os.path.join(OUTPUT_DIR, "ot_signals.json")
    with open(signals_path, "w", encoding="utf-8") as f:
        json.dump(signals, f, ensure_ascii=False, indent=2)

    # ── Print summary ──────────────────────────────────────────────────────
    print(f"\n{'='*55}")
    print(f"  DONE")
    print(f"{'='*55}")
    print(f"  Total processed : {len(results)}")
    print(f"  Opportunities   : {opportunities}")
    print(f"  Threats         : {threats}")
    print(f"  Irrelevant      : {irrelevant}")
    print(f"  Dropped (conf)  : {low_conf}")
    print(f"{'='*55}")
    print(f"  Saved all results → {all_path}")
    print(f"  Saved O/T signals → {signals_path}")


def main():
    # Auto-find the most recent scraped JSON file
    files = sorted(glob.glob(os.path.join(RAW_DATA_DIR, "scraped_*.json")))
    if not files:
        print("[!] No scraped JSON files found in raw_data/")
        print("    Run scraper.py first.")
        return

    latest = files[-1]
    print(f"[*] Found {len(files)} scraped file(s) — using latest: {latest}")
    process_file(latest)


if __name__ == "__main__":
    main()


# ── API entry point ───────────────────────────────────────────────────────────

def compile_and_run(raw_data_path: str | None = None) -> dict:
    """
    Entry point for the FastAPI bridge.

    Fast path: if output/ot_signals.json already exists (from a previous pipeline
    run), reads it directly — no Groq calls needed, responds instantly.

    Slow path: if no output exists, runs the full NLP pipeline on the latest
    scraped JSON file (requires GROQ_API_KEY and takes several minutes).

    Returns InsightCard-compatible dicts grouped by theme, plus counts.
    """
    _AGENT_DIR = Path(__file__).parent
    _OUTPUT_FILE = _AGENT_DIR / "output" / "ot_signals.json"
    _RAW_DIR = _AGENT_DIR / "raw_data"

    if _OUTPUT_FILE.exists():
        print(f"[social] Reading cached output from {_OUTPUT_FILE}")
        with open(_OUTPUT_FILE, "r", encoding="utf-8") as f:
            signals: list[dict] = json.load(f)
    else:
        # Find latest raw scrape and run the pipeline
        raw_files = sorted(_RAW_DIR.glob("scraped_*.json"))
        if not raw_files:
            return {
                "insights": [], "opportunities": 0, "threats": 0,
                "total_posts_analyzed": 0,
                "error": "No scraped data found — run scraper.py first.",
            }
        target = raw_data_path or str(raw_files[-1])
        print(f"[social] Running NLP pipeline on {target}...")
        process_file(target)
        with open(_OUTPUT_FILE, "r", encoding="utf-8") as f:
            signals = json.load(f)

    # Group by (swot_type, theme) → one InsightCard per group
    by_theme: dict[str, list[dict]] = defaultdict(list)
    for s in signals:
        theme = (s.get("theme") or "").strip()
        if theme:
            by_theme[theme].append(s)

    now = datetime.now(timezone.utc).isoformat()
    insights: list[dict] = []

    for idx, (theme, posts) in enumerate(by_theme.items()):
        best = max(posts, key=lambda p: p.get("confidence", 0))
        swot_type = best.get("swot_type", "THREAT")
        category = "opportunity" if swot_type == "OPPORTUNITY" else "threat"
        confidence = int(best.get("confidence", 0.8) * 100)
        count = len(posts)

        pillar = (
            "Pillar 8: Community Engagement"
            if category == "opportunity"
            else "Pillar 2: Strategic Planning"
        )
        impact = "high" if count >= 3 else "medium" if count >= 2 else "low"

        insights.append({
            "id": f"sm-{idx + 1:02d}-{theme[:14].lower().replace(' ', '-')}",
            "category": category,
            "title": theme,
            "description": best.get("signal", ""),
            "pillar_tag": pillar,
            "impact_level": impact,
            "confidence_score": confidence,
            "reference_count": count,
            "created_at": now,
            "data_source": "live",
            "is_validated": False,
            "ai_suggestion": True,
            "evidence": {
                "type": "raw_text",
                "explanation": "; ".join(
                    p.get("signal", "") for p in posts[:3] if p.get("signal")
                ),
                "data_points": {
                    "posts_analyzed": count,
                    "source_group": best.get("source_group", ""),
                    "avg_confidence": round(
                        sum(p.get("confidence", 0) for p in posts) / count, 2
                    ),
                },
            },
        })

    opps = sum(1 for s in signals if s.get("swot_type") == "OPPORTUNITY")
    threats = sum(1 for s in signals if s.get("swot_type") == "THREAT")

    print(f"[social] Done. {opps} opportunities, {threats} threats across {len(insights)} themes.")
    return {
        "insights": insights,
        "opportunities": opps,
        "threats": threats,
        "total_posts_analyzed": len(signals),
    }