# StratOS Thesis — V1 → V2 Revision Set (code-grounded)

**Purpose.** This file is the complete, copy-paste-ready set of edits that reconcile the
V1 thesis (`StratOS_Thesis_FULL (2).docx`) with the **deployed** system. Every change is
grounded in the actual codebase. Apply each block by locating the quoted V1 text and
replacing it with the V2 text. Prose is written in V1's register so it drops in cleanly.

**Source of truth:** the deployed code + `stratos_final_architecture_context.md` +
`operational_audit_agent.md`.

---

## 0. Global rules (apply everywhere)

1. **Remove entirely**, in every location (body, headings, captions, keywords,
   abbreviations, algorithm titles): *Monte Carlo, Beta-PERT, PERT, Lognormal,
   Value-at-Risk, VaR, P₉₀, ninetieth-percentile, ten-thousand-iteration / 10,000
   iterations, stochastic iterations, risk multiplier, fiscal stress-testing.*
2. **Never** write "audit-proof" / "audit-ready" / "audit-defensible" for the budget.
   Use **"deterministic and reproducible given fixed inputs"** (or "independently
   re-derivable").
3. **Inflation rates (15% local / 10% USD)** are **conservative planning assumptions**,
   never an IMF citation. This framing must appear in the **prose** of Ch3 and Ch5, not
   only beside the formula.
4. **Model placement:** only the **Action Planner** and the **KPI authoring / plan
   synthesis** tasks use capability-dense **cloud** models (Gemini on Vertex AI). The
   local 8-billion-parameter Ollama model serves gap analysis, the Goals Planner's TOWS
   drafting, the Operational Audit diagnosis, and high-throughput extraction/classification.
5. **Embeddings:** keep **model-agnostic** ("a multilingual embedding model" / "the
   accreditation-graph embedding"). Do **not** name nomic-embed-text or bge-m3.
6. **Goal band:** "six to nine" → **"four to nine"** wherever it appears (the deployed
   bounds are MIN_GOALS=4, MAX_GOALS=9). **Keep "six-node"** Goals Planner — it is correct.
7. **Citations:** the bibliography stays at **[1]–[20], untouched**. No reference is
   Monte-Carlo-specific, so none is deleted and no renumbering occurs.

---

## 1. Front matter

### 1.1 Abstract — para [25]
**FIND** (the two sentences beginning "Crucially…" through "…fiscal stress-testing."):
> Crucially, the Action Plan's scheduling and budgeting are not produced by language-model estimation but by an explicit Python-based Monte Carlo engine: activity timelines are sampled from Beta-PERT distributions, while fiscal allocations are derived from ten thousand stochastic iterations under Lognormal risk multipliers to yield an audit-ready, conservative ninetieth-percentile (P₉₀) Value-at-Risk budget. The system was validated within the higher-education domain using authentic Nile University strategic data, establishing StratOS as the first governance-constrained Cognitive Digital Twin to combine end-to-end provenance with mathematically rigorous fiscal stress-testing.

**REPLACE:**
> Crucially, the Action Plan's scheduling and budgeting are not produced by language-model estimation but by a deterministic engine governed by a strict separation of authority: the language model classifies each activity—selecting an operational-expenditure archetype and a duration multiplier—while all monetary computation is performed in Python from decoupled financial registries, applying a compounding inflation adjustment keyed to each cost driver and recording complete, re-derivable pricing provenance. The same layer reconciles each plan year's faculty-operating spend against an inflation-adjusted affordability ceiling. The system was validated within the higher-education domain using authentic Nile University strategic data, and further closes the strategic loop: a historical execution-audit agent mines multi-year monitoring reports and writes its findings back as governed evidence, so that observed execution gaps re-enter the next planning cycle. StratOS thereby stands as the first governance-constrained Cognitive Digital Twin to combine end-to-end provenance with deterministic, independently re-derivable fiscal computation.

Also in [25], **FIND** "and explicit quantitative risk modeling." → **REPLACE** "and explicit, deterministic fiscal computation."

### 1.2 Keywords — para [26]
**FIND:** `Leiden Community Detection; Monte Carlo Simulation; Beta-PERT; Value-at-Risk; NAQAAE Accreditation;`
**REPLACE:** `Leiden Community Detection; Deterministic Cost Provenance; Inflation-Adjusted Budgeting; Closed-Loop Feedback; NAQAAE Accreditation;`

### 1.3 Abbreviations — paras [49], [50], [58]
- **Remove** the rows: `PERT  Program Evaluation and Review Technique`, `P₉₀  Ninetieth-Percentile (conservative risk threshold)`, `VaR  Value-at-Risk`.
- **Add** rows (alphabetical): `CPI  Consumer Price Index`, `FX  Foreign Exchange (currency)`, `HITL  Human-in-the-Loop`, `OPEX  Operating Expenditure`.

---

## 2. Chapter 1

### 2.1 [66] Background — last sentence
**FIND:** "…and disciplined by explicit quantitative risk modeling.[3][4][5]"
**REPLACE:** "…and disciplined by explicit, deterministic fiscal computation.[3][4][5]"

### 2.2 [70] Motivation — final sentence
**FIND:**
> This conviction is realized in the system's Monte Carlo engine, which replaces estimation-by-language-model with simulation-based scheduling and budgeting, and which constitutes a principal contribution of this thesis.

**REPLACE:**
> This conviction is realized in the system's deterministic costing engine, which removes monetary estimation from the language model entirely: the model is permitted only to classify an activity, while a reference-class catalog of operating-cost archetypes and an explicit, inflation-adjusted formula yield every figure reproducibly in Python—a separation of authority that constitutes a principal contribution of this thesis.

### 2.3 [72] Objectives intro
**FIND:** "…into a continuous, evidence-grounded, and audit-ready capability."
**REPLACE:** "…into a continuous, evidence-grounded, and traceable capability."

### 2.4 [77] Objectives — the fifth bullet (replace whole paragraph)
**FIND:**
> To ground the Action Plan's scheduling and budgeting in an explicit Monte Carlo simulation—Beta-PERT timeline estimation and a ten-thousand-iteration Lognormal-multiplier budget model yielding a conservative P₉₀ Value-at-Risk allocation—thereby replacing language-model estimation with reproducible, audit-ready computation.

**REPLACE:**
> To ground the Action Plan's scheduling and budgeting in a deterministic engine that separates classification from computation: the language model selects an operating-expenditure archetype and a duration multiplier and schedules activities across quarters with explicit reasoning, while Python derives every cost from a reference-class catalog under a compounding, cost-driver-specific inflation adjustment—thereby replacing language-model estimation with reproducible, independently re-derivable computation and a per-year affordability reconciliation.

**Add a sixth bullet (new paragraph) after [77]:**
> To close the strategic loop by mining the institution's historical execution record—its prior executive plan and successive annual monitoring reports—into governed strengths and weaknesses that re-enter the next planning cycle as evidence, so that the system learns from its own past execution rather than planning afresh each period.

### 2.5 [80] Scope
**FIND:** "…action-plan operationalization with Monte Carlo scheduling and budgeting, and human-supervised plan synthesis and editing."
**REPLACE:** "…action-plan operationalization with deterministic, inflation-adjusted scheduling and budgeting, and human-supervised plan synthesis and editing."

### 2.6 [83] Scope — last sentence
**FIND:** "…do not affect the operational status of the reasoning, accreditation-grounding, KPI, Action Plan, or Monte Carlo subsystems, all of which execute on authentic persisted data."
**REPLACE:** "…do not affect the operational status of the reasoning, accreditation-grounding, KPI, Action Plan, or deterministic-costing subsystems, all of which execute on authentic persisted data."

### 2.7 [86] Significance — second sentence
**FIND:** "Simultaneously, the Action Plan's timelines and budgets are derived not from language-model conjecture but from explicit simulation—Beta-PERT distributions for schedule estimation and a ten-thousand-iteration Lognormal-multiplier model for a conservative P₉₀ Value-at-Risk budget."
**REPLACE:** "Simultaneously, the Action Plan's timelines and budgets are derived not from language-model conjecture but from explicit, deterministic computation—urgency-aware quarter scheduling and a reference-class costing formula whose every figure is reproducible from recorded inputs and an explicit, cost-driver-specific inflation adjustment."

### 2.8 [89] Outline
**FIND:** "…including the formal specification of the Leiden clustering and Monte Carlo algorithms."
**REPLACE:** "…including the formal specification of the Leiden clustering and the deterministic inflation-adjusted costing algorithm."

---

## 3. Chapter 2

### 3.1 [102] Theoretical-framework intro
**FIND:** "…a graph-theoretic method for thematic clustering, and a pair of probabilistic models for schedule and budget estimation. Each is developed in turn."
**REPLACE:** "…a graph-theoretic method for thematic clustering, and a deterministic discipline for inflation-adjusted costing under a strict separation of classification from computation. Each is developed in turn."

### 3.2 [107] LLM-Modulo — last sentence
**FIND:** "The Monte Carlo engine described below extends this discipline into the fiscal domain, removing scheduling and budgeting from the language model's purview entirely and delegating them to explicit simulation."
**REPLACE:** "The deterministic costing engine described below extends this discipline into the fiscal domain, removing the monetary figure from the language model's purview entirely: the model classifies, and Python computes every cost from a fixed catalog and an explicit inflation formula."

### 3.3 [109] Leiden — goal band
**FIND:** "…within the institutionally meaningful band of six to nine, the one maximizing the silhouette coefficient…"
**REPLACE:** "…within the institutionally meaningful band of four to nine, the one maximizing the silhouette coefficient…"

### 3.4 §2.3.4 — REPLACE heading [113] and body [114]+[116]
**New heading [113]:** `2.3.4 Urgency-Aware Schedule Reasoning`
**Delete** the PERT equation object at [115].
**REPLACE body [114] and [116] with a single paragraph:**
> The temporal dimension of the Action Plan is not a probabilistic estimation problem but a constraint-satisfaction one: each executive activity must be placed within a fixed multi-year planning horizon in a sequence that respects strategic urgency and operational dependency. StratOS schedules activities across discrete quarters of that horizon under an urgency-aware discipline derived from each objective's TOWS classification—objectives addressing threats (the ST and WT quadrants) are placed earlier than those pursuing opportunities, reflecting the higher cost of deferring a defensive response. The language model proposes a start and end quarter for each activity accompanied by explicit chain-of-thought reasoning that cites the objective's priority, its dependencies on prior activities, and the feasibility of concurrent execution; a deterministic schedule-repair step then normalizes and orders the proposed quarters, guaranteeing a well-formed, monotonic timeline. The result is a defensible, dependency-aware execution calendar in which the *placement* of each activity is reasoned by the model but the *integrity* of the schedule is enforced by deterministic logic—an instance of the same LLM-modulo separation that governs the rest of the system.

### 3.5 §2.3.5 — REPLACE heading [117] and body [118]+[119]+[121]
**New heading [117]:** `2.3.5 Deterministic Inflation-Adjusted Costing`
**Delete** the P₉₀ equation object at [120].
**REPLACE body [118], [119], [121] with:**
> The budgetary dimension of the Action Plan is governed not by probabilistic simulation but by a deterministic principle the system terms the separation of authority between classification and computation. The language model is never permitted to emit a monetary value; it is permitted only to classify each activity into one of a fixed set of operating-expenditure archetypes and to assign an integer duration multiplier. All monetary computation is then performed in Python from two decoupled financial registries: a revenue baseline derived from the institution's tuition structure, and a reference-class catalog of operating-cost archetypes seeded from the institution's own historical planning figures. Each archetype carries a base cost, a cost driver (domestic or foreign-exchange-linked), and a funding source (faculty operating budget or central capital). The cost of an activity is the archetype's base cost, scaled by the duration multiplier and adjusted for inflation by a compounding factor selected by the cost driver, rounded to the nearest thousand currency units. The inflation rates applied are conservative planning assumptions—a domestic consumer-price rate and a currency-depreciation rate—recorded with every figure rather than drawn from a live feed, so that the budget is a fixed, reproducible governance artifact rather than a moving estimate.
>
> Two distinct provenance artifacts accompany every priced activity, and the distinction is deliberate. The first, authored by the language model, is a qualitative justification of *why* the activity maps to its archetype; the second, generated in Python, is a deterministic receipt recording the catalog base, the multiplier, the inflation factor, and the resulting figure—containing no language-model narration of the number itself. A machine-readable provenance record stores every input so that any figure can be re-derived independently. Finally, the engine reconciles each plan year's faculty-operating spend against that year's inflation-adjusted affordability ceiling—a fixed fraction of projected tuition revenue—excluding centrally funded capital items and emitting a soft warning where a year's commitments exceed its ceiling. The budget StratOS produces is therefore conservative, fully traceable, and—given the same recorded inputs—identical on every execution, which is precisely the reproducibility that a governance document requires and that no language-model estimate can supply.

### 3.6 [129] Quantitative Rigor Gap — second half of the paragraph
**FIND:** "StratOS closes this gap by removing scheduling and budgeting from the language model entirely and delegating them to an explicit Monte Carlo engine: activity timelines are sampled from Beta-PERT distributions that preserve the asymmetry of real schedule risk, and fiscal allocations are derived from ten thousand stochastic iterations under Lognormal risk multipliers to yield a conservative, audit-ready P₉₀ Value-at-Risk budget. The financial commitments embedded in a StratOS plan are thus reproducible, accompanied by an explicit confidence statement, and defensible under scrutiny."
**REPLACE:** "StratOS closes this gap by removing scheduling and budgeting from the language model entirely: activities are scheduled across quarters under an urgency-aware discipline with deterministic schedule repair, and every fiscal figure is computed in Python from a reference-class cost catalog under an explicit, cost-driver-specific inflation adjustment, with complete pricing provenance recorded for each activity. The financial commitments embedded in a StratOS plan are thus deterministic and reproducible given fixed inputs, independently re-derivable from their recorded provenance, and reconciled against an explicit per-year affordability ceiling."

### 3.7 [130] — first sentence
**FIND:** "…governance grounding through accreditation retrieval and quantitative rigor through Monte Carlo simulation—within a single, provenance-bearing Cognitive Digital Twin…"
**REPLACE:** "…governance grounding through accreditation retrieval and quantitative rigor through deterministic, fully-provenanced costing—within a single, provenance-bearing Cognitive Digital Twin…"

---

## 4. Chapter 3

### 4.1 [142] §3.2 functional requirements
**FIND:** "Action-plan generation operationalizes each objective into an executive matrix with simulation-derived schedules and budgets."
**REPLACE:** "Action-plan generation operationalizes each objective into an executive matrix with deterministically computed, inflation-adjusted schedules and budgets."

### 4.2 [151] §3.3 local-LLM constraint — last sentence (model placement)
**FIND:** "The architecture accommodates this constraint by reserving capability-dense cloud models for tasks demanding polished multilingual generation—plan synthesis and KPI authoring—while delegating high-throughput extraction and classification to the local model."
**REPLACE:** "The architecture accommodates this constraint by reserving capability-dense cloud models for the tasks that demand them—polished multilingual generation in plan synthesis and KPI authoring, and the reasoning-intensive classification at the heart of the Action Planner—while delegating high-throughput extraction, gap analysis, execution-audit diagnosis, and the Goals Planner's objective drafting to the local model."

### 4.3 [154] §3.4 Research Design
**FIND:** "…and the executive-planning layer—the Action Plan subsystem with its Monte Carlo engine—is delivered in full."
**REPLACE:** "…and the executive-planning layer—the Action Plan subsystem with its deterministic, inflation-adjusted costing engine—is delivered in full."

### 4.4 [158] §3.5 Phase 2 — Signal Layer (add the audit agent)
**FIND:** "A constellation of specialized agents—sentiment, technology-intelligence, benchmarking, workforce, social-media, meetings, and survey-generation—continuously distills heterogeneous internal and external evidence into structured, provenance-bearing SWOT items."
**REPLACE:** "A constellation of specialized agents—sentiment, technology-intelligence, benchmarking, workforce, social-media, meetings, survey-generation, and a historical execution-audit agent—continuously distills heterogeneous internal and external evidence into structured, provenance-bearing SWOT items. The execution-audit agent is distinctive in that its evidence is the institution's own past performance: it mines multi-year monitoring reports for indicators that genuinely improved or chronically stalled and writes them back as strengths and weaknesses, closing the loop between execution and the next planning cycle."

### 4.5 [160] §3.5 Phase 4 — Output Layer
**FIND:** "The Action Plan subsystem operationalizes objectives into executive matrices with Monte Carlo schedules and budgets;"
**REPLACE:** "The Action Plan subsystem operationalizes objectives into executive matrices with deterministically computed, inflation-adjusted schedules and budgets;"

### 4.6 [166] §3.6.1 Goals Planner — goal band only (keep "six nodes")
**FIND:** "…synthesizes from them six to nine strategic goals, each bearing two to five SMART objectives…"
**REPLACE:** "…synthesizes from them four to nine strategic goals, each bearing two to five SMART objectives…"

### 4.7 [169] §3.6.1 Node 3 — goal band
**FIND:** "…thematic clusters whose count falls within the institutionally meaningful band of six to nine goals."
**REPLACE:** "…thematic clusters whose count falls within the institutionally meaningful band of four to nine goals."

### 4.8 [176] §3.6.3 The Action Plan Agent — REPLACE the whole paragraph (model + engine correction)
**FIND** (entire [176], beginning "The Action Plan agent constitutes…" … ending "…frozen original snapshots are recorded."):
> The Action Plan agent constitutes the executive-planning layer and is gated to run only on a plan whose goals have been ratified by a human reviewer. It extends the strategic hierarchy one level deeper, attaching to each SMART objective a set of concrete executive activities. For every objective it consumes the objective's SMART text, its governing pillar, its grounded indicators, and its underlying SWOT evidence, and produces two to four action items rendered into the institution's established executive matrix. The matrix columns reproduce the institution's historical planning format exactly: the objective, the target, the executive activities, the follow-up indicators, the timeframe expressed as a start and an end, the responsible entity, the monitoring entity, and the budget. The agent authors the qualitative columns through the local model under structured output, while the timeframe and budget columns are computed not by the model but by the Monte Carlo engine specified in Section 3.8, so that every schedule and every fiscal figure rests on explicit simulation rather than language-model conjecture. As with the Goals Planner, identifiers and foreign keys are assigned deterministically and frozen original snapshots are recorded.

**REPLACE:**
> The Action Plan agent constitutes the executive-planning layer and is gated to run only on a plan whose goals have been ratified by a human reviewer—it refuses to execute unless the strategy run is marked final. It extends the strategic hierarchy one level deeper, attaching to each SMART objective a set of concrete executive activities. For every objective it consumes the objective's SMART text, its governing pillar, its grounded indicators, and its underlying SWOT evidence, and produces two to four action items rendered into the institution's established executive matrix. The matrix columns reproduce the institution's historical planning format exactly: the objective, the target, the executive activities, the follow-up indicators, the timeframe expressed as a start and an end, the responsible entity, the monitoring entity, and the budget. Because this stage demands reasoning-intensive classification and disciplined adherence to controlled vocabularies, its qualitative authoring is performed by a capability-dense cloud reasoning model under structured output, while the timeframe and budget columns are not authored by the model at all: the model selects an operating-cost archetype, a duration multiplier, and start and end quarters, and a deterministic engine—specified in Section 3.8—computes every schedule and every fiscal figure. Responsibilities are constrained to a controlled role vocabulary and archetypes to a fixed catalog, both enforced by typed enumerations so that no value outside the permitted set can be produced. As with the Goals Planner, identifiers and foreign keys are assigned deterministically and frozen original snapshots—including the cost-driving archetype and duration—are recorded so that any human edit can be reset to the original suggestion and re-priced.

### 4.9 [180] §3.7 Data Design — action-plan-items description
**FIND:** "…the action-plan items table, which anchors each row to a strategic objective and records the executive activity, the responsible and monitoring entities, the simulation-derived start and end dates and budget, a status…"
**REPLACE:** "…the action-plan items table, which anchors each row to a strategic objective and records the executive activity, the responsible and monitoring entities, the deterministically computed start and end quarters, the classified cost archetype and its computed inflation-adjusted budget together with full pricing provenance, a status…"

### 4.10 [179] §3.7 — add the consumption-query sentence (closed loop)
**Append to the end of [179]** (after "…downstream check."):
> The same graph and relational stores also realize the system's closed-loop property: because the Goals Planner gathers SWOT evidence by selecting the most recent run of each producing agent, the execution-audit agent's findings are drawn into every subsequent planning cycle automatically, with no orchestration coupling between the two.

### 4.11 §3.8 Algorithmic Design — intro [183]
**FIND:** "Three algorithms constitute the mathematical core of the planning engine: Leiden community detection for goal formation, Beta-PERT estimation for activity scheduling, and Monte Carlo simulation for budget allocation. Each is specified below."
**REPLACE:** "Three algorithms constitute the mathematical core of the planning engine: Leiden community detection for goal formation, urgency-aware quarter scheduling for activity sequencing, and deterministic inflation-adjusted costing for budget allocation. Each is specified below."

### 4.12 [185] §3.8.1 Leiden — goal band
**FIND:** "…selects the partition of best silhouette whose goal count lies within the band of six to nine."
**REPLACE:** "…selects the partition of best silhouette whose goal count lies within the band of four to nine."

### 4.13 §3.8.2 — REPLACE heading [189] and body [190]+[192]
**New heading [189]:** `3.8.2 Urgency-Aware Quarter Scheduling`
**Delete** the PERT equation object at [191].
**REPLACE body:**
> Activity sequencing is a deterministic placement problem over the fixed planning horizon (the four years 2026–2029, partitioned into sixteen quarters), not a sampling problem. For each activity the language model proposes a start and end quarter together with chain-of-thought reasoning that cites three factors: the strategic urgency implied by the parent objective's TOWS quadrant—threat-facing objectives (ST, WT) are placed earlier than opportunity-facing ones—the activity's dependence on the completion of prior activities, and the feasibility of concurrent execution within a quarter. A deterministic schedule-repair routine then validates and normalizes the proposal: it parses each quarter to a year index, enforces that the end does not precede the start, and orders activities within an objective into a coherent, monotonic sequence. The start-year index produced here is the same index consumed by the costing formula of Section 3.8.3, so that an activity scheduled later in the horizon is automatically priced at a higher inflation-adjusted cost. The schedule is thus reasoned by the model but guaranteed well-formed by deterministic logic.

### 4.14 §3.8.3 — REPLACE heading [193] and body [194]+[196]+[198]
**New heading [193]:** `3.8.3 Deterministic Inflation-Adjusted Cost Derivation`
**Delete** the program-total equation at [195] and the P₉₀ equation at [197].
**Insert one new equation object** (the costing formula — see §7 for the OMML spec):
> cost_inflated = round_1000( cost_base × m × (1 + r)^i )
**REPLACE body:**
> Budget allocation replaces a single indefensible figure with a deterministic, reproducible computation under a strict separation of authority: the language model classifies, and Python computes. For each activity the model selects an operating-expenditure archetype and an integer duration multiplier m ∈ {1,2,3,4}; it never emits a monetary value. Python then looks up the archetype's base cost cost_base from a reference-class catalog seeded from the institution's historical planning figures, and computes the activity's cost by the formula above, where i is the activity's start-year index within the planning horizon (the base year having index zero) and r is a compounding annual inflation rate selected by the archetype's cost driver—a domestic consumer-price rate for locally incurred costs and a currency-depreciation rate for foreign-exchange-linked costs. The result is rounded to the nearest thousand currency units. Both rates are conservative planning assumptions, fixed and recorded with every figure rather than drawn from a live market feed, so that the budget is a stable governance artifact that reproduces exactly on re-execution.
>
> Two provenance artifacts are emitted per activity: a model-authored justification of the archetype classification, and a Python-generated receipt recording the base cost, the multiplier, the inflation factor, and the resulting figure. A machine-readable provenance record retains every input, rendering each figure independently re-derivable. Finally, an affordability reconciliation buckets faculty-operating spend by plan year and compares each year's total against that year's inflation-adjusted ceiling—a fixed fraction of projected tuition revenue, itself grown by the domestic inflation rate—excluding centrally funded capital items and emitting a soft warning where a year exceeds its ceiling. The procedure is given in Algorithm 3.2.

**Algorithm title [199]:** `Algorithm 3.2 — Deterministic inflation-adjusted cost derivation and affordability reconciliation.` (Replace the pseudo-code with the classify→lookup→inflate→round→reconcile steps.)

### 4.15 §3.9 Interaction Design — enhance HITL [203] (append after "The system proposes; the executive disposes.")
**Append:**
> This lifecycle extends to fine-grained, field-level editing of the executive matrix. Every AI-authored field of an action item retains a frozen original snapshot—including the cost-driving archetype and duration multiplier—so that a reviewer may revise any field and later reset it to the system's original proposal. Crucially, the human edits only the *classification*: when a cost-driving field is changed, the budget is never typed by hand but recomputed deterministically by the same Python engine, and the plan's per-year affordability reconciliation is refreshed. Writes are idempotent and transactional—prior action rows for a run are deleted before new ones are inserted—so regeneration never leaves a partially written plan. This field-level re-pricing is the clearest single illustration of the separation of authority: the human governs meaning, the engine governs arithmetic.

### 4.16 [205] §3.10 Integration — model-placement sentence
**FIND:** "…and capability-dense cloud models—accessed through the Google generative-AI and Vertex AI interfaces—for polished multilingual synthesis and KPI authoring."
**REPLACE:** "…and capability-dense cloud models—accessed through the Vertex AI interface—for polished multilingual synthesis, KPI authoring, and the reasoning-intensive classification performed by the Action Planner."

---

## 5. Chapter 4

### 5.1 [217] §4.1 Backend — remove the NumPy/SciPy Monte Carlo sentence
**FIND:** "Numerical computation, and in particular the Monte Carlo engine, is implemented with NumPy and SciPy: NumPy provides vectorized sampling and aggregation across the ten-thousand-iteration simulation, while SciPy supplies the Beta-PERT and Lognormal distributions from which activity durations and cost multipliers are drawn."
**REPLACE:** "Numerical computation for the costing engine is implemented in plain Python over the financial registries: archetype base costs are looked up from a versioned catalog and combined with the duration multiplier and a compounding inflation factor by an explicit, closed-form formula, requiring no stochastic sampling and executing in negligible time."

### 5.2 [218] §4.1 Language models — REPLACE the model-portfolio detail (placement correction)
**FIND:** "Capability-dense cloud models are reserved for tasks demanding polished multilingual generation: Gemini 2.0 Flash, accessed through the Google generative-AI interface, performs plan synthesis, and Gemini 2.5 Flash, accessed through Vertex AI, authors the Arabic accreditation indicators."
**REPLACE:** "Capability-dense cloud models, accessed through Vertex AI, are reserved for the tasks that demand them: the authoring of the Arabic accreditation indicators, the rendering of the synthesized plan, and the reasoning-intensive classification at the core of the Action Planner, where a frontier reasoning model is used to map each activity to a precise operating-cost archetype. The Action Planner's classification quality is examined in Section 4.4."

### 5.3 §4.4 — REPLACE the Monte Carlo results paragraph [233]
**FIND** (entire [233] "Monte Carlo budget bounding…"):
> The Action Plan's budget engine executes ten thousand independent stochastic iterations per plan, sampling a Lognormal risk multiplier for every executive activity, summing the perturbed activity costs to a program total in each iteration, and extracting the ninetieth-percentile value of the resulting empirical distribution as the P₉₀ Value-at-Risk allocation. The full ten-thousand-iteration simulation completes in well under a second, owing to vectorized sampling, and is therefore imperceptible within the action-plan generation flow. The engine reliably produces a P₉₀ allocation that exceeds the mean-cost estimate by the risk premium implied by the Lognormal variance, furnishing a conservative budget that, by construction, is not exceeded in ninety percent of simulated futures. Activity timelines are bounded by the same simulation machinery through Beta-PERT sampling of optimistic, most-likely, and pessimistic durations, yielding a probabilistic completion horizon rather than a single nominal date.

**REPLACE:**
> Deterministic budget derivation and reconciliation. The Action Plan's costing engine computes each activity's budget in closed form from its classified archetype, its duration multiplier, and a compounding inflation factor keyed to the cost driver; the computation is instantaneous and, given the same inputs, returns an identical figure on every execution. On a representative end-to-end run over the validation corpus the engine priced sixty-eight executive activities across twenty-two objectives, yielding a faculty-operating total of approximately 12.1 million currency units and a separately tracked central-capital total, and the per-year affordability reconciliation confirmed that every plan year of the 2026–2029 horizon fell within its inflation-adjusted ceiling, raising no over-budget warning. Each figure is accompanied by a machine-readable provenance record and a human-readable receipt, so that any number in the budget can be re-derived independently from its recorded inputs—the reproducibility property that distinguishes the engine from language-model estimation. Activity timelines are placed across the sixteen quarters of the horizon under the urgency-aware discipline of Section 3.8.2, with threat-facing objectives scheduled earliest.

### 5.4 §4.4 — ADD two new result paragraphs after [234] (Items 1 and 4)

**New paragraph — Closed-loop execution audit (Item 1):**
> Closed-loop execution audit. The execution-audit agent was exercised over the institution's prior executive plan and three successive annual monitoring reports. Matching indicators across years by exact comparison after normalization, with a fuzzy token-set fallback for reworded entries, it recovered the great majority of indicators directly and the remainder by approximate match, and classified each indicator's multi-year trajectory as improving, stalled, declining, or chronically in-progress. On a representative run it distilled eighteen objectives into eighteen governed findings—four strengths, drawn only from indicators showing genuine forward movement, and fourteen weaknesses—spanning six of the seven accreditation pillars, and wrote them back to the evidence store. Because the Goals Planner gathers the most recent findings of every agent, these execution-derived strengths and weaknesses are automatically available to the next planning cycle, operationalizing the system's closed-loop, digital-twin character.

**New paragraph — Archetype classification quality (Item 4):**
> Archetype classification quality. Because every budget figure is anchored to the activity's classified archetype, the quality of that classification is consequential. An early configuration using an efficiency-optimized model exhibited a pronounced "junk-drawer" tendency, collapsing a large share of activities—on one representative run, on the order of three-fifths—into two catch-all archetypes and thereby flattening genuine cost distinctions. Two coordinated changes addressed this: upgrading the classification step to a frontier reasoning model, and expanding the archetype catalog to eighteen entries with tightened, mutually exclusive descriptions. On a comparable run the fallback rate fell to roughly one activity in thirty-eight. These figures are reported as an illustrative, single-run before-and-after observed at a low but non-zero decoding temperature, not as a controlled benchmark; they indicate the direction and approximate magnitude of the improvement rather than a precise, reproducible rate, and the reasoning model employed is a preview release whose exact behavior may evolve.

### 5.5 [239] §4.5 closing synthesis
**FIND:** "…its Monte Carlo engine produces conservative, audit-ready budgets and probabilistic schedules; its KPI generator achieves complete pillar coverage;"
**REPLACE:** "…its deterministic costing engine produces conservative, reproducible budgets reconciled against per-year affordability ceilings, and schedules activities across the horizon under an urgency-aware discipline; its KPI generator achieves complete pillar coverage;"

---

## 6. Chapter 5

### 6.1 [247] §5.1 — second sentence
**FIND:** "…and by grounding the schedules and budgets of those activities in explicit Monte Carlo simulation rather than language-model conjecture, the system produces not a static document…"
**REPLACE:** "…and by deriving the schedules and budgets of those activities through deterministic, inflation-adjusted computation rather than language-model conjecture, the system produces not a static document…"

### 6.2 [251] §5.2.1 — last-but-one sentence
**FIND:** "…and the executive-planning layer, absent entirely from the earlier work, is delivered in full with its Monte Carlo engine."
**REPLACE:** "…and the executive-planning layer, absent entirely from the earlier work, is delivered in full with its deterministic, inflation-adjusted costing engine and its closed-loop execution audit."

### 6.3 [255] §5.2.3 — the Quantitative-Rigor-Gap sentence
**FIND:** "…and it closes the Quantitative Rigor Gap by delegating scheduling and budgeting to a Monte Carlo engine that yields a conservative, audit-ready P₉₀ Value-at-Risk allocation."
**REPLACE:** "…and it closes the Quantitative Rigor Gap by delegating scheduling to an urgency-aware discipline and budgeting to a deterministic engine whose every figure is computed from a reference-class catalog under an explicit inflation adjustment, reproducible from recorded provenance and reconciled against a per-year affordability ceiling."

### 6.4 [259] §5.3 Limitations — model-placement sentence
**FIND:** "…and it is for this reason that the system reserves the Vertex-hosted model for the Arabic KPI-authoring task and the Gemini model for plan synthesis."
**REPLACE:** "…and it is for this reason that the system reserves capability-dense cloud models for the Arabic KPI-authoring task, for plan synthesis, and for the reasoning-intensive classification performed by the Action Planner."

### 6.5 §5.3 — ADD a new limitation paragraph (after [260])
> Classification measurement and preview-model dependence. The improvement in archetype classification reported in Chapter 4 is an illustrative, single-run observation taken at a non-zero decoding temperature; it is not a controlled benchmark with a reported sample size and variance, and a rigorous characterization would require repeated trials per configuration. Moreover, the reasoning model used for that classification is a preview release, so its exact behavior—and therefore the precise classification rate—may change as the model is revised. The deterministic costing engine that consumes the classification is, by contrast, fully reproducible; the residual stochasticity is confined to the classification step that selects an archetype, not to the arithmetic that prices it.

### 6.6 [262] §5.4 Summary — the Output-layer sentence
**FIND:** "…and the Output layer operationalizes those objectives into a NAQAAE-compliant executive matrix whose schedules and budgets rest on explicit Monte Carlo simulation, and renders the result as a human-auditable plan."
**REPLACE:** "…and the Output layer operationalizes those objectives into a NAQAAE-compliant executive matrix whose schedules are placed under an urgency-aware discipline and whose budgets rest on deterministic, inflation-adjusted computation with full provenance, and renders the result as a human-auditable plan."
*(Note: "six-node Goals Planner" in this paragraph is correct — leave it unchanged.)*

### 6.7 [265] §5.5 Future Work — Boardroom Simulator
**FIND:** "…subjecting each to pre-mortem critique and, where appropriate, Monte Carlo stress-testing—before the goals are presented to a human for ratification."
**REPLACE:** "…subjecting each to pre-mortem critique and structured adversarial debate—before the goals are presented to a human for ratification."

---

## 7. Equation specifications (for OMML rendering)

**Five** V1 equation objects are **deleted**, replaced by **one** new equation. The five
are: the Beta-PERT mean at §2.3.4 `[115]`; the **P₉₀ equation at §2.3.5 `[120]`**; the
PERT mean at §3.8.2 `[191]`; the Monte Carlo program-total at §3.8.3 `[195]`; and the
**P₉₀ equation at §3.8.3 `[197]`**. Note there are **two distinct P₉₀ equations** (one in
§2.3.5, one in §3.8.3) — Global Rule 1 forbids any P₉₀ remaining, so **both** are removed.

**New equation (insert in §3.8.3, and referenced in §2.3.5):**

- Linear form: `cost_inflated = round_1000( cost_base × m × (1 + r)^i )`
- Where: `m ∈ {1,2,3,4}` (duration multiplier); `i` = start-year index, base year = 0;
  `r = r_local = 0.15` if cost driver is domestic, `r = r_fx = 0.10` if foreign-exchange-linked;
  `round_1000(·)` rounds to the nearest 1,000 currency units.
- Affordability ceiling (inline, may stay prose): `ceiling_year_i = base_ceiling × (1 + r_local)^i`,
  with `base_ceiling = 0.05 × projected_tuition_revenue`.

The Leiden modularity equation (§2.3.3 / §3.8.1) is **unchanged**.

---

## 8. Citations — no change

The bibliography remains **[1]–[20], untouched**. No Monte-Carlo / Beta-PERT / VaR
source exists in it, so nothing is deleted and no renumbering occurs. All in-text
markers ([9], [10], [11], [16], [17], [18], [19] etc.) survive because their host
paragraphs are retained or only locally reworded. The closed-loop discussion can reuse
Park [16] and Horton [17] without adding new references.

---

## 9. Final constraints checklist (verify after applying)

- [ ] No occurrence of: Monte Carlo, Beta-PERT, PERT, Lognormal, VaR, P₉₀,
      ninetieth-percentile, ten-thousand-iteration, stochastic, risk multiplier
      (body, headings, captions, keywords, abbreviations, algorithm titles).
- [ ] "audit-ready/audit-proof/audit-defensible" for the budget → replaced with
      "deterministic and reproducible given fixed inputs" / "independently re-derivable."
- [ ] Inflation 15%/10% framed as "conservative planning assumptions" in Ch3 §3.8.3
      prose **and** Ch5 (§5.2.3 / §5.3).
- [ ] Action Planner described as using a cloud reasoning model (not local);
      gap analysis, Goals-Planner drafting, and execution audit described as local.
- [ ] Embeddings model-agnostic (no nomic-embed-text / bge-m3 named).
- [ ] Goal band reads "four to nine" everywhere; "six-node" Goals Planner retained.
- [ ] Closed-loop audit present in Abstract, §3.5 Signal layer, §3.7, §4.4, §5.2.1.
- [ ] Bibliography still [1]–[20], unchanged.
