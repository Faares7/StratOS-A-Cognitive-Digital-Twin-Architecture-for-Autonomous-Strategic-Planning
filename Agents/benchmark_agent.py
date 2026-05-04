import os
import requests
import psycopg2
from psycopg2.extras import Json
import time
from dotenv import load_dotenv

load_dotenv()

DB_CONNECTION_STRING = os.getenv("DB_CONNECTION_STRING", "")
_OPENALEX_HEADERS = {"User-Agent": "StratOS/1.0 (mailto:admin@nileuniversity.edu.eg)"}


def get_db_connection():
    if not DB_CONNECTION_STRING:
        raise RuntimeError("DB_CONNECTION_STRING is not set in environment.")
    return psycopg2.connect(DB_CONNECTION_STRING)


# ── Fast bulk fetch (listing endpoint — no per-university detail call) ─────────

def fetch_all_universities_bulk() -> list[dict]:
    """
    Fetch all Egyptian university records in a few paginated calls.
    OpenAlex listing includes works_count, cited_by_count, summary_stats, counts_by_year
    so no per-university detail request is needed.
    """
    select = "id,display_name,works_count,cited_by_count,summary_stats,counts_by_year"
    base = (
        "https://api.openalex.org/institutions"
        f"?filter=country_code:EG,type:education&per_page=50&select={select}"
    )
    all_results: list[dict] = []
    page = 1

    while True:
        try:
            resp = requests.get(
                f"{base}&page={page}",
                timeout=30,
                headers=_OPENALEX_HEADERS,
            )
            resp.raise_for_status()
        except Exception as e:
            print(f"[benchmark] OpenAlex page {page} error: {e}")
            break

        data = resp.json()
        results = data.get("results", [])
        if not results:
            break

        all_results.extend(results)
        print(f"[benchmark] Fetched page {page} ({len(all_results)} universities so far)")
        page += 1
        time.sleep(0.1)

    return all_results


def _parse_university(inst: dict) -> dict:
    inst_id = inst["id"].replace("https://openalex.org/", "")
    yearly_data = inst.get("counts_by_year", [])
    total_publications = inst.get("works_count", 0)
    total_oa = sum(y.get("oa_works_count", 0) for y in yearly_data)
    return {
        "institution_id": inst_id,
        "display_name": inst.get("display_name", ""),
        "total_publications": total_publications,
        "total_citations": inst.get("cited_by_count", 0),
        "h_index": inst.get("summary_stats", {}).get("h_index", 0),
        "open_access_pct": (
            round((total_oa / total_publications) * 100)
            if total_publications > 0 else 0
        ),
        "h_index_history": [
            {"year": y["year"], "value": y.get("works_count", 0)}
            for y in sorted(yearly_data, key=lambda x: x.get("year", 0))
            if y.get("year", 0) >= 2019
        ],
    }


# ── Internal helpers shared by API and DB pipeline ────────────────────────────

def _fetch_all_parsed() -> list[dict]:
    """Fetch and parse all universities (sorted by h-index desc). No DB, no formatting."""
    print("[benchmark] Starting bulk fetch from OpenAlex...")
    raw = fetch_all_universities_bulk()
    print(f"[benchmark] Parsing {len(raw)} universities...")
    all_data = []
    for inst in raw:
        try:
            all_data.append(_parse_university(inst))
        except Exception as e:
            print(f"[benchmark] Parse error for {inst.get('id', '?')}: {e}")
    all_data.sort(key=lambda u: u.get("h_index", 0), reverse=True)
    return all_data


def _format_result(all_data: list[dict], errors: list[str] | None = None) -> dict:
    """Format parsed list into ResearchIntelligence-compatible dict for the frontend."""
    NILE_ID = "I57629906"
    nile_u = next(
        (u for u in all_data
         if u["institution_id"] == NILE_ID
         or "nile" in (u.get("display_name") or "").lower()),
        None,
    )
    nile_rank = next(
        (i + 1 for i, u in enumerate(all_data) if u is nile_u),
        None,
    )
    competitors = [u for u in all_data if u is not nile_u]

    def to_metrics(u: dict, rank: int | None = None) -> dict:
        return {
            "university_name": u.get("display_name", "Unknown"),
            "publications": u.get("total_publications", 0),
            "h_index": u.get("h_index", 0),
            "total_citations": u.get("total_citations", 0),
            "h_index_history": u.get("h_index_history", []),
            "rank": rank,
        }

    print(f"[benchmark] Done. Nile found: {nile_u is not None} (rank {nile_rank}). Competitors: {len(competitors)}")
    return {
        "nile_university": to_metrics(nile_u, nile_rank) if nile_u else {
            "university_name": "Nile University",
            "publications": 0, "h_index": 0, "total_citations": 0,
            "h_index_history": [], "rank": None,
        },
        "competitors": [to_metrics(u, i + 1) for i, u in enumerate(competitors[:10])],
        "data_source": "live",
        "errors": errors or [],
    }


# ── Background DB save ─────────────────────────────────────────────────────────

