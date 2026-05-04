"""
StratOS Cognitive Digital Twin — Backend API
============================================================
FastAPI bridge between the Next.js frontend and the LangGraph multi-agent workflows.

Run from the project root:
    uvicorn api.main:app --reload --port 8000

Architecture
------------
  POST /api/agents/{agent}/run  → queues a background job, returns {job_id}
  GET  /api/jobs/{job_id}       → polls job status + result
  GET  /api/health              → liveness probe
"""

from __future__ import annotations

import asyncio
import importlib.util
import os
import sys
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# ── Resolve project root and load the unified .env ───────────────────────────
ROOT_DIR: Path = Path(__file__).parent.parent.resolve()
load_dotenv(ROOT_DIR / ".env")

AGENTS_DIR: Path = ROOT_DIR / "Agents"
DATA_DIR: Path = ROOT_DIR / "Data"
SOCIAL_AGENT_DIR: Path = ROOT_DIR / "Social Media Scraping Agent"

# ── Wire Workforce Agent's relative-import package onto sys.path ─────────────
_MONITORING_DIR = str(AGENTS_DIR / "monitoring")
if _MONITORING_DIR not in sys.path:
    sys.path.insert(0, _MONITORING_DIR)

# ── In-memory job store ───────────────────────────────────────────────────────
_jobs: dict[str, dict[str, Any]] = {}

_PRIORITY_MAP = {"CRITICAL": "critical", "HIGH": "high", "MEDIUM": "medium", "LOW": "low"}
_NOW = lambda: datetime.now(timezone.utc).isoformat()

NAQAAE_TECH_OPP   = "Pillar 12: Digital Transformation"
NAQAAE_TECH_THR   = "Pillar 3: Quality Assurance Systems"
NAQAAE_WORKFORCE  = "Pillar 4: Faculty Development"
NAQAAE_SENTIMENT  = "Pillar 5: Student Learning Outcomes"
NAQAAE_SOCIAL_OPP = "Pillar 8: Community Engagement"
NAQAAE_SOCIAL_THR = "Pillar 2: Strategic Planning"


# ── Module loader (cached) ────────────────────────────────────────────────────

def _load_module(name: str, path: Path) -> Any:
    """Load a Python file as a module by absolute path, caching after first load."""
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot locate module at {path}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


# ── Job helpers ───────────────────────────────────────────────────────────────

def _new_job() -> str:
    job_id = str(uuid.uuid4())
    _jobs[job_id] = {
        "status": "running",
        "result": None,
        "error": None,
        "started_at": _NOW(),
        "finished_at": None,
    }
    return job_id


def _finish(job_id: str, result: Any) -> None:
    _jobs[job_id].update(status="complete", result=result, finished_at=_NOW())


def _fail(job_id: str, error: str) -> None:
    _jobs[job_id].update(status="failed", error=error, finished_at=_NOW())


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(title="StratOS CDT API", version="1.0.0", docs_url="/api/docs")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {"status": "ok", "timestamp": _NOW()}


# ── Job polling ───────────────────────────────────────────────────────────────

@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return _jobs[job_id]


# ══════════════════════════════════════════════════════════════════════════════
#  TECH AGENT
# ══════════════════════════════════════════════════════════════════════════════

def _task_tech(job_id: str) -> None:
    try:
        mod = _load_module(
            "Tech_Agent",
            AGENTS_DIR / "Tech Agent" / "Tech_Agent.py",
        )
        state: dict = mod.compile_and_run()
        result = state.get("final_strategic_output") or {}
        confidence = int((result.get("confidence_score") or 0.8) * 100)
        now = _NOW()

        insights = []
        for opp in result.get("opportunities", []):
            insights.append({
                "id": opp["id"],
                "category": "opportunity",
                "title": opp["title"],
                "description": opp["description"],
                "pillar_tag": NAQAAE_TECH_OPP,
                "impact_level": _PRIORITY_MAP.get(opp.get("priority", "MEDIUM"), "medium"),
                "confidence_score": confidence,
                "reference_count": len(opp.get("signal_sources", [])),
                "created_at": now,
                "data_source": "live",
                "is_validated": False,
                "ai_suggestion": True,
                "evidence": {
                    "type": "statistical",
                    "explanation": opp.get("recommended_action", opp["description"]),
                    "data_points": {
                        "signal_sources": ", ".join(opp.get("signal_sources", [])),
                        "time_horizon": opp.get("time_horizon", ""),
                    },
                },
            })
        for thr in result.get("threats", []):
            insights.append({
                "id": thr["id"],
                "category": "threat",
                "title": thr["title"],
                "description": thr["description"],
                "pillar_tag": NAQAAE_TECH_THR,
                "impact_level": _PRIORITY_MAP.get(thr.get("priority", "HIGH"), "high"),
                "confidence_score": confidence,
                "reference_count": len(thr.get("signal_sources", [])),
                "created_at": now,
                "data_source": "live",
                "is_validated": False,
                "ai_suggestion": True,
                "evidence": {
                    "type": "statistical",
                    "explanation": thr.get("recommended_action", thr["description"]),
                    "data_points": {
                        "signal_sources": ", ".join(thr.get("signal_sources", [])),
                        "time_horizon": thr.get("time_horizon", ""),
                    },
                },
            })

        _finish(job_id, {
            "insights": insights,
            "executive_summary": result.get("executive_summary"),
            "key_deltas": result.get("key_deltas", []),
            "confidence_score": result.get("confidence_score"),
            "analysis_date": result.get("analysis_date"),
            "agent_errors": state.get("errors", []),
        })
    except Exception as exc:
        _fail(job_id, str(exc))


