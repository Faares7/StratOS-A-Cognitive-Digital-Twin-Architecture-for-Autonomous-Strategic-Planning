// ─── NAQAAE Pillars ────────────────────────────────────────────────────────────
export const NAQAAE_PILLARS = [
  "Pillar 1: Leadership & Governance",
  "Pillar 2: Strategic Planning",
  "Pillar 3: Quality Assurance Systems",
  "Pillar 4: Faculty Development",
  "Pillar 5: Student Learning Outcomes",
  "Pillar 6: Curriculum Design",
  "Pillar 7: Research & Innovation",
  "Pillar 8: Community Engagement",
  "Pillar 9: International Partnerships",
  "Pillar 10: Physical Infrastructure",
  "Pillar 11: Financial Sustainability",
  "Pillar 12: Digital Transformation",
] as const;

export type NaqaaePillar = (typeof NAQAAE_PILLARS)[number];

// ─── SWOT ──────────────────────────────────────────────────────────────────────
export type SwotCategory = "strength" | "weakness" | "opportunity" | "threat";
export type ImpactLevel = "critical" | "high" | "medium" | "low";
export type DataSource = "live" | "mock" | "calculated";

export interface Evidence {
  type: "calculation" | "raw_text" | "statistical";
  source_document?: string;
  raw_value?: number | string;
  formula?: string;
  explanation: string;
  data_points?: Record<string, number | string>;
}

export interface InsightCard {
  id: string;
  category: SwotCategory;
  title: string;
  description: string;
  pillar_tag: NaqaaePillar;
  impact_level: ImpactLevel;
  confidence_score: number; // 0-100
  reference_count: number;
  created_at: string; // ISO date
  data_source: DataSource;
  is_validated: boolean;
  evidence: Evidence;
  ai_suggestion?: boolean;
  source_agent?: string; // which agent produced this insight
}

// ─── KPIs ──────────────────────────────────────────────────────────────────────
export interface KPIMetric {
  id: string;
  label: string;
  value: number | string;
  unit?: string;
  trend?: "up" | "down" | "stable";
  trend_value?: number;
  status?: "good" | "warning" | "critical" | "neutral";
  data_source: DataSource;
}

export interface ComplianceSummary {
  overall_score: number; // 0-100
  next_submission_date: string;
  days_remaining: number;
  pillar_scores: Record<string, number>;
  last_updated: string;
  data_source: DataSource;
}

// ─── Meetings ──────────────────────────────────────────────────────────────────
export type MeetingType = "Board Meeting" | "Department" | "Committee" | "1:1" | "Research Council";

export interface ActionItem {
  id: string;
  description: string;
  assignee: string;
  is_completed: boolean;
}

export interface Meeting {
  id: string;
  title: string;
  type: MeetingType;
  date: string;
  duration_minutes: number;
  participants: string[];
  ai_summary: string;
  key_decisions: string[];
  action_items: ActionItem[];
  has_recording: boolean;
  has_transcript: boolean;
  data_source: DataSource;
  // Enriched fields populated by Google Calendar / Fathom
  transcript?: string;
  recording_url?: string;
  meet_link?: string;
  calendar_event_id?: string;
  html_link?: string;
  fathom_call_id?: string;
}

// ─── Research Intelligence ─────────────────────────────────────────────────────
export interface UniversityResearchMetrics {
  university_name: string;
  rank?: number;
  publications: number;
  h_index: number;
  total_citations: number;
  h_index_history: { year: number; value: number }[];
  // Enrollment-adjusted benchmarking
  total_students?: number | null;
  faculty_count?: number | null;
  research_intensity?: number; // RII = publications / students / faculties × 1000
  publications_history?: { year: number; value: number }[]; // raw papers/year
  intensity_history?: { year: number; value: number }[]; // enrollment-adjusted papers/year
}

export interface ResearchIntelligence {
  nile_university: UniversityResearchMetrics;
  competitors: UniversityResearchMetrics[];
  data_source: DataSource;
}

// ─── Gap Analysis ──────────────────────────────────────────────────────────────
export interface PillarGap {
  pillar: NaqaaePillar;
  pillar_short: string;
  current_score: number; // 0-100
  benchmark_score: number; // always 100 for NAQAAE
  gap: number;
}

export interface GapAnalysis {
  pillars: PillarGap[];
  overall_gap: number;
  critical_pillars: string[];
  data_source: DataSource;
}

// ─── Scenario Simulation ───────────────────────────────────────────────────────
export interface SimulationOutcome {
  label: "Best Case" | "Most Probable" | "Worst Case";
  percentage_change: number;
  probability: number;
  description?: string;
}

export interface SimulationResult {
  query: string;
  outcomes: SimulationOutcome[];
  confidence: number;
  simulated_at: string;
  iterations: number;
}

// ─── Organisation ──────────────────────────────────────────────────────────────
export type TeamRole = "Admin" | "Editor" | "Viewer";

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  avatar_initials: string;
  joined_at: string;
}

export interface OrganizationProfile {
  name: string;
  type: string;
  accreditation_body: string;
  admin_email: string;
  uploaded_documents: UploadedDocument[];
}

export interface UploadedDocument {
  id: string;
  name: string;
  type: string;
  uploaded_at: string;
  status: "processing" | "saved" | "failed";
  size_kb: number;
}

