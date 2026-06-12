import math
import os
import sys
import json
import time
import glob
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

# Ensure project root is on sys.path so core.persistence is importable
_ROOT = Path(__file__).parent.parent.resolve()
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from core.persistence import build_envelope, save_envelope  # noqa: E402

# ── Config ────────────────────────────────────────────────────────────────────
_HERE          = Path(__file__).parent
GROQ_API_KEY   = os.getenv("GROQ_API_KEY")
RAW_DATA_DIR   = str(_HERE / "raw_data")
OUTPUT_DIR     = str(_HERE / "output")
MODEL_LARGE    = "llama-3.3-70b-versatile"
DELAY_SECS     = 2.0
MIN_CONFIDENCE = 0.70

os.makedirs(OUTPUT_DIR, exist_ok=True)
client = Groq(api_key=GROQ_API_KEY)

# ── NAQAAE pillar inference tables ────────────────────────────────────────────
_PILLAR_KEYWORDS: dict[str, list[str]] = {
    "Pillar 7: Research & Innovation":      [
        "research", "publication", "innovation", "phd", "academic", "journal", "paper",
    ],
    "Pillar 6: Curriculum Design":          [
        "curriculum", "course", "syllabus", "subject", "major", "credit", "module", "outdated",
    ],
    "Pillar 4: Faculty Development":        [
        "faculty", "professor", "staff", "teaching", "instructor", "lecturer", "doctor",
    ],
    "Pillar 12: Digital Transformation":    [
        "digital", "ai", "artificial intelligence", "software", "cloud",
        "data science", "machine learning", "technology", "tech",
    ],
    "Pillar 9: International Partnerships": [
        "international", "partnership", "exchange", "abroad", "global", "foreign", "overseas",
    ],
    "Pillar 11: Financial Sustainability":  [
        "tuition", "fee", "financial", "salary", "cost", "economic", "budget", "expensive",
    ],
    "Pillar 5: Student Learning Outcomes":  [
        "student", "graduate", "learning", "outcome", "skill", "competency", "employment",
    ],
    "Pillar 8: Community Engagement":       [
        "community", "industry", "employer", "job", "market", "internship", "hiring", "demand",
    ],
}

_SWOT_DEFAULT_PILLAR: dict[str, str] = {
    "STRENGTH":    "Pillar 3: Quality Assurance Systems",
    "WEAKNESS":    "Pillar 5: Student Learning Outcomes",
    "OPPORTUNITY": "Pillar 8: Community Engagement",
    "THREAT":      "Pillar 2: Strategic Planning",
}


# ── Groq helpers ──────────────────────────────────────────────────────────────
def groq_call(prompt: str, system: str, max_tokens: int = 500) -> str:
    """Single Groq API call with smart retry — waits the correct time on rate limits."""
    import re as _re  # noqa: PLC0415
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
            err = str(e)
            # Parse "try again in Xs" from rate-limit error and wait that long
            m = _re.search(r"try again in (\d+(?:\.\d+)?)s", err, _re.IGNORECASE)
            wait = float(m.group(1)) + 2 if m else 5
            print(f"    [!] Groq error (attempt {attempt+1}/3) — waiting {wait:.0f}s: {err[:120]}")
            time.sleep(wait)
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
    return result if result else arabic_text


def classify(english_text: str) -> dict:
    """
    Step 2 — Full SWOT classification (Strength / Weakness / Opportunity / Threat / Irrelevant).
    Returns a dict with: type, theme, signal, confidence
    """
    system = (
        "You are a SWOT analyst for Nile University's ITCS AI faculty in Egypt. "
        "You analyze social media posts (and their comments) from university student groups "
        "to identify internal Strengths/Weaknesses and external Opportunities/Threats.\n\n"
        "Posts are informal student/parent social media messages. Be GENEROUS — even "
        "a single sentence that implies a strategic signal should be classified accordingly.\n\n"
        "Classify as exactly one of:\n"
        "- STRENGTH: internal positive factor — students praising professors or labs, "
        "parents comparing Nile University favourably to others, alumni getting good jobs, "
        "students recommending the university, mentions of strong departments or resources, "
        "quality teaching, strong research, modern facilities, good advisors.\n"
        "- WEAKNESS: internal negative factor — students complaining about courses, "
        "lack of guidance, bad professors, poor facilities, high failure rates, "
        "limited internship support, outdated curriculum, poor labs, administrative problems.\n"
        "- OPPORTUNITY: positive external factor — mentions of internships available, "
        "scholarships (full or partial), job offers after graduation, industry partnerships, "
        "AI/tech market demand for graduates, students hired at good companies, "
        "new programs or certifications, external collaborations.\n"
        "- THREAT: negative external factor — brain drain, students wanting to study abroad, "
        "fees increasing, better competing universities, market saturation, "
        "economic pressures, graduates struggling to find jobs, curriculum behind market.\n"
        "- IRRELEVANT: only if truly unrelated — exam schedules, WhatsApp numbers, "
        "birthday wishes, purely logistical questions with zero strategic content.\n\n"
        "Respond ONLY with a JSON object in this exact format:\n"
        "{\n"
        '  "type": "STRENGTH" | "WEAKNESS" | "OPPORTUNITY" | "THREAT" | "IRRELEVANT",\n'
        '  "theme": "short theme label e.g. Brain drain / Strong faculty / Scholarship availability",\n'
        '  "signal": "one sentence summarizing the SWOT signal found",\n'
        '  "confidence": 0.0 to 1.0\n'
        "}\n"
        "If IRRELEVANT, set theme and signal to empty strings and confidence to 1.0."
    )
    raw = groq_call(english_text, system, max_tokens=200)

    try:
        clean = raw.replace("```json", "").replace("```", "").strip()
        return json.loads(clean)
    except Exception:
        print(f"    [!] JSON parse failed: {raw[:80]}")
        return {"type": "IRRELEVANT", "theme": "", "signal": "", "confidence": 0.0}


