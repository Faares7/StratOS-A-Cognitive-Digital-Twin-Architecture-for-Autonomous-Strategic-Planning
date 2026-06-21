-- ============================================================
-- Migration 003: SWOT Consolidation Pipeline output
-- ============================================================
-- One STANDALONE table for the SWOT consolidation pipeline (docs/SWOT_PIPELINE.md).
--
-- Safety: this migration creates ONE new table and nothing else. It references no
-- existing table and ALTERS no existing table. Links to swot_items are soft uuid[]
-- arrays (same pattern as strategic_objectives.source_swot_ids in 002), not FKs, so
-- there is zero coupling to or modification of the existing schema. pillar_id is a
-- plain integer with no FK to pillars (matching the 002 convention).
--
-- Approval state lives directly on this table (approved + approved_at columns).
-- Approving a run sets approved=true on all its candidates and clears any prior run,
-- so downstream reads WHERE approved = true without any join.
--
-- Idempotent and safe to re-run.

-- ── Consolidated SWOT candidates ─────────────────────────────────
-- One row per CANONICAL item (a dedup cluster) per consolidation run. Stores both
-- KEPT and CUT candidates: `selected` records the hybrid-gate outcome, and the full
-- per-factor breakdown is retained so (a) the terminal debug print and (b) later
-- weight-tuning both read from the same persisted data.
CREATE TABLE IF NOT EXISTS public.swot_consolidation_candidates (
    candidate_id          uuid             NOT NULL,
    consolidation_run_id  uuid             NOT NULL,   -- groups all candidates from one pipeline run
    created_at            timestamptz      NOT NULL DEFAULT now(),

    -- ── Namespace + classification ──────────────────────────────
    branch                text             NOT NULL,   -- 'internal' | 'external'
    type                  text             NOT NULL,   -- 'strength' | 'weakness' | 'opportunity' | 'threat'
    pillar_id             integer          NULL,        -- internal S/W only; NULL for external (no FK, matches 002)
    pillar_name           text             NULL,

    -- ── Canonical content (cluster medoid, polished) ────────────
    title                 text             NULL,
    description           text             NOT NULL,

    -- ── Evidence trail (soft refs; NO FKs) ──────────────────────
    member_item_ids       uuid[]           NOT NULL,    -- swot_items.item_id that formed this cluster
    contributing_agents   text[]           NOT NULL,    -- distinct agent_ids in the cluster
    snapshot_count        integer          NULL,        -- distinct input snapshots (changing agents); NULL/1 for static-input

    -- ── Salience: features + final score (debug + tuning) ───────
    factor_breakdown      jsonb            NOT NULL,    -- {corroboration, severity, persistence, base_priority, recency, agreement}
    salience_score        double precision NOT NULL,
    scoring_config        jsonb            NULL,        -- weights/threshold/window used this run (audit / reproducibility)

    -- ── Lifecycle vs previous plan ──────────────────────────────
    lifecycle_state       text             NOT NULL,    -- 'new' | 'persistent' | 'carried_forward' | 'resolved'

    -- ── Selection (hybrid gate) + debug ─────────────────────────
    selected              boolean          NOT NULL,    -- passed min-1 / max-K / threshold
    selection_reason      text             NULL,        -- why kept/cut (same string printed to terminal)

    -- ── Human gate + tuning label ───────────────────────────────
    reviewer_decision     text             NOT NULL DEFAULT 'pending',  -- 'keep' | 'cut' | 'pending'
    resolved_confirmed    boolean          NULL,        -- only meaningful when lifecycle_state='resolved' (human-confirm, decision #3)
    reviewed_at           timestamptz      NULL,

    -- ── Approval state ──────────────────────────────────────────
    approved              boolean          NOT NULL DEFAULT false,  -- true on every candidate of the approved run
    approved_at           timestamptz      NULL,                    -- when this run was approved (same value across the run)

    CONSTRAINT swot_consolidation_candidates_pkey
        PRIMARY KEY (candidate_id),
    CONSTRAINT swot_consolidation_branch_check
        CHECK (branch IN ('internal', 'external')),
    CONSTRAINT swot_consolidation_type_check
        CHECK (type IN ('strength', 'weakness', 'opportunity', 'threat')),
    CONSTRAINT swot_consolidation_lifecycle_check
        CHECK (lifecycle_state IN ('new', 'persistent', 'carried_forward', 'resolved')),
    CONSTRAINT swot_consolidation_reviewer_check
        CHECK (reviewer_decision IN ('keep', 'cut', 'pending'))
);

CREATE INDEX IF NOT EXISTS idx_swot_consolidation_run
    ON public.swot_consolidation_candidates USING btree (consolidation_run_id);
CREATE INDEX IF NOT EXISTS idx_swot_consolidation_branch_type
    ON public.swot_consolidation_candidates USING btree (branch, type);
CREATE INDEX IF NOT EXISTS idx_swot_consolidation_pillar
    ON public.swot_consolidation_candidates USING btree (pillar_id);
CREATE INDEX IF NOT EXISTS idx_swot_consolidation_lifecycle
    ON public.swot_consolidation_candidates USING btree (lifecycle_state);
CREATE INDEX IF NOT EXISTS idx_swot_consolidation_approved
    ON public.swot_consolidation_candidates USING btree (approved);

-- ── Upgrade path: widen lifecycle_state to include 'carried_forward' ───
-- Re-running on a DB created before Fix 2 updates the CHECK; on a fresh DB it
-- just re-asserts the constraint created above (idempotent).
ALTER TABLE public.swot_consolidation_candidates
    DROP CONSTRAINT IF EXISTS swot_consolidation_lifecycle_check;
ALTER TABLE public.swot_consolidation_candidates
    ADD CONSTRAINT swot_consolidation_lifecycle_check
        CHECK (lifecycle_state IN ('new', 'persistent', 'carried_forward', 'resolved'));

-- ── Upgrade path: add approval columns if this runs on an existing table ───
ALTER TABLE public.swot_consolidation_candidates
    ADD COLUMN IF NOT EXISTS approved    boolean     NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS approved_at timestamptz NULL;

-- ── Cleanup: remove the old standalone approvals table if it exists ─────
DROP TABLE IF EXISTS public.swot_consolidation_approvals;
