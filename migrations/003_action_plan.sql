-- StratOS — Action Plan (الخطة التنفيذية) stage
-- =================================================================
-- Extends the strategy hierarchy one level deeper:
--     Run -> Goal -> Objective -> Action item (نشاط)
--
-- One row per executive activity, anchored to a strategic_objective.
-- Requires 002_strategic_goals.sql to have been applied first
-- (this migration references strategic_objectives.objective_id).
--
-- Design notes:
--  * "LLM classifies, Python computes" — the agent stores both the raw
--    catalog cost (base_cost_egp, 2026 EGP) and the Python-computed
--    inflated_cost_egp, plus full pricing_provenance for audit.
--  * original_* columns are the frozen AI snapshot for every
--    human-editable field, enabling "reset to AI suggestion".
--  * Central CapEx items keep their REAL inflated cost here; they are
--    merely excluded from the faculty operating-envelope total by the agent.
-- =================================================================

CREATE TABLE IF NOT EXISTS strategic_actions (
    action_id                    UUID PRIMARY KEY,
    objective_id                 UUID NOT NULL
                                     REFERENCES strategic_objectives(objective_id) ON DELETE CASCADE,
    run_id                       UUID NOT NULL,

    -- ── Prose (AI-generated, human-editable) + frozen snapshots ──────────────
    activity_text                TEXT NOT NULL,
    original_activity_text       TEXT,
    kpi_name                     TEXT,
    original_kpi_name            TEXT,
    timeline_reasoning           TEXT,            -- chain-of-thought for scheduling (not user-editable)

    -- ── Schedule: display string + structured index for math ────────────────
    start_quarter                TEXT,            -- e.g. 'Q1 2026'
    end_quarter                  TEXT,            -- e.g. 'Q3 2026'
    original_start_quarter       TEXT,
    original_end_quarter         TEXT,
    start_year_index             SMALLINT,        -- 0..3  (2026=0, 2027=1, 2028=2, 2029=3)

    -- ── Responsibility (controlled vocabulary) + frozen snapshots ───────────
    responsible_exec             TEXT,
    original_responsible_exec    TEXT,
    responsible_monitor          TEXT,
    original_responsible_monitor TEXT,

    -- ── Tier 3 pricing provenance ("LLM classifies, Python computes") ───────
    assigned_archetype           TEXT,
    duration_multiplier          SMALLINT NOT NULL DEFAULT 1
                                     CHECK (duration_multiplier BETWEEN 1 AND 4),
    base_cost_egp                NUMERIC(14,2),   -- 2026 EGP, un-inflated catalog cost
    inflated_cost_egp            NUMERIC(14,2),   -- final computed cost (REAL value, even if central)
    cost_driver                  TEXT CHECK (cost_driver IN ('local','usd_linked')),
    funding_source               TEXT CHECK (funding_source IN ('faculty_opex','central_capex')),
    pricing_provenance           JSONB,           -- {base, duration_multiplier, year_index, rate, formula, ...}

    -- ── Metadata ─────────────────────────────────────────────────────────────
    position                     SMALLINT,
    edited_by_user               BOOLEAN NOT NULL DEFAULT FALSE,
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strategic_actions_run_id       ON strategic_actions (run_id);
CREATE INDEX IF NOT EXISTS idx_strategic_actions_objective_id ON strategic_actions (objective_id);
CREATE INDEX IF NOT EXISTS idx_strategic_actions_funding      ON strategic_actions (funding_source);
