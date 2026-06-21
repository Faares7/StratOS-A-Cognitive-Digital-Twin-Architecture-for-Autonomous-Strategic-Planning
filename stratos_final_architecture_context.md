# StratOS — Final Architecture Context

> **Purpose.** This document is the authoritative, code-grounded description of the
> StratOS platform's current deployed state, written to be injected as context into
> a thesis-writing assistant. Every claim below is traceable to a specific file in
> this repository. Where a figure is an assumption or a single-run observation rather
> than a formally measured result, it is labelled as such — so the thesis built on
> top of it survives cross-examination.
>
> **Scope note.** A separate *Operational Audit* agent exists in this project. Its
> **internal implementation is not in this codebase** (it lives in `Agents/operational_audit/`,
> documented separately), so this document does not describe its internals. It **does**,
> however, integrate with the pipeline below through a **decoupled database contract**:
> the audit agent writes `strengths`/`weaknesses` into the `swot_items` table under
> `agent_id = "operational_audit"`, and the strategy pipeline consumes them via the
> "latest run per agent" query (`DISTINCT ON (agent_id)`). This closed loop — execution
> history feeding the next strategy cycle — is verifiable from the **consumption side**
> in this codebase (`api/main.py: _fetch_swot_by_pillar`) and is described in §2.4.

---

## 1. High-Level Architecture

StratOS is a **cognitive digital-twin decision-support platform** for the faculty of
Information Technology & Computer Science (ITCS), built around the seven **NAQAAE**
programmatic accreditation standards. The topology has four tiers:

| Tier | Technology | Role |
|------|-----------|------|
| **Frontend** | Next.js 14 (App Router), NextAuth, Radix UI, Tailwind | Authenticated dashboard; route group `Frontend/src/app/(dashboard)/`. One page per agent (SWOT, Gap Analysis, Strategic Goals, KPI Generation, Action Plan, …). |
| **Backend** | FastAPI (`api/main.py`), Uvicorn | REST API + long-running job orchestration via `BackgroundTasks` and an in-process job registry (`_new_job` / `_set_progress` / `_finish` / `_fail`), polled by the frontend through `GET /api/jobs/{job_id}`. |
| **Relational store** | Supabase (PostgreSQL) | System of record for all agent output. Schema in `migrations/` (`001`–`005`). |
| **Knowledge graph** | Neo4j AuraDB (GraphRAG) | Immutable hierarchical knowledge graph of the NAQAAE standards, used for *soft grounding* of strategy objectives. Ingested by `RAG/ingest_graph.py`. |

**Agent execution model.** Every agent is a **LangGraph** `StateGraph` compiled once
and reused. Agents are loaded dynamically by the API (`importlib`-based module
loading) so the backend stays decoupled from each agent's internals.

**Model placement (important — not uniform across the system):**

- `gap_analysis` → **local `llama3.1:8b`** via Ollama (`core/llm.py: local_brain`).
- `goals_planner` drafting node → **local `llama3.1:8b`** via Ollama.
- `goals_planner` grounding / clustering embeddings → **local Ollama embeddings**.
- `action_planner` → **`gemini-3.1-pro-preview`** on **Google Vertex AI**
  (`ChatVertexAI`, `location="global"`, `temperature=0.2`).

Only the Action Planner uses a frontier cloud reasoning model; the rest of the
pipeline runs locally. Any statement that "the system upgraded to Gemini 3.1 Pro"
must be scoped to the Action Planner specifically (see §4).

---

## 2. The Multi-Agent Pipeline

The strategic-planning data flow is **SWOT → Goals → Actions**. Gap Analysis is a
**parallel** analytical branch over the same SWOT/pillar inputs; it is not an
upstream feeder of the goals pipeline in the current code.

```
                ┌─────────────────────────┐
  SWOT items ──▶│  gap_analysis (parallel) │──▶ improvement suggestions per pillar
                └─────────────────────────┘

                ┌──────────────────────────────────────────────────────────────┐
  SWOT items ──▶│ goals_planner: pair → ground → cluster → draft → validate→save│──▶ strategic_goals + strategic_objectives
                └──────────────────────────────────────────────────────────────┘
                                                                                       │
                ┌──────────────────────────────────────────────────────────────┐      │
   objectives ─▶│ action_planner: draft → schedule-repair → (critique) → price  │◀─────┘
                └──────────────────────────────────────────────────────────────┘──▶ strategic_actions + budget reconciliation
```