# ── Aggregation helpers ───────────────────────────────────────────────────────

def _theme_similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio()


def _group_signals(signals: list[dict], threshold: float = 0.65) -> list[list[dict]]:
    """
    Fuzzy-group signals by theme similarity, but ONLY within the same SWOT type.
    Grouping across types is intentionally forbidden: a THREAT post about
    "lack of internships" must never be merged into a WEAKNESS group with a
    similar theme, as that would inflate S/W counts while starving O/T cards.
    """
    by_type: dict[str, list[dict]] = {}
    for signal in signals:
        t = signal.get("swot_type", "")
        by_type.setdefault(t, []).append(signal)

    all_groups: list[list[dict]] = []
    for type_signals in by_type.values():
        type_groups: list[list[dict]] = []
        for signal in type_signals:
            theme = (signal.get("theme") or "").strip()
            if not theme:
                continue
            placed = False
            for group in type_groups:
                anchor = (group[0].get("theme") or "").strip()
                if _theme_similarity(theme, anchor) >= threshold:
                    group.append(signal)
                    placed = True
                    break
            if not placed:
                type_groups.append([signal])
        all_groups.extend(type_groups)
    return all_groups


def _infer_pillar(theme: str, signal: str, swot_type: str) -> str:
    """Map a SWOT signal to the most relevant NAQAAE pillar via keyword scan."""
    text = (theme + " " + signal).lower()
    for pillar, kws in _PILLAR_KEYWORDS.items():
        if any(kw in text for kw in kws):
            return pillar
    return _SWOT_DEFAULT_PILLAR.get(swot_type, "Pillar 2: Strategic Planning")


def _calc_confidence(reference_count: int, total_likes: int) -> int:
    """
    Weighted confidence score (0-100) calibrated for 30-post scrapes.
      frequency contribution  → min(60, reference_count × 20)  — 3 posts fills the base
      engagement contribution → min(40, log1p(total_likes) × 8)
    Examples: 1 post/0 likes=20, 2 posts/0 likes=40, 3 posts/0 likes=60, 3 posts/5 likes=71
    """
    base  = min(60, reference_count * 20)
    boost = min(40, math.log1p(total_likes) * 8)
    return min(100, int(base + boost))


def _impact_level(confidence: int) -> str:
    if confidence >= 75:
        return "critical"
    if confidence >= 50:
        return "high"
    if confidence >= 30:
        return "medium"
    return "low"