// ─── Dashboard ─────────────────────────────────────────────────────────────────
export interface DashboardData {
  compliance: ComplianceSummary;
  kpis: KPIMetric[];
  swot_summary: {
    strengths: InsightCard[];
    weaknesses: InsightCard[];
    opportunities: InsightCard[];
    threats: InsightCard[];
  };
  recent_meetings: Meeting[];
  last_simulation: SimulationResult | null;
  sync_status: "syncing" | "up_to_date" | "error";
}

// ─── AI Assistant ──────────────────────────────────────────────────────────────
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

// ─── Strategy Planner ──────────────────────────────────────────────────────────

export type TowsType      = "SO" | "WO" | "ST" | "WT";
export type AlignmentType = "indicator" | "pillar_only" | "strategic";
export type PlanStatus    = "draft" | "final";

export interface StrategyStation {
  key:    string;
  label:  string;
  status: "pending" | "active" | "done";
  detail: string;
}

export interface StrategyProgress {
  stations: StrategyStation[];
  retries:  number;
}

export interface SwotSourceItem {
  item_id:     string;
  type:        "strength" | "weakness" | "opportunity" | "threat";
  title:       string | null;
  description: string;
  pillar_name: string | null;
}

// One NAQAAE indicator an objective traces to (an objective may merge several
// pairs within a pillar → several indicators).
export interface ObjectiveIndicator {
  indicator_id:    string | null;
  grounding_score: number | null;
  indicator_title: string | null;
  indicator_text:  string | null;
}

export interface StrategyObjective {
  objective_id:          string;
  goal_id:               string;
  text:                  string;
  original_text:         string | null;
  tows_type:             TowsType;
  tows_types?:           TowsType[];          // all quadrants represented (pillar-merge)
  alignment:             AlignmentType;
  pillar_id:             number | null;
  grounded_indicator_id: string | null;
  grounding_score:       number | null;
  grounded_indicators?:  { indicator_id: string | null; grounding_score: number | null }[];
  source_swot_ids:       string[];
  improvement_source:    string | null;
  position:              number;
  edited_by_user:        boolean;
  added_by_user:         boolean;              // true = human-added, false = AI-generated
  feasibility?:          FeasibilityResult | null;  // persisted HITL verdict (null = unchecked)
  // enriched by GET /api/strategy/goals/{run_id}
  source_items:    SwotSourceItem[];
  indicator_title: string | null;
  indicator_text:  string | null;
  indicators?:     ObjectiveIndicator[];      // full list, strongest first
}

export interface StrategyGoal {
  goal_id:              string;
  run_id:               string;
  title:                string;
  description:          string | null;
  original_title:       string | null;
  original_description: string | null;
  pillar_ids:           number[];
  position:             number;
  edited_by_user:       boolean;
  added_by_user:        boolean;               // true = human-added, false = AI-generated
  feasibility?:         FeasibilityResult | null;   // persisted HITL verdict (null = unchecked)
  objectives:           StrategyObjective[];
}

export interface StrategyPlan {
  run_id:            string;
  plan_status:       PlanStatus;
  finalized_at:      string | null;
  validation_errors: string[];     // surfaced from the validate node; blocks approval
  goals:             StrategyGoal[];
}

// ─── Feasibility (HITL preview) ────────────────────────────────────────────────
export type FeasibilityVerdict = "feasible" | "infeasible" | "insufficient_data";

export interface FeasibilityIndicator {
  indicator_id:    string;
  indicator_title: string | null;
  grounding_score: number | null;
}

export interface FeasibilityResult {
  verdict:         FeasibilityVerdict;
  reason:          string;
  suggestion:      string;
  timeframe_years: number;
  checked_at?:     string | null;   // present when persisted on a saved item
  evidence: {
    swot_items: SwotSourceItem[];
    indicators: FeasibilityIndicator[];
    pillars:    string[];
  };
}

// ─── HITL Gap Analysis ─────────────────────────────────────────────────────────

export interface SwotItemDetail {
  item_id: string;
  title: string;
  description: string;
  agent_id: string;
  impact_level: string;
  pillar_name: string;
  evidence: unknown;
  source_metadata: Record<string, unknown> | null;
}

export interface PillarDraft {
  pillar: string;
  target_state: string;
  strengths: string;
  weaknesses: string;
  opportunities?: string;
  threats?: string;
  strength_items?: SwotItemDetail[];
  weakness_items?: SwotItemDetail[];
  opportunity_items?: SwotItemDetail[];
  threat_items?: SwotItemDetail[];
  target_source?: "neo4j" | "mock";
  swot_source?: "live" | "mock";
}

export interface GapDraft {
  pillars: PillarDraft[];
  data_source: string;
}

export interface GapSuggestion {
  suggestion: string;
  reasoning: string;
  gap_identified: string;
  is_user_added?: boolean;
}

export interface PillarSuggestion {
  pillar: string;
  suggestions: GapSuggestion[];
}

export type GapCalculationResult = PillarSuggestion[];

export interface FeedbackRequest {
  pillar_name:    string;
  pillar_id?:     number;
  user_query:     string;
  suggestion:     string;
  reasoning:      string;
  gap_identified: string;
}