### 2.1 Gap Analysis Agent  (`Agents/Gap analysis/gap_analysis_agent.py`)
- **Graph:** single node — `START → generate_suggestions → END`.
- **Model:** `llama3.1:8b` (local), acting as a NAQAAE QA expert.
- **Behaviour:** for each of the 7 strategic pillars it emits **4–6** improvement
  suggestions. Output is a Pydantic `Suggestion` with three fields:
  `suggestion`, `reasoning` (must cite specific S/W/O/T evidence), `gap_identified`.
- **Ordering rule:** *weakness-first* — every listed weakness must be addressed by at
  least one suggestion that paraphrases the weakness in `gap_identified` for
  traceability.

### 2.2 Goals Planner  (`Agents/goals_planner/`)
A six-stage `StateGraph` (`graph.py`) with a validation retry loop:

```
pair_tows → ground_in_graph → cluster_into_goals → draft_goals → validate
                                                        ↑            │
                                            increment_retries ◀──────┘ (≤ MAX_RETRIES=2)
                                                                     │ (pass / retries exhausted)
                                                                   save → END
```

1. **`pair_tows`** (`pairing.py`) — builds TOWS pairs (SO/WO/ST/WT) from SWOT items;
   keeps a pair only if cosine ≥ `PAIR_THRESHOLD = 0.45`, up to `TOP_K_EXTERNAL = 3`
   external items per internal item.
2. **`ground_in_graph`** (`grounding.py`) — **soft GraphRAG grounding**. For each pair,
   embeds the text, queries the Neo4j `chunk_embedding` vector index, **scopes** the
   search to the pair's NAQAAE Standard via a pillar→keyword map (`PILLAR_TO_KEYWORD`),
   then traverses to the owning `Indicator`. Assigns an **alignment level**:
   - `indicator` — cosine ≥ `GROUND_THRESHOLD = 0.50` *and* an Indicator was found;
   - `pillar_only` — pillar known but score below threshold / no Indicator;
   - `strategic` — no pillar (edge case).
   It **reads Neo4j only, never writes**, and **fast-fails gracefully**: if Neo4j is
   unreachable it degrades every pair to `pillar_only` rather than stalling the run.
3. **`cluster_into_goals`** (`clustering.py`) — **Leiden community detection** on a
   k-NN semantic similarity graph (`CLUSTER_KNN = 10`). The resolution is chosen
   **dynamically per run**: the best-separated (silhouette) stable partition whose goal
   count falls within `[MIN_GOALS = 4, MAX_GOALS = 9]`. The goal-count band is the only
   semantic knob.
4. **`draft_goals`** (`drafting.py`) — `llama3.1:8b` with
   `with_structured_output(_ClusterObjectives)` turns each cluster into a goal title +
   SMART objectives.
5. **`validate`** (`validation.py`) — enforces a SMART minimum (`SMART_MIN_WORDS = 12`)
   and multi-tier semantic de-duplication (verbatim `0.95`; same-pillar action-core
   `0.90`; cross-pillar action-core `0.93`). Failure routes back to `draft_goals` up to
   `MAX_RETRIES = 2`, then accepts best-effort.
6. **`save`** (`persistence.py`) — writes `strategic_goals` + `strategic_objectives`,
   freezing AI text into `original_*` columns on first write and recording provenance
   (`source_swot_ids`, `grounded_indicators`, `tows_types`, `alignment`).

### 2.3 Action Planner  (`Agents/action_planner/action_planner.py`)
For every objective of an **approved** strategy run, drafts **2–4** executive activities
and fills the operational-plan columns: `activity_text`, `kpi_name`, schedule
(`start_quarter`/`end_quarter`), `responsible_exec`, `responsible_monitor`, and a
**computed** budget. Detailed in §3–§5.

---

