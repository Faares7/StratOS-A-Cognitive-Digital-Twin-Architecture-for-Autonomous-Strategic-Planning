# StratOS

**A cognitive digital twin for strategic planning.**

Most digital twins simulate a machine. This one simulates the reasoning of an executive team: it
senses what's happening to the organisation, compares that reality against the standard it's
supposed to meet, and turns the difference into a plan someone can approve and publish.

Built for the Faculty of IT & Computer Science at Nile University, organised end-to-end around the
seven NAQAAE accreditation standards.

---

## The core idea

The whole system is one sentence made operational:

> **Gap = the target state we're accredited against − the current reality we can observe.**

The target state is a Neo4j knowledge graph of the NAQAAE standards. Current reality is assembled
by a dozen agents watching HR data, student sentiment, past execution reports, competitors, tech
threats and social feeds. Everything downstream — gaps, goals, objectives, activities, the final
document — is derived from that subtraction, and every item carries a trace back to the indicator
that justifies it.

## Architecture

Five layers. Agents never call each other; they read and write shared stores, so any agent can run
on its own schedule and the next layer picks up whatever is there.

```
┌─ 1 · CONTEXT ────────────────────────────────────────────────────────────────┐
│  Dashboard & role-based access  ·  OCR of prior plans  ·  Knowledge graph     │
│  Governance, institutional memory, and the target state                      │
└──────────────────────────────────────────────────────────────────────────────┘
        │ policy · context · triggers
┌─ 2 · SIGNAL ─────────────────────────────────────────────────────────────────┐
│  Internal → S/W    workforce · sentiment · operational audit → categorizer    │
│  External → O/T    tech intelligence · benchmarking                          │
│  Both              social media                                              │
│  Support           meetings · surveys                                        │
│                         ↓ SWOT consolidation                                 │
└──────────────────────────────────────────────────────────────────────────────┘
┌─ 3 · DATA ───────────────────────────────────────────────────────────────────┐
│  SWOT signal store   ·   Strategy store            (Supabase / Postgres)      │
└──────────────────────────────────────────────────────────────────────────────┘
┌─ 4 · REASONING ──────────────────────────────────────────────────────────────┐
│  Gap analysis (graph target state vs. SWOT reality)                          │
│  Goals & objectives planner  (pair TOWS → ground → cluster → draft → validate)│
│  Action plan builder         (initiatives, owners, timeframes, budget)       │
└──────────────────────────────────────────────────────────────────────────────┘
┌─ 5 · SYNTHESIS ──────────────────────────────────────────────────────────────┐
│  Chief Editor → strategic roadmap PDF → human review & ratification           │
└──────────────────────────────────────────────────────────────────────────────┘

   Layer 2's operational audit reads last cycle's results back in as new signals —
   that feedback edge is what makes this a twin rather than a one-shot generator.
```

### 1 · Context — governance and memory

The institution's own documents become machine-readable here. **OCR** extracts structure from prior
Arabic strategic plans and evaluation reports. The **knowledge graph** ingests the NAQAAE standards
as `Standard → Criterion → Indicator`, with every chunk embedded, giving the system a queryable
definition of what "good" means. The **dashboard** handles onboarding, role-based access and run
triggers — approvals gate everything downstream.

### 2 · Signal — perception

Each agent watches one slice of reality and emits SWOT items in a shared envelope. Internal signals
(workforce metrics, student sentiment, multi-year execution audits) become strengths and weaknesses;
a **categorizer** tags each one to a strategic pillar. External signals (tech and security
intelligence, competitor benchmarking) become opportunities and threats. Social listening produces
both. **Consolidation** then dedupes across every source, tracks each item's lifecycle against the
previous plan, scores it, and puts the survivors in front of a human for approval.

Two support agents feed the loop sideways: **meetings** turns Google Meet + Fathom transcripts into
decisions and action items, and **surveys** turns open SWOT items into targeted questions published
as live forms.

### 3 · Data — persistence

Two stores, one contract. The **SWOT signal store** holds categorised signals with provenance; the
**strategy store** holds goals, objectives and action plans. Agents are decoupled through these
tables rather than through calls, which is what lets the pipeline run in pieces.

### 4 · Reasoning — the brain

**Gap analysis** pulls each pillar's target state from the graph, sets it against the approved SWOT,
and names the gaps. The **goals planner** pairs internal against external items as TOWS
combinations, grounds each pair in a specific accreditation indicator, clusters them into themes,
drafts SMART objectives, and validates them — looping back on failure. The **action plan builder**
turns objectives into scheduled activities with owners and costs.

Two rules keep this honest. Every objective carries the indicator it traces to, so nothing is
invented. And the model never emits a monetary value: it assigns a relative weight, then Python
distributes each pillar's budget proportionally and stores a receipt for every number.

