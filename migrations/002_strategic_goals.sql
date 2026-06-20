-- ============================================================
-- Migration 002: Strategic Goals & Objectives (consolidated)
-- ============================================================
-- Single migration for the strategy_planner output schema. Consolidates the
-- former 002 (tables), 003 (original_* AI-snapshot columns) and 004 (multi-
-- indicator / multi-TOWS provenance) into one file.
--
-- Idempotent and safe to re-run. The CREATE TABLEs build the full final shape
-- on a fresh database; the ALTER ... ADD COLUMN IF NOT EXISTS block at the end
-- also upgrades a database that still has the older (pre-003/004) table shape.

-- ── Goals (الغايات) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.strategic_goals (
    goal_id              uuid        NOT NULL,
    run_id               uuid        NOT NULL,
    title                text        NOT NULL,
    description          text        NULL,
    original_title       text        NULL,    -- AI-authored text, frozen on first write
    original_description text        NULL,    -- AI-authored text, frozen on first write
    pillar_ids           integer[]   NULL,    -- distinct pillars spanned by this goal's objectives
    position             integer     NOT NULL DEFAULT 0,
    edited_by_user       boolean     NOT NULL DEFAULT false,
    created_at           timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT strategic_goals_pkey
        PRIMARY KEY (goal_id),
    CONSTRAINT strategic_goals_run_id_fkey
        FOREIGN KEY (run_id) REFERENCES agent_runs (run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_strategic_goals_run_id
    ON public.strategic_goals USING btree (run_id);

-- ── Objectives (الأهداف) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.strategic_objectives (
    objective_id            uuid        NOT NULL,
    goal_id                 uuid        NOT NULL,
    text                    text        NOT NULL,
    original_text           text        NULL,        -- AI-authored text, frozen on first write
    tows_type               text        NOT NULL,     -- 'SO' | 'WO' | 'ST' | 'WT' (primary/representative)
    tows_types              text[]      NULL,         -- all quadrants represented (pillar-merge)
    alignment               text        NOT NULL,     -- 'indicator' | 'pillar_only' | 'strategic'
    pillar_id               integer     NULL,         -- the objective's NAQAAE pillar
    grounded_indicator_id   text        NULL,         -- primary (strongest) Neo4j Indicator ref (NOT a FK)
    grounding_score         real        NULL,         -- cosine similarity of the primary indicator
    grounded_indicators     jsonb       NULL,         -- [{"indicator_id": "...", "grounding_score": 0.83}, ...] strongest first
    source_swot_ids         uuid[]      NOT NULL,     -- the SWOT item_ids that produced this objective
    improvement_source      text        NULL,         -- مقترح التحسين used as backbone (WO/WT)
    position                integer     NOT NULL DEFAULT 0,
    edited_by_user          boolean     NOT NULL DEFAULT false,
    created_at              timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT strategic_objectives_pkey
        PRIMARY KEY (objective_id),
    CONSTRAINT strategic_objectives_goal_id_fkey
        FOREIGN KEY (goal_id) REFERENCES strategic_goals (goal_id) ON DELETE CASCADE,
    CONSTRAINT strategic_objectives_tows_check
        CHECK (tows_type IN ('SO', 'WO', 'ST', 'WT')),
    CONSTRAINT strategic_objectives_alignment_check
        CHECK (alignment IN ('indicator', 'pillar_only', 'strategic'))
);

CREATE INDEX IF NOT EXISTS idx_strategic_objectives_goal_id
    ON public.strategic_objectives USING btree (goal_id);

CREATE INDEX IF NOT EXISTS idx_strategic_objectives_alignment
    ON public.strategic_objectives USING btree (alignment);

-- ── Upgrade path for databases created by the older (pre-003/004) shape ────────
-- No-ops on a fresh DB (the columns already exist from the CREATEs above).
ALTER TABLE public.strategic_goals
    ADD COLUMN IF NOT EXISTS original_title       text NULL,
    ADD COLUMN IF NOT EXISTS original_description text NULL;

ALTER TABLE public.strategic_objectives
    ADD COLUMN IF NOT EXISTS original_text       text   NULL,
    ADD COLUMN IF NOT EXISTS tows_types          text[] NULL,
    ADD COLUMN IF NOT EXISTS grounded_indicators jsonb  NULL;

-- ── Origin + persisted feasibility (HITL) ─────────────────────────────────────
-- added_by_user : false = AI-generated (the pipeline default), true = human-added.
-- feasibility_* : the persisted HITL feasibility verdict + evidence snapshot, so a
--                 check survives refresh and the Action Plan stage can skip anything
--                 flagged 'infeasible'.
ALTER TABLE public.strategic_goals
    ADD COLUMN IF NOT EXISTS added_by_user               boolean     NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS feasibility_verdict         text        NULL,  -- feasible|infeasible|insufficient_data|null
    ADD COLUMN IF NOT EXISTS feasibility_reason          text        NULL,
    ADD COLUMN IF NOT EXISTS feasibility_suggestion      text        NULL,
    ADD COLUMN IF NOT EXISTS feasibility_timeframe_years integer     NULL,
    ADD COLUMN IF NOT EXISTS feasibility_evidence        jsonb       NULL,  -- {swot_items, indicators, pillars} snapshot
    ADD COLUMN IF NOT EXISTS feasibility_checked_at      timestamptz NULL;

ALTER TABLE public.strategic_objectives
    ADD COLUMN IF NOT EXISTS added_by_user               boolean     NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS feasibility_verdict         text        NULL,
    ADD COLUMN IF NOT EXISTS feasibility_reason          text        NULL,
    ADD COLUMN IF NOT EXISTS feasibility_suggestion      text        NULL,
    ADD COLUMN IF NOT EXISTS feasibility_timeframe_years integer     NULL,
    ADD COLUMN IF NOT EXISTS feasibility_evidence        jsonb       NULL,
    ADD COLUMN IF NOT EXISTS feasibility_checked_at      timestamptz NULL;