def _upsert_university(uni: dict, conn) -> None:
    """Write one parsed university dict to Supabase (no extra HTTP call)."""
    cursor = conn.cursor()
    try:
        inst_id = uni["institution_id"]
        cursor.execute("""
            INSERT INTO universities (institution_id, display_name, country_code,
                total_publications, total_citations, open_access_percentage, h_index)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (institution_id) DO UPDATE SET
                display_name = EXCLUDED.display_name,
                total_publications = EXCLUDED.total_publications,
                total_citations = EXCLUDED.total_citations,
                open_access_percentage = EXCLUDED.open_access_percentage,
                h_index = EXCLUDED.h_index;
        """, (
            inst_id, uni.get("display_name", ""), "EG",
            uni.get("total_publications", 0), uni.get("total_citations", 0),
            uni.get("open_access_pct", 0), uni.get("h_index", 0),
        ))
        for hist in uni.get("h_index_history", []):
            cursor.execute("""
                INSERT INTO university_yearly_stats (institution_id, year, papers_count, citations_count)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (institution_id, year) DO UPDATE SET
                    papers_count = EXCLUDED.papers_count;
            """, (inst_id, hist["year"], hist["value"], 0))
        conn.commit()
        print(f"[benchmark:db] Saved: {uni.get('display_name', inst_id)}")
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()


def write_all_to_db(all_data: list[dict]) -> None:
    """
    Write all parsed university data to Supabase.
    Intended to be called in a daemon thread *after* the job result is already
    returned to the frontend, so DB latency never affects the user.
    """
    conn = None
    try:
        conn = get_db_connection()
    except Exception as e:
        print(f"[benchmark:db] DB unavailable, skipping save: {e}")
        return

    print(f"[benchmark:db] Starting background save for {len(all_data)} universities...")
    for uni in all_data:
        try:
            _upsert_university(uni, conn)
        except Exception as e:
            print(f"[benchmark:db] Error for {uni.get('display_name', '?')}: {e}")
    conn.close()
    print("[benchmark:db] Background DB save complete.")


# ── Public API entry point ────────────────────────────────────────────────────

def compile_and_run() -> dict:
    """
    Fast entry point for the FastAPI bridge (no DB writes).
    The API task calls _fetch_all_parsed() + _format_result() directly so it can
    hand off all_data to write_all_to_db() in a daemon thread after finishing the job.
    """
    all_data = _fetch_all_parsed()
    return _format_result(all_data)


# ── Legacy per-university helpers (nightly DB pipeline only) ──────────────────

def fetch_egyptian_universities():
    print("Fetching list of Egyptian Universities from OpenAlex...")
    institutions = []
    page = 1
    while True:
        url = (
            "https://api.openalex.org/institutions"
            f"?filter=country_code:EG,type:education&per_page=50&page={page}"
        )
        response = requests.get(url, timeout=30, headers=_OPENALEX_HEADERS)
        data = response.json()
        results = data.get("results", [])
        if not results:
            break
        for inst in results:
            institutions.append(inst["id"].replace("https://openalex.org/", ""))
        page += 1
        time.sleep(0.1)
    print(f"Found {len(institutions)} universities.")
    return institutions


def process_university(inst_id, conn):
    url = f"https://api.openalex.org/institutions/{inst_id}"
    response = requests.get(url, timeout=15, headers=_OPENALEX_HEADERS)
    if response.status_code != 200:
        print(f"Failed to fetch details for {inst_id}")
        return
    stats = response.json()
    display_name = stats.get("display_name")
    country_code = stats.get("country_code")
    total_publications = stats.get("works_count", 0)
    total_citations = stats.get("cited_by_count", 0)
    h_index = stats.get("summary_stats", {}).get("h_index", 0)
    yearly_data = stats.get("counts_by_year", [])
    total_oa = sum(y.get("oa_works_count", 0) for y in yearly_data)
    open_access_percentage = (
        round((total_oa / total_publications) * 100) if total_publications > 0 else 0
    )
    cursor = conn.cursor()
    try:
        cursor.execute("""
            INSERT INTO universities (institution_id, display_name, country_code,
                total_publications, total_citations, open_access_percentage, h_index)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (institution_id) DO UPDATE SET
                display_name = EXCLUDED.display_name, country_code = EXCLUDED.country_code,
                total_publications = EXCLUDED.total_publications,
                total_citations = EXCLUDED.total_citations,
                open_access_percentage = EXCLUDED.open_access_percentage,
                h_index = EXCLUDED.h_index;
        """, (inst_id, display_name, country_code, total_publications,
              total_citations, open_access_percentage, h_index))
        for year_stat in yearly_data:
            cursor.execute("""
                INSERT INTO university_yearly_stats (institution_id, year, papers_count, citations_count)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (institution_id, year) DO UPDATE SET
                    papers_count = EXCLUDED.papers_count,
                    citations_count = EXCLUDED.citations_count;
            """, (inst_id, year_stat["year"],
                  year_stat.get("works_count", 0), year_stat.get("cited_by_count", 0)))
        topics = stats.get("topics", []) or stats.get("topic_share", [])
        for topic in topics:
            field_id = topic.get("id", "").split("/")[-1] if topic.get("id") else None
            if not field_id:
                continue
            cursor.execute("""
                INSERT INTO university_top_fields (institution_id, field_id, display_name, score, count, json_data)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (institution_id, field_id) DO UPDATE SET
                    score = EXCLUDED.score, count = EXCLUDED.count, json_data = EXCLUDED.json_data;
            """, (inst_id, field_id, topic.get("display_name"),
                  topic.get("score", 0), topic.get("count", 0), Json(topic)))
        conn.commit()
        print(f"Successfully processed: {display_name}")
    except Exception as e:
        conn.rollback()
        print(f"Error processing {inst_id} ({display_name}): {e}")
    finally:
        cursor.close()


def main():
    conn = get_db_connection()
    try:
        university_ids = fetch_egyptian_universities()
        for idx, inst_id in enumerate(university_ids):
            print(f"Processing {idx + 1}/{len(university_ids)}...")
            process_university(inst_id, conn)
            time.sleep(0.1)
    finally:
        conn.close()
        print("Database connection closed. Pipeline complete.")


if __name__ == "__main__":
    main()
