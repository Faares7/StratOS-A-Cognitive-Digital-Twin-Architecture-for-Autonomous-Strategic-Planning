-- StratOS — Unified Agent Output Schema
-- Run this once against your Supabase Postgres database.

CREATE TABLE IF NOT EXISTS pillars (
    pillar_id   INT PRIMARY KEY,
    name        TEXT NOT NULL,
    short_desc  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_runs (
    run_id          UUID PRIMARY KEY,
    agent_id        TEXT NOT NULL,
    run_timestamp   TIMESTAMPTZ NOT NULL,
    status          TEXT NOT NULL,
    errors          JSONB,
    structured_data JSONB,
    raw_envelope    JSONB
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_id ON agent_runs (agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_timestamp ON agent_runs (run_timestamp DESC);

CREATE TABLE IF NOT EXISTS swot_items (
    item_id         UUID PRIMARY KEY,
    run_id          UUID NOT NULL REFERENCES agent_runs(run_id) ON DELETE CASCADE,
    agent_id        TEXT NOT NULL,
    type            TEXT NOT NULL CHECK (type IN ('strength','weakness','opportunity','threat')),
    title           TEXT,
    description     TEXT NOT NULL,
    evidence        JSONB,
    impact_level    TEXT,
    pillar_id       INT REFERENCES pillars(pillar_id),
    pillar_name     TEXT,
    source_metadata JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_swot_items_run_id ON swot_items (run_id);
CREATE INDEX IF NOT EXISTS idx_swot_items_type ON swot_items (type);
CREATE INDEX IF NOT EXISTS idx_swot_items_pillar_id ON swot_items (pillar_id);

-- Seed the 7 NAQAAE pillars (idempotent)
INSERT INTO pillars (pillar_id, name, short_desc) VALUES
    (1, 'Program Mission and Management',
        'Mission clarity and stakeholder participation, leadership selection and evaluation, marketing and visibility, international agreements and partnerships.'),
    (2, 'Program Design',
        'NARS or alternative academic reference standards, program structure and curriculum balance, program specification, course specifications and matrices.'),
    (3, 'Teaching, Learning and Assessment',
        'Diverse teaching methods, active learning and skills development, field training, diverse and fair student assessment, exam mechanisms and fairness, using results for development, feedback to students.'),
    (4, 'Students and Graduates',
        'Academic support and advising, identifying high-achieving/struggling/gifted students, student activities and career guidance, graduate follow-up and database.'),
    (5, 'Faculty and Teaching Assistants',
        'Faculty and teaching assistant numbers and workload, qualifications and competencies, selection criteria, continuous professional development, research and community activity.'),
    (6, 'Resources and Learning Facilities',
        'Financial resources, premises and lab equipment, health/safety/occupational security, digital and technological infrastructure, library and learning sources.'),
    (7, 'Quality Assurance and Program Evaluation',
        'Feedback from students/faculty/graduates/employers, course reports, annual program reports, monitoring enhancement and continuous improvement.')
ON CONFLICT (pillar_id) DO UPDATE
    SET name = EXCLUDED.name,
        short_desc = EXCLUDED.short_desc;