@app.post("/api/agents/tech/run", status_code=202)
def run_tech(background_tasks: BackgroundTasks):
    """Trigger the Tech Intelligence Cluster (GitHub + CISA + SerpApi → Gemini)."""
    job_id = _new_job()
    background_tasks.add_task(_task_tech, job_id)
    return {"job_id": job_id}


# ══════════════════════════════════════════════════════════════════════════════
#  BENCHMARK AGENT
#  Fast path: bulk OpenAlex fetch → frontend result immediately.
#  DB save runs in a daemon thread after the job is marked complete.
# ══════════════════════════════════════════════════════════════════════════════

def _task_benchmark(job_id: str) -> None:
    try:
        mod = _load_module(
            "benchmark_agent",
            AGENTS_DIR / "benchmark_agent.py",
        )
        # Step 1: fetch + parse (fast — 1-2 HTTP calls)
        all_data: list = mod._fetch_all_parsed()
        # Step 2: format for frontend and finish job immediately
        result: dict = mod._format_result(all_data)
        _finish(job_id, result)
        # Step 3: write to Supabase in a daemon thread — does not block the response
        threading.Thread(
            target=mod.write_all_to_db,
            args=(all_data,),
            daemon=True,
            name="benchmark-db-save",
        ).start()
    except Exception as exc:
        _fail(job_id, str(exc))


@app.post("/api/agents/benchmark/run", status_code=202)
def run_benchmark(background_tasks: BackgroundTasks):
    """Trigger the Benchmark Agent (OpenAlex bulk fetch + background Supabase save)."""
    job_id = _new_job()
    background_tasks.add_task(_task_benchmark, job_id)
    return {"job_id": job_id}


# ══════════════════════════════════════════════════════════════════════════════
#  WORKFORCE AGENT
# ══════════════════════════════════════════════════════════════════════════════

def _task_workforce(job_id: str) -> None:
    try:
        from Workforce_agent.agent import compile_and_run as workforce_run  # noqa: PLC0415

        data_path = os.getenv("WORKFORCE_DATA_PATH") or str(DATA_DIR / "mock_workforce_data.json")
        result: dict = workforce_run(data_path=data_path)

        impact_map = {"High": "high", "Medium": "medium", "Low": "low"}
        now = _NOW()
        insights = []
        for i, item in enumerate(result.get("insights", []), start=1):
            category = "strength" if item.get("insight_type") == "Strength" else "weakness"
            insights.append({
                "id": f"wf-{i:02d}",
                "category": category,
                "title": item.get("metric_category", "HR Metric"),
                "description": item.get("finding", ""),
                "pillar_tag": NAQAAE_WORKFORCE,
                "impact_level": impact_map.get(item.get("impact_level", "Medium"), "medium"),
                "confidence_score": 85,
                "reference_count": 1,
                "created_at": now,
                "data_source": "live",
                "is_validated": False,
                "ai_suggestion": True,
                "evidence": {
                    "type": "calculation",
                    "explanation": item.get("finding", ""),
                    "data_points": {},
                },
            })

        _finish(job_id, {
            "insights": insights,
            "calculated_metrics": result.get("calculated_metrics", {}),
        })
    except Exception as exc:
        _fail(job_id, str(exc))


@app.post("/api/agents/workforce/run", status_code=202)
def run_workforce(background_tasks: BackgroundTasks):
    """Trigger the Workforce Agent (HR JSON → metric calc → Gemini insights)."""
    job_id = _new_job()
    background_tasks.add_task(_task_workforce, job_id)
    return {"job_id": job_id}