### 5 · Synthesis — the document

The **Chief Editor** assembles goals, objectives and activities into a formatted strategic roadmap,
section by section, with a deterministic fallback for every block so a run always completes. The
result is editable in a block editor with a provenance panel showing which agent wrote what, then
exported as a paginated PDF in Arabic or English. A human ratifies it. That step is not optional —
AI text stays frozen in `original_*` columns so any edit can be reverted, and the action planner
refuses to run against a strategy nobody has approved.

## Stack

| | |
|---|---|
| Frontend | Next.js 14, TypeScript, Tailwind, Radix, TipTap, Recharts |
| Backend | FastAPI, LangGraph, Pydantic v2 |
| Data | Supabase (Postgres) · Neo4j AuraDB |
| Models | `llama3.1:8b` via Ollama for most agents · Gemini on Vertex AI for planning and synthesis · Groq for NLP and fallbacks |
| Also | Playwright (PDF), Selenium (scraping), Google Calendar / Forms / Document AI |

Model placement is deliberate: most of the pipeline runs locally, and only planning and document
synthesis reach for frontier models.

## Layout

```
api/            FastAPI backend — endpoints + background job registry
Agents/         One directory per agent, grouped by the layers above
chief_editor/   Layer 5 — plan synthesis
core/           Shared LLM config + the persistence envelope every agent writes through
RAG/            Layer 1 — NAQAAE standards → Neo4j graph + vector index
migrations/     Layer 3 — Postgres schema (idempotent, run in order)
Frontend/       Next.js app — dashboard, plan editor, PDF export
Data/           Reference data: financials, prior plans, survey templates
docs/           Design specs for the trickier pipelines
```

## Running it

You'll need Python 3.11+, Node 18+, Ollama, a Supabase project, a Neo4j AuraDB instance, and a GCP
project with Vertex AI enabled.

```bash
# Backend
python -m venv .venv && source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r Requirements.txt
ollama pull llama3.1:8b && ollama pull bge-m3

# Layer 3 — run each migration in order against Supabase
psql "$DB_CONNECTION_STRING" -f migrations/001_unified_agent_outputs.sql   # ...through 005

# Layer 1 — build the target state
python RAG/ingest_graph.py --clean

# Frontend
cd Frontend && npm install && npx playwright install chromium
```

Then, in two terminals:

```bash
uvicorn api.main:app --reload --port 8000     # from the repo root
cd Frontend && npm run dev                    # http://localhost:3000
```

Long runs are queued rather than blocking: `POST /api/agents/{agent}/run` returns a `job_id` and the
UI polls `GET /api/jobs/{job_id}`. Agents also run standalone —
`python -m Agents.swot_consolidation.pipeline`, `python -m Agents.action_planner.action_planner`.

## Configuration

Two env files, neither committed. The backend degrades quietly when credentials are missing rather
than crashing, so check the logs on first run.

**`.env`** (repo root) — `DB_CONNECTION_STRING`, `NEO4J_URI` / `NEO4J_USERNAME` / `NEO4J_PASSWORD`,
`GEMINI_API_KEY`, `GROQ_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_PROJECT`, and
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI`. Optional per integration:
`SERPAPI_KEY`, `GITHUB_TOKEN`, `FATHOM_API_KEY`, `FATHOM_WEBHOOK_SECRET`, `NGROK_URL`,
`FB_EMAIL` / `FB_PASSWORD`.

**`Frontend/.env.local`** — `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `FASTAPI_URL`, `NEXT_PUBLIC_API_URL`.

## Using it

Sign in with Google — new accounts start `pending` until an admin activates them — then work down
the layers: ingest prior plans, run the signal agents, consolidate and approve the SWOT, review the
gaps, generate goals, ratify the strategy, build the action plan, and let the Chief Editor assemble
the document.

## Rough edges

Honest list, so nobody is surprised:

- The Knowledge Base screens proxy to `/ingest/*` endpoints not yet implemented in
  [api/main.py](api/main.py) — the OCR endpoints are the working equivalent.
- [action_planner.py](Agents/action_planner/action_planner.py) expects a `006_strategic_budget.sql`
  migration that isn't in [migrations/](migrations/). Without it, budgets fall back to an equal split.
- If Neo4j is unreachable, grounding degrades to pillar level and gap analysis loses its target
  state — runs continue rather than failing, so watch the logs.
- Job state and OAuth tokens live in process memory: single instance, cleared on restart.
- [stratos_final_architecture_context.md](stratos_final_architecture_context.md) still describes an
  older inflation-based costing model; the code has moved to top-down pillar budgets.