### 2.4 Closed-Loop Feedback: Operational Audit → `swot_items` → next strategy cycle
The platform closes the strategic loop through a **decoupled, database-mediated**
contract rather than direct agent-to-agent calls:

- **Producer (documented separately).** The Operational Audit agent mines multi-year
  execution trends from the executive plan + annual monitoring reports and writes
  `swot_items` (genuine improvements → *strengths*; stalled/declining/chronic
  indicators → *weaknesses*) under `agent_id = "operational_audit"`, in a **single
  run** via the shared `core.persistence` envelope.
- **Consumer (verifiable here).** `api/main.py: _fetch_swot_by_pillar` gathers SWOT
  using `WITH latest_runs AS (SELECT DISTINCT ON (agent_id) … ORDER BY agent_id,
  run_timestamp DESC)`. Because selection is **per `agent_id`**, the audit agent's
  latest batch is automatically included alongside the other SWOT sources and flows
  into both Gap Analysis and the Goals Planner.

**Why this matters architecturally.** This is what makes StratOS a *cognitive digital
twin* rather than a one-shot planner: **observed execution gaps from past cycles
re-enter as SWOT inputs to the next cycle.** The decoupling (write-to-table, not a
function call) means the audit agent can run on its own cadence and the planner picks
up its findings on the next run with no orchestration coupling. The "single run / no
dedup here" design is deliberate — the planner selects the *latest* run per agent, so
splitting findings across runs would drop all but the last; de-duplication is handled
downstream in the Goals Planner's validation stage (§2.2, step 5).

> **Documentation boundary.** The audit agent's *mechanics* (status model, cross-year
> `rapidfuzz` indicator matching, trend classification, confidence model) are covered
> in its own `operational_audit_agent.md`. This document asserts only the **integration
> contract**, which is verifiable from the consumption side in this repository.

---

## 3. The Tier-3 Financial Engine (Deterministic Provenance)

The Action Planner's defining design principle is **"the LLM classifies, Python
computes."** The language model **never emits a monetary value**. It only:
1. writes the English prose (activity, KPI, rationale),
2. picks responsibilities from a controlled vocabulary,
3. schedules quarters with chain-of-thought reasoning,
4. **classifies** each activity into an OPEX **archetype**, and
5. estimates a `duration_multiplier` ∈ {1,2,3,4}.

Python then does **all** arithmetic, deterministically, from decoupled financial
registries in `Data/financials/`:

- **Revenue baseline** (`tuition_revenue_2026.csv`) — five programs × 300 students,
  blended fee → **210,000,000 EGP** total annual tuition; the strategic envelope is
  **5%** of tuition.
- **OPEX archetype catalog** (`activity_opex_catalog.json`) — **18 archetypes**, each
  with `base_cost_egp`, a `cost_driver` (`local` vs `usd_linked`), and a
  `funding_source` (`faculty_opex` vs `central_capex`).

### 3.1 The costing formula
For a chosen archetype, duration multiplier *m*, and plan-year index *i* (2026 = 0):

```
inflated = base_cost × m × (1 + rate)^i      (rounded to nearest 1,000 EGP)
```

where `rate` is selected by the archetype's cost driver:

- **Local CPI** `LOCAL_CPI_RATE = 0.15` for domestic (`local`) costs;
- **EGP/USD depreciation** `USD_FX_RATE = 0.10` for imported (`usd_linked`) costs.

> **Inflation rates are conservative planning assumptions, not a formal citation.**
> The code comment notes they *approximate* a stabilising post-2024 inflation path
> and flags "CONFIRM against the latest IMF WEO / CBE figures." They are **not** tied
> to a specific published IMF table in the code, and this document deliberately does
> **not** claim an IMF citation. Treat 15% / 10% as **stated, defensible planning
> assumptions** chosen for reproducibility of a governance document — not as measured
> macroeconomic forecasts.

### 3.2 Provenance — two distinct artefacts, deliberately separated
Two fields exist, and conflating them is a category error:

- **`classification_reasoning`** — *LLM-authored.* Explains **why** an activity maps to
  its archetype (the qualitative judgement).
