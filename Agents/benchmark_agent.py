import os
import requests
import psycopg2
from psycopg2.extras import Json
import time
from datetime import date
from dotenv import load_dotenv

from core.persistence import build_envelope, save_envelope

load_dotenv()

DB_CONNECTION_STRING = os.getenv("DB_CONNECTION_STRING", "")
_OPENALEX_HEADERS = {"User-Agent": "StratOS/1.0 (mailto:admin@nileuniversity.edu.eg)"}

# ── The 11 benchmarked universities ───────────────────────────────────────────
# Only these are fetched from OpenAlex. `enrollment_key` is the exact value in the
# `universities_enrollment` table's "University" column (names differ from OpenAlex).
NILE_ID = "I57629906"
BENCHMARK_UNIVERSITIES = [
    {"display_name": "Nile University",        "openalex_id": "I57629906",   "enrollment_key": "Nile (NU)"},
    {"display_name": "Cairo University",       "openalex_id": "I145487455",  "enrollment_key": "Cairo"},
    {"display_name": "October 6 University",   "openalex_id": "I4210165376", "enrollment_key": "October 6 (O6U)"},
    {"display_name": "Alexandria University",  "openalex_id": "I84524832",   "enrollment_key": "Alexandria"},
    {"display_name": "Ain Shams University",   "openalex_id": "I107720978",  "enrollment_key": "Ain Shams"},
    {"display_name": "Mansoura University",    "openalex_id": "I159247623",  "enrollment_key": "Mansoura"},
    {"display_name": "Zagazig University",     "openalex_id": "I192398990",  "enrollment_key": "Zagazig"},
    {"display_name": "Tanta University",       "openalex_id": "I21376657",   "enrollment_key": "Tanta"},
    {"display_name": "Assiut University",      "openalex_id": "I91041137",   "enrollment_key": "Assiut"},
    {"display_name": "Al-Azhar University",    "openalex_id": "I184834183",  "enrollment_key": "Al-Azhar"},
    {"display_name": "Suez Canal University",  "openalex_id": "I114794399",  "enrollment_key": "Suez Canal"},
]
_ENROLLMENT_BY_ID = {u["openalex_id"]: u["enrollment_key"] for u in BENCHMARK_UNIVERSITIES}

# Enrollment-adjustment equation tunables.
RII_SCALE = 1000.0      # readability multiplier for the Research Intensity Index
LAST_N_YEARS = 5        # publication history window shown on the chart


def recent_years() -> list[int]:
    """The last N complete calendar years (most recent first → oldest), e.g. 2021..2025."""
    cur = date.today().year
    return list(range(cur - LAST_N_YEARS, cur))


def _norm(name: str) -> str:
    return (name or "").strip().lower()


def research_intensity(publications: float, students: int | None, faculties: int | None) -> float:
    """
    Enrollment-adjusted research output ("Research Intensity Index").

    Raw publication counts favour large universities. This normalises output by
    *both* the student body and the number of faculties so a small, focused
    university is judged on productivity, not size:

        RII = publications / total_students / faculty_count * RII_SCALE

    Example: 300 papers / 600 students / 3 faculties  →  higher than
             400 papers / 1000 students / 5 faculties.

    Returns 0.0 when enrollment data is missing so such universities sort last.
    """
    if not students or not faculties:
        return 0.0
    return round(publications * RII_SCALE / (students * faculties), 2)


def get_db_connection():
    if not DB_CONNECTION_STRING:
        raise RuntimeError("DB_CONNECTION_STRING is not set in environment.")
    return psycopg2.connect(DB_CONNECTION_STRING)


# ── Selective fetch (only the 11 benchmarked universities) ─────────────────────

def fetch_benchmark_universities() -> list[dict]:
    """
    Fetch only the 11 benchmarked universities in a single OpenAlex call using an
    OR filter on their institution IDs. Includes works_count, cited_by_count,
    summary_stats and counts_by_year so no per-university detail call is needed.
    """
    ids = "|".join(u["openalex_id"] for u in BENCHMARK_UNIVERSITIES)
    select = "id,display_name,works_count,cited_by_count,summary_stats,counts_by_year"
    url = (
        "https://api.openalex.org/institutions"
        f"?filter=openalex:{ids}&per_page=50&select={select}"
    )
    try:
        resp = requests.get(url, timeout=30, headers=_OPENALEX_HEADERS)
        resp.raise_for_status()
        results = resp.json().get("results", [])
        print(f"[benchmark] Fetched {len(results)}/{len(BENCHMARK_UNIVERSITIES)} benchmarked universities")
        return results
    except Exception as e:
        print(f"[benchmark] OpenAlex selective fetch error: {e}")
        return []


def load_enrollment() -> dict[str, dict]:
    """
    Load student counts + faculty counts from the `universities_enrollment` table,
    keyed by the normalised "University" value. Returns {} if the DB is unavailable.
    """
    try:
        conn = get_db_connection()
    except Exception as e:
        print(f"[benchmark] enrollment DB unavailable: {e}")
        return {}
    out: dict[str, dict] = {}
    try:
        cur = conn.cursor()
        cur.execute(
            'SELECT "University", "Total Students", "Faculty Count" FROM universities_enrollment;'
        )
        for name, students, faculties in cur.fetchall():
            out[_norm(name)] = {
                "students": int(students) if students is not None else None,
                "faculties": int(faculties) if faculties is not None else None,
            }
        cur.close()
        print(f"[benchmark] Loaded enrollment for {len(out)} universities")
    except Exception as e:
        print(f"[benchmark] enrollment query failed: {e}")
    finally:
        conn.close()
    return out


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


