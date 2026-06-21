-- StratOS — HITL edit snapshots for the cost-driving fields
-- =================================================================
-- The Action Plan's cost is a pure function of (assigned_archetype,
-- duration_multiplier, start_year_index). To let a human EDIT an archetype or
-- duration and still "reset to AI suggestion", we must snapshot those two
-- fields too (003 only snapshotted prose/quarters/roles).
--
-- With these, every cost-driving input has a frozen original, so the original
-- cost is always recomputable on reset — no need to store the cost itself.
-- Idempotent.
-- =================================================================

ALTER TABLE strategic_actions
    ADD COLUMN IF NOT EXISTS original_assigned_archetype  TEXT,
    ADD COLUMN IF NOT EXISTS original_duration_multiplier SMALLINT;