- **`cost_explanation`** — *Python-rendered.* A deterministic "receipt" stating the
  catalog base, the multiplier, the inflation index, and the resulting number. It
  contains **no LLM narration of the figure**.

In addition, every priced row stores a machine-readable `pricing_provenance` JSON
(formula, archetype, base, rate, multipliers, year index) so any number can be
re-derived independently — this is what makes the budget **deterministic and
reproducible given fixed inputs**.

### 3.3 Affordability reconciliation
`reconcile_budget` buckets **faculty-OPEX** spend by plan year and compares each year
against that year's **inflated** 5%-of-tuition ceiling
(`base_ceiling × (1 + LOCAL_CPI_RATE)^i`). `central_capex` activities are **excluded**
from the faculty ceiling (they are funded centrally). Over-ceiling years emit soft
warnings rather than hard failures.

---

## 4. Overcoming LLM Limitations (Action Planner)

> Scope: this section concerns the **Action Planner** only, which is the sole component
> running on Gemini on Vertex AI.

**Observation (illustrative, from representative runs — not a benchmarked metric).**
An early configuration using a *Flash*-class model collapsed a large share of
activities into two catch-all archetypes (`administrative_routine`,
`general_initiative`) — roughly **~59%** fallback on one representative run. This is the
classic "junk-drawer classification" failure: the cheaper model takes the cognitive
path of least resistance instead of discriminating among specific archetypes.

**Two coordinated fixes:**
1. **Model upgrade** to `gemini-3.1-pro-preview` (a reasoning model), and
2. **Catalog expansion** from the original set to **18 archetypes** with **tightened,
   mutually-exclusive descriptions** (e.g. explicit exclusions on the catch-all
   archetypes).

After both changes, fallback classification dropped to roughly **~3%** (≈1 row out of
~38) on a comparable run.

> **Methodological caveat for the thesis.** These percentages are **single-run
> observations**, not a statistically controlled benchmark, and the model runs at
> `temperature = 0.2` (non-deterministic) — so the exact figure varies between runs.
> They should be presented as an **illustrative before/after** demonstrating that
> upgrading the reasoning model and sharpening the archetype taxonomy resolved the
> fallback problem, **not** as a precise measured error rate. If a hard metric is
> required, run *N* trials per configuration and report a mean ± variance.

---

## 5. HITL & Governance Lifecycles

### 5.1 Draft → Final approval gate
A strategy run carries a lifecycle status in `agent_runs.structured_data.plan_status`.
The Action Planner **refuses to run** unless `plan_status == 'final'`
(`require_final=True`). This enforces governance: an operational plan can only be built
on an **approved** strategy, not on an arbitrary draft. (A developer override exists for
testing — surfaced in the UI behind an *Advanced* toggle, off by default.)

### 5.2 Idempotent, transactional writes
Generating actions for a run first **deletes prior actions for that `run_id`**, then
inserts the new set inside a single transaction — re-running is safe and never leaves a
half-written plan.

### 5.3 `original_*` snapshots → one-click "Reset to AI"
Across all three persisted entities (`strategic_goals`, `strategic_objectives`,
`strategic_actions`), AI-authored text is frozen into `original_*` columns on first
write and never overwritten by edits. The UI offers **"Reset to AI"**, which restores
the original snapshot and clears `edited_by_user`. For the Action Planner this snapshot
set deliberately includes the **cost-driving** fields
(`original_assigned_archetype`, `original_duration_multiplier`) — not just prose — so a
reset also restores the original price.

### 5.4 Dynamic PATCH re-pricing
Editing an action via `PATCH /api/action-plan/action/{action_id}` re-runs the
**Python** pricing engine whenever a cost-driving field changes (archetype, duration,
or start quarter → year index). The human edits the *classification*; the *number* is
always recomputed deterministically by Python, never typed in by hand. The budget
header re-reconciles on every edit.

---

## 6. Strict Constraints & Vocabularies

Schema adherence is enforced structurally, not by prompt-politeness:

- **Pydantic structured outputs** — every agent returns a validated Pydantic model
  (`Suggestion`/`PillarSuggestions`, `_ClusterObjectives`, `ActionItemDraft` /
  `ObjectiveActions`), so malformed output fails fast.