def _parse_university(inst: dict, enrollment: dict[str, dict] | None = None) -> dict:
    inst_id = inst["id"].replace("https://openalex.org/", "")
    yearly_data = inst.get("counts_by_year", [])
    total_publications = inst.get("works_count", 0)
    total_oa = sum(y.get("oa_works_count", 0) for y in yearly_data)

    # Raw publications per year, restricted to the last N complete years.
    years = recent_years()
    works_by_year = {y.get("year"): y.get("works_count", 0) for y in yearly_data}
    publications_history = [{"year": yr, "value": works_by_year.get(yr, 0)} for yr in years]

    # Enrollment lookup (students + faculties) for this university.
    enrollment = enrollment or {}
    enr_key = _ENROLLMENT_BY_ID.get(inst_id)
    enr = enrollment.get(_norm(enr_key), {}) if enr_key else {}
    students = enr.get("students")
    faculties = enr.get("faculties")

    # Enrollment-adjusted research output (chart series + headline score).
    intensity_history = [
        {"year": p["year"], "value": research_intensity(p["value"], students, faculties)}
        for p in publications_history
    ]
    rii_total = research_intensity(total_publications, students, faculties)

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
        "total_students": students,
        "faculty_count": faculties,
        "research_intensity": rii_total,
        # h_index_history retained (raw per-year publications) for back-compat + DB save.
        "h_index_history": list(publications_history),
        "publications_history": publications_history,
        "intensity_history": intensity_history,
    }


# ── Internal helpers shared by API and DB pipeline ────────────────────────────

def _fetch_all_parsed() -> list[dict]:
    """
    Fetch and parse the 11 benchmarked universities, attach enrollment data and
    compute the enrollment-adjusted Research Intensity Index, then sort by it
    (descending) so the fair, size-normalised ranking drives the result.
    """
    print("[benchmark] Fetching the 11 benchmarked universities from OpenAlex...")
    raw = fetch_benchmark_universities()
    enrollment = load_enrollment()
    print(f"[benchmark] Parsing {len(raw)} universities...")
    all_data = []
    for inst in raw:
        try:
            all_data.append(_parse_university(inst, enrollment))
        except Exception as e:
            print(f"[benchmark] Parse error for {inst.get('id', '?')}: {e}")
    # Fair ranking: by enrollment-adjusted intensity, then raw publications as tie-break.
    all_data.sort(
        key=lambda u: (u.get("research_intensity", 0), u.get("total_publications", 0)),
        reverse=True,
    )
    return all_data


def _format_result(all_data: list[dict], errors: list[str] | None = None) -> dict:
    """Format parsed list into ResearchIntelligence-compatible dict for the frontend.

    `all_data` is already sorted by Research Intensity Index (desc), so list position
    is the global, enrollment-adjusted rank shared by Nile and every competitor.
    """
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

    def to_metrics(u: dict, rank: int | None = None) -> dict:
        return {
            "university_name": u.get("display_name", "Unknown"),
            "publications": u.get("total_publications", 0),
            "h_index": u.get("h_index", 0),
            "total_citations": u.get("total_citations", 0),
            "total_students": u.get("total_students"),
            "faculty_count": u.get("faculty_count"),
            "research_intensity": u.get("research_intensity", 0),
            "h_index_history": u.get("h_index_history", []),
            "publications_history": u.get("publications_history", []),
            "intensity_history": u.get("intensity_history", []),
            "rank": rank,
        }

    # Global ranks (1..N) preserved for every university, Nile included.
    competitors = [
        to_metrics(u, i + 1) for i, u in enumerate(all_data) if u is not nile_u
    ]

    print(f"[benchmark] Done. Nile found: {nile_u is not None} (rank {nile_rank}). Competitors: {len(competitors)}")
    return {
        "nile_university": to_metrics(nile_u, nile_rank) if nile_u else {
            "university_name": "Nile University",
            "publications": 0, "h_index": 0, "total_citations": 0,
            "total_students": None, "faculty_count": None, "research_intensity": 0,
            "h_index_history": [], "publications_history": [], "intensity_history": [],
            "rank": None,
        },
        "competitors": competitors,
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
    Fast entry point for the FastAPI bridge (no DB writes to the per-university tables).
    The API task calls _fetch_all_parsed() + _format_result() directly so it can
    hand off all_data to write_all_to_db() in a daemon thread after finishing the job.

    Also writes a unified-pipeline envelope to agent_runs (no SWOT items).
    """
    all_data = _fetch_all_parsed()
    result = _format_result(all_data)

    # Unified envelope — additive: per-university rows still go to write_all_to_db().
    try:
        envelope = build_envelope(
            agent_id="benchmark",
            swot_items=[],
            structured_data={
                "nile_university": result.get("nile_university"),
                "competitors":     result.get("competitors", []),
                "data_source":     result.get("data_source", "live"),
            },
            errors=result.get("errors", []),
            status="error" if result.get("errors") else "success",
        )
        save_envelope(envelope)
    except Exception as e:
        print(f"[benchmark] unified envelope save failed: {e}")

    return result


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
