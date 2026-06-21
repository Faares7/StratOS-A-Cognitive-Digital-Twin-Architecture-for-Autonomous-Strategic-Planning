-- StratOS — Action Plan explainability fields
-- =================================================================
-- Adds human-readable reasoning to strategic_actions:
--   * activity_rationale        (LLM)    — why this activity + KPI follow from the objective/SWOT
--   * classification_reasoning  (LLM)    — the economic "why it costs what it costs" (archetype + duration)
--   * cost_explanation          (Python) — deterministic receipt of the cost computation
--
-- timeline_reasoning already exists (added in 003) and is enriched at the prompt
-- level only. Reasoning fields are AI explanations (not human-edited), so they
-- follow the timeline_reasoning convention and carry no original_* snapshot.
-- Idempotent.
-- =================================================================

ALTER TABLE strategic_actions
    ADD COLUMN IF NOT EXISTS activity_rationale       TEXT,
    ADD COLUMN IF NOT EXISTS classification_reasoning TEXT,
    ADD COLUMN IF NOT EXISTS cost_explanation         TEXT;