- **`Literal` enums** — the Action Planner's draft schema constrains
  `responsible_exec` / `responsible_monitor` to a **fixed role vocabulary** and
  `assigned_archetype` to the **18 catalog keys** via `Literal` types. Any value
  outside the vocabulary is additionally clamped server-side
  (`_validate_role` → `Program Director`; `_validate_archetype` → `general_initiative`).
- **Chain-of-thought field ordering** — in the draft schema each *reasoning* field is
  declared **before** the decision it justifies (`activity_rationale` before
  `activity_text`; `timeline_reasoning` before the quarters; `classification_reasoning`
  before `assigned_archetype`), so the model reasons before it commits.
- **NAQAAE grounding** — objectives carry `pillar_id`, `tows_type(s)`, `alignment`, and
  `grounded_indicators` (Neo4j Indicator refs), giving every downstream action an
  accreditation-traceable lineage.

---

## 7. Data Model (Supabase / PostgreSQL)

| Table | Migration | Key columns |
|-------|-----------|-------------|
| `agent_runs` | 001 | `run_id` (PK), `agent_id`, `status`, `structured_data` JSONB (holds `plan_status`) |
| `pillars` | 001 | 7 NAQAAE programmatic standards (seeded) |
| `swot_items` | 001 | `type` (S/W/O/T), `pillar_id`, `description`, evidence |
| `strategic_goals` | 002 | `goal_id` (PK), `run_id` (FK), `title`, `original_*`, `pillar_ids[]`, `edited_by_user` |
| `strategic_objectives` | 002 | `objective_id` (PK), `goal_id` (FK), `text`, `original_text`, `tows_type(s)`, `alignment`, `grounded_indicator_id`, `grounded_indicators` JSONB, `source_swot_ids[]` |
| `strategic_actions` | 003–005 | activity/KPI prose + `original_*`, schedule, responsibilities, `assigned_archetype` (+ `original_`), `duration_multiplier` (+ `original_`), `base_cost_egp`, `inflated_cost_egp`, `cost_driver`, `funding_source`, `pricing_provenance` JSONB, `cost_explanation`, `classification_reasoning`, `activity_rationale` |

**Neo4j graph schema** (`RAG/ingest_graph.py`):
`(Document)-[:HAS_STANDARD]->(Standard)-[:HAS_CRITERION]->(Criterion)-[:HAS_INDICATOR]->(Indicator)`,
with `[:HAS_CHUNK]` chunk attachments and `[:NEXT_CHUNK]` sequential links. The NAQAAE
standards Markdown is split on three header levels (Standard / Criterion / Indicator)
and embedded into the `chunk_embedding` vector index.

---

## 8. Known Limitations / Items to Confirm Before Publication

Listed explicitly so the thesis does not over-claim:

1. **Inflation rates (15% / 10%)** are stated planning assumptions, **not** a cited IMF
   forecast (see §3.1). Either cite a real IMF WEO / CBE figure or present them as
   assumptions.
2. **Junk-drawer 59% → 3%** is a single-run, non-deterministic observation (§4), not a
   benchmarked metric.
3. **Embedding-model inconsistency.** `RAG/ingest_graph.py` ingests with
   `nomic-embed-text` (768-dim) while `goals_planner/config.py` sets
   `EMBED_MODEL = "bge-m3"` for grounding queries (the comment claims they must match).
   This should be reconciled — a query/index dimension mismatch would silently degrade
   grounding to `pillar_only`. Verify which model actually backs the live index before
   describing the embedding stack in the thesis.
4. **`gemini-3.1-pro-preview` is a preview model** — note the reproducibility caveat
   (preview endpoints can change/deprecate) when reporting results.
5. **Model heterogeneity** — gap_analysis and goals_planner run on local
   `llama3.1:8b`; only action_planner uses Vertex Gemini. Do not generalise
   Gemini-specific results to the whole system.

---

*Generated as code-grounded thesis context. Every figure traces to a file in this
repository; assumptions and single-run observations are labelled as such.*