# ══════════════════════════════════════════════════════════════════════════════
#  SENTIMENT AGENT
# ══════════════════════════════════════════════════════════════════════════════

async def _task_sentiment_async(job_id: str, csv_path: str) -> None:
    try:
        mod = _load_module(
            "sentiment_engine",
            AGENTS_DIR / "Sentiment analysis" / "engine_local.py",
        )
        result: dict = await mod.compile_and_run(csv_path)

        if result.get("error"):
            _fail(job_id, result["error"])
            return

        report = result.get("aggregated_report") or {}
        now = _NOW()
        insights = []

        for item in report.get("top_strengths", []):
            label = str(item.get("label", ""))
            insights.append({
                "id": f"sa-s-{label[:16].replace(' ', '-').lower()}",
                "category": "strength",
                "title": label,
                "description": (
                    f"Mentioned by {item['value']} students "
                    f"({item.get('percentage', '0')}% of responses)"
                ),
                "pillar_tag": NAQAAE_SENTIMENT,
                "impact_level": "high" if int(item.get("value", 0)) > 5 else "medium",
                "confidence_score": 78,
                "reference_count": int(item.get("value", 0)),
                "created_at": now,
                "data_source": "live",
                "is_validated": False,
                "ai_suggestion": True,
                "evidence": {
                    "type": "raw_text",
                    "explanation": "; ".join((item.get("quotes") or [])[:3]),
                    "data_points": {
                        "mention_count": item.get("value", 0),
                        "share_pct": item.get("percentage", "0"),
                    },
                },
            })
        for item in report.get("top_weaknesses", []):
            label = str(item.get("label", ""))
            insights.append({
                "id": f"sa-w-{label[:16].replace(' ', '-').lower()}",
                "category": "weakness",
                "title": label,
                "description": (
                    f"Mentioned by {item['value']} students "
                    f"({item.get('percentage', '0')}% of responses)"
                ),
                "pillar_tag": NAQAAE_SENTIMENT,
                "impact_level": "high" if int(item.get("value", 0)) > 5 else "medium",
                "confidence_score": 78,
                "reference_count": int(item.get("value", 0)),
                "created_at": now,
                "data_source": "live",
                "is_validated": False,
                "ai_suggestion": True,
                "evidence": {
                    "type": "raw_text",
                    "explanation": "; ".join((item.get("quotes") or [])[:3]),
                    "data_points": {
                        "mention_count": item.get("value", 0),
                        "share_pct": item.get("percentage", "0"),
                    },
                },
            })

        _finish(job_id, {
            "insights": insights,
            "summary": report.get("summary", {}),
            "total_students": result.get("total_students", 0),
        })
    except Exception as exc:
        _fail(job_id, str(exc))


@app.post("/api/agents/sentiment/run", status_code=202)
async def run_sentiment(background_tasks: BackgroundTasks):
    """Trigger the Sentiment Agent (CSV → Ollama llama3.1 → semantic clustering)."""
    csv_path = os.getenv("SENTIMENT_CSV_PATH") or str(DATA_DIR / "cleaned_students.csv")
    job_id = _new_job()
    background_tasks.add_task(_task_sentiment_async, job_id, csv_path)
    return {"job_id": job_id}


# ══════════════════════════════════════════════════════════════════════════════
#  SOCIAL MEDIA AGENT
#  Reads cached ot_signals.json (instant) or re-runs Groq NLP pipeline.
#  Returns opportunity + threat InsightCards grouped by theme.
# ══════════════════════════════════════════════════════════════════════════════

def _task_social_media(job_id: str) -> None:
    try:
        mod = _load_module(
            "nlp_pipeline",
            SOCIAL_AGENT_DIR / "nlp_pipeline.py",
        )
        result: dict = mod.compile_and_run()

        if result.get("error"):
            _fail(job_id, result["error"])
            return

        _finish(job_id, {
            "insights": result.get("insights", []),
            "opportunities": result.get("opportunities", 0),
            "threats": result.get("threats", 0),
            "total_posts_analyzed": result.get("total_posts_analyzed", 0),
        })
    except Exception as exc:
        _fail(job_id, str(exc))


@app.post("/api/agents/social/run", status_code=202)
def run_social(background_tasks: BackgroundTasks):
    """Trigger the Social Media Agent (Facebook groups → Groq NLP → SWOT signals)."""
    job_id = _new_job()
    background_tasks.add_task(_task_social_media, job_id)
    return {"job_id": job_id}
