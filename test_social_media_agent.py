"""
Standalone test runner for the Social Media Scraping Agent.

Usage:
  python test_social_media_agent.py              # visible Chrome (default)
  python test_social_media_agent.py --headless   # headless Chrome
  python test_social_media_agent.py --skip-scrape  # skip scraping, use cached/existing raw data

Output is dumped to test_social_media_result.json in the project root.
All TRACE prints from scraper.py and nlp_pipeline.py are visible here.
"""

import sys
import json
import os
from pathlib import Path
from datetime import datetime

# ── Path setup ────────────────────────────────────────────────────────────────
ROOT_DIR = Path(__file__).parent
AGENT_DIR = ROOT_DIR / "Social Media Scraping Agent"
sys.path.insert(0, str(AGENT_DIR))

# Load .env from project root
from dotenv import load_dotenv
load_dotenv(ROOT_DIR / ".env")

# ── Parse args ────────────────────────────────────────────────────────────────
args = sys.argv[1:]
headless    = "--headless"    in args
skip_scrape = "--skip-scrape" in args

# ── Print header ──────────────────────────────────────────────────────────────
print()
print("=" * 65)
print("  SOCIAL MEDIA AGENT — STANDALONE TEST RUNNER")
print("=" * 65)
print(f"  Mode        : {'headless' if headless else 'visible Chrome'}")
print(f"  Skip scrape : {skip_scrape}")
print(f"  FB_EMAIL    : {'SET ✓' if os.getenv('FB_EMAIL') else 'NOT SET ✗'}")
print(f"  FB_PASSWORD : {'SET ✓' if os.getenv('FB_PASSWORD') else 'NOT SET ✗'}")
print(f"  GROQ_API_KEY: {'SET ✓' if os.getenv('GROQ_API_KEY') else 'NOT SET ✗'}")
print(f"  Started at  : {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
print("=" * 65)
print()

# ── Import agent modules ───────────────────────────────────────────────────────
try:
    import scraper as sc
    import nlp_pipeline as nlp
    print("[test] Imports OK")
except ImportError as e:
    print(f"[test] IMPORT ERROR: {e}")
    print(f"  Make sure you're running from the project root.")
    sys.exit(1)

# ── Step 1: Scrape (optional) ─────────────────────────────────────────────────
if skip_scrape:
    print("[test] --skip-scrape: skipping Facebook scraping step")
    raw_files = sorted((AGENT_DIR / "raw_data").glob("scraped_*.json"))
    if not raw_files:
        print("[test] ERROR: No raw data files found in Social Media Scraping Agent/raw_data/")
        print("  Run without --skip-scrape first to generate raw data.")
        sys.exit(1)
    print(f"[test] Found {len(raw_files)} raw file(s) — using: {raw_files[-1].name}")
    raw_path = str(raw_files[-1])
else:
    print(f"[test] Starting Facebook scrape (headless={headless}) ...")
    print("-" * 65)
    try:
        raw_path = sc.run_scrape(headless=headless, verification_wait=0)
        print("-" * 65)
        if raw_path:
            print(f"[test] Scrape complete → {raw_path}")
        else:
            print("[test] WARNING: run_scrape returned None — no posts saved")
    except Exception as exc:
        print("-" * 65)
        print(f"[test] SCRAPE FAILED: {exc}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

# ── Step 2: NLP pipeline ──────────────────────────────────────────────────────
print()
print("[test] Running NLP pipeline (translate + classify) ...")
print("-" * 65)
try:
    result = nlp.compile_and_run(raw_path if not skip_scrape else None)
    print("-" * 65)
except Exception as exc:
    print("-" * 65)
    print(f"[test] NLP PIPELINE FAILED: {exc}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# ── Step 3: Print summary ─────────────────────────────────────────────────────
print()
print("=" * 65)
print("  RESULT SUMMARY")
print("=" * 65)
print(f"  Opportunities : {result.get('opportunities', 0)}")
print(f"  Threats       : {result.get('threats', 0)}")
print(f"  Total posts   : {result.get('total_posts_analyzed', 0)}")
print(f"  Insights cards: {len(result.get('insights', []))}")
if result.get("error"):
    print(f"  ERROR: {result['error']}")
print("=" * 65)

for i, card in enumerate(result.get("insights", [])[:5], 1):
    print(f"\n  [{i}] {card.get('category','?').upper()} — {card.get('title','')}")
    print(f"       {card.get('description','')[:80]}")
    print(f"       confidence={card.get('confidence_score')}%  impact={card.get('impact_level')}")

if len(result.get("insights", [])) > 5:
    print(f"\n  ... and {len(result['insights']) - 5} more (see test_social_media_result.json)")

# ── Step 4: Dump full result ───────────────────────────────────────────────────
out_path = ROOT_DIR / "test_social_media_result.json"
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, indent=2)

print()
print(f"[test] Full result saved → {out_path}")
print(f"[test] Finished at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
print()