# ── Main pipeline ─────────────────────────────────────────────────────────────
def process_file(json_path: str):
    print(f"\n[*] Loading: {json_path}")
    with open(json_path, "r", encoding="utf-8") as f:
        posts = json.load(f)

    print(f"[*] Total posts to process: {len(posts)}")

    results       = []
    strengths     = 0
    weaknesses    = 0
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

        # ── Enrich with up to 3 relevant comment snippets ─────────────────
        rel_comments = [
            c["text"][:120] for c in post.get("comments", [])
            if c.get("relevant") and c.get("text", "").strip()
        ][:3]
        context = text
        if rel_comments:
            context += "\n[Comments: " + " | ".join(rel_comments) + "]"

        # ── Step 1: Translate ──────────────────────────────────────────────
        translated = translate(context)
        print(f"  Trans: {translated[:70]}...")
        time.sleep(DELAY_SECS)

        # ── Step 2: Full SWOT classify ─────────────────────────────────────
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
        if sig_type == "STRENGTH":
            strengths += 1
        elif sig_type == "WEAKNESS":
            weaknesses += 1
        elif sig_type == "OPPORTUNITY":
            opportunities += 1
        elif sig_type == "THREAT":
            threats += 1
        else:
            irrelevant += 1

        print(f"  → {sig_type} | conf={confidence:.2f} | theme='{theme}'")
        if signal:
            print(f"  → signal: {signal[:80]}")

        results.append({
            "post_text":          text,
            "post_likes":         post.get("likes", 0),
            "date_str":           post.get("date_str", "unknown"),
            "source_group":       post.get("source_group", ""),
            "source_university":  post.get("source_university", ""),
            "scraped_at":         post.get("scraped_at", ""),
            "matched_categories": post.get("matched_categories", []),
            "matched_keywords":   post.get("matched_keywords", []),
            "translated_text":    translated,
            "swot_type":          sig_type,
            "theme":              theme,
            "signal":             signal,
            "confidence":         confidence,
            "relevant_comments":  [
                c for c in post.get("comments", [])
                if c.get("relevant", False)
            ],
        })

    # ── Save all results ───────────────────────────────────────────────────
    all_path = os.path.join(OUTPUT_DIR, "all_results.json")
    with open(all_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    # ── Save all SWOT signals (S + W + O + T, no IRRELEVANT) ──────────────
    _SWOT_TYPES = {"STRENGTH", "WEAKNESS", "OPPORTUNITY", "THREAT"}
    signals = [r for r in results if r["swot_type"] in _SWOT_TYPES]
    signals_path = os.path.join(OUTPUT_DIR, "ot_signals.json")
    with open(signals_path, "w", encoding="utf-8") as f:
        json.dump(signals, f, ensure_ascii=False, indent=2)

    print(f"\n{'='*55}")
    print(f"  DONE")
    print(f"{'='*55}")
    print(f"  Total processed : {len(results)}")
    print(f"  Strengths       : {strengths}")
    print(f"  Weaknesses      : {weaknesses}")
    print(f"  Opportunities   : {opportunities}")
    print(f"  Threats         : {threats}")
    print(f"  Irrelevant      : {irrelevant}")
    print(f"  Dropped (conf)  : {low_conf}")
    print(f"{'='*55}")
    print(f"  Saved all results  → {all_path}")
    print(f"  Saved SWOT signals → {signals_path}")


def main():
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

    Always runs a fresh scrape then the full NLP pipeline so the output
    reflects live Facebook group data, not a stale cache.

    Returns InsightCard-compatible dicts for all 4 SWOT categories,
    aggregated using fuzzy deduplication and weighted confidence scoring.
    """
    import sys as _sys

    _AGENT_DIR   = Path(__file__).parent
    _OUTPUT_FILE = _AGENT_DIR / "output" / "ot_signals.json"
    _RAW_DIR     = _AGENT_DIR / "raw_data"

    # ── Step 1: scrape (skip if data from the last 2 hours already exists) ──
    if str(_AGENT_DIR) not in _sys.path:
        _sys.path.insert(0, str(_AGENT_DIR))

    scrape_status = "unknown"
    scrape_error  = ""

    # Check for a recently scraped file (within the last 2 hours)
    _existing = sorted(_RAW_DIR.glob("scraped_*.json"))
    _recent = None
    if _existing:
        import time as _time  # noqa: PLC0415
        _age_secs = _time.time() - _existing[-1].stat().st_mtime
        if _age_secs < 7200:  # less than 2 hours old
            _recent = str(_existing[-1])

    if _recent:
        raw_data_path = _recent
        scrape_status = "recent_cache"
        print(f"[social] Recent scrape found ({int(_age_secs/60)}m old) → {_recent}")
        print("[social] Skipping scraper — using existing data.")
    else:
        try:
            from scraper import run_scrape  # noqa: PLC0415
            print("[social] Starting fresh Facebook scrape...")
            scraped_path = run_scrape(headless=False, verification_wait=90)
            if scraped_path:
                raw_data_path = scraped_path
                scrape_status = "fresh"
                print(f"[social] Fresh scrape saved → {scraped_path}")
            else:
                scrape_status = "failed_no_path"
                scrape_error  = "run_scrape() returned None — browser may have closed early"
                print(f"[social] Scraper returned no path: {scrape_error}")
        except Exception as exc:
            scrape_status = "failed_exception"
            scrape_error  = str(exc)
            print(f"[social] Scraper exception: {scrape_error}")
            print("[social] Falling back to latest existing raw file")

    # ── Step 2: resolve which raw file to process ──────────────────────────
    if not raw_data_path:
        raw_files = sorted(_RAW_DIR.glob("scraped_*.json"))
        if not raw_files:
            return {
                "insights": [], "strengths": 0, "weaknesses": 0,
                "opportunities": 0, "threats": 0,
                "total_posts_analyzed": 0,
                "scrape_status": scrape_status,
                "scrape_error":  scrape_error,
                "error": "No scraped data found — run scraper.py first.",
            }
        raw_data_path = str(raw_files[-1])
        scrape_status = scrape_status if scrape_status == "fresh" else "fallback"
        print(f"[social] Using file: {raw_data_path}  [status={scrape_status}]")

    # ── Step 3: always rerun NLP pipeline on the (fresh) data ─────────────
    print(f"[social] Running NLP pipeline on {raw_data_path}...")
    process_file(raw_data_path)

    with open(_OUTPUT_FILE, "r", encoding="utf-8") as f:
        signals: list[dict] = json.load(f)

    # ── Step 4: fuzzy-group by theme similarity ────────────────────────────
    groups = _group_signals(signals, threshold=0.65)

    now      = datetime.now(timezone.utc).isoformat()
    insights: list[dict] = []

    for idx, group in enumerate(groups):
        best      = max(group, key=lambda p: p.get("confidence", 0))
        swot_type = best.get("swot_type", "THREAT")
        theme     = best.get("theme", "Unknown")
        category  = swot_type.lower()  # "strength" | "weakness" | "opportunity" | "threat"

        # ── Engagement totals across all posts in this group ──────────────
        total_likes = sum(p.get("post_likes", 0) for p in group)
        ref_count   = len(group)

        # ── Weighted confidence & impact ───────────────────────────────────
        conf_score = _calc_confidence(ref_count, total_likes)
        impact     = _impact_level(conf_score)
        pillar     = _infer_pillar(theme, best.get("signal", ""), swot_type)

        # ── Evidence — unified structure for all 4 SWOT types ────────────
        sample_signals = "; ".join(
            p.get("signal", "") for p in group[:3] if p.get("signal")
        )
        avg_conf = round(sum(p.get("confidence", 0) for p in group) / ref_count, 2)

        insights.append({
            "id":               f"sm-{idx + 1:02d}-{theme[:14].lower().replace(' ', '-')}",
            "category":         category,
            "title":            theme,
            "description":      best.get("signal", ""),
            "pillar_tag":       pillar,
            "impact_level":     impact,
            "confidence_score": conf_score,
            "reference_count":  ref_count,
            "created_at":       now,
            "data_source":      "live",
            "is_validated":     False,
            "ai_suggestion":    True,
            "evidence": {
                "type":            "statistical",
                "formula":         "confidence = min(60, ref_count×10) + min(40, log1p(total_likes)×7)",
                "raw_value":       best.get("signal", ""),
                "source_document": best.get("source_group", ""),
                "explanation": (
                    f"Aggregated from {ref_count} {swot_type} post(s) with "
                    f"{total_likes} total likes (similarity-grouped within type). "
                    f"Samples: {sample_signals}"
                ),
                "data_points": {
                    "posts_analyzed": ref_count,
                    "total_likes":    total_likes,
                    "avg_confidence": avg_conf,
                    "weighted_score": conf_score,
                    "swot_category":  swot_type,
                    "source_group":   best.get("source_group", ""),
                },
            },
        })

    # ── Per-type counts — derived from grouped cards so they match the frontend ──
    # Raw signal counts can differ from card counts when fuzzy deduplication
    # merges multiple posts with similar themes into a single insight card.
    n_str = sum(1 for c in insights if c["category"] == "strength")
    n_wk  = sum(1 for c in insights if c["category"] == "weakness")
    n_opp = sum(1 for c in insights if c["category"] == "opportunity")
    n_thr = sum(1 for c in insights if c["category"] == "threat")

    print(
        f"[social] Done. {n_str}S / {n_wk}W / {n_opp}O / {n_thr}T "
        f"→ {len(insights)} insight cards."
    )

    _persist_run(insights, len(signals))

    return {
        "insights":             insights,
        "strengths":            n_str,
        "weaknesses":           n_wk,
        "opportunities":        n_opp,
        "threats":              n_thr,
        "total_posts_analyzed": len(signals),
        "scrape_status":        scrape_status,
        "scrape_error":         scrape_error,
    }


def _persist_run(insights: list[dict], total_posts: int) -> None:
    """Save the social media run to Supabase via the unified persistence pipeline."""
    swot_items = [
        {
            "type": ins["category"],
            "title": ins.get("title", ""),
            "description": ins.get("description", ""),
            "evidence": [ins["evidence"]] if ins.get("evidence") else [],
            "impact_level": ins.get("impact_level"),
            "source_metadata": {
                "confidence_score": ins.get("confidence_score"),
                "reference_count": ins.get("reference_count"),
                "data_source": "social_media",
            },
        }
        for ins in insights
    ]
    try:
        envelope = build_envelope(
            agent_id="social_media",
            swot_items=swot_items,
            structured_data={"total_posts_analyzed": total_posts},
        )
        save_envelope(envelope)
    except Exception as exc:
        print(f"[social] unified envelope save failed: {exc}")
