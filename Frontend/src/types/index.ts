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

// ─── HITL Gap Analysis ─────────────────────────────────────────────────────────
export interface PillarDraft {
  pillar: string;
  target_state: string;
  strengths: string;
  weaknesses: string;
  target_source?: "neo4j" | "mock";
}

export interface GapDraft {
  pillars: PillarDraft[];
  data_source: string;
}

export interface PillarSuggestion {
  pillar: string;
  suggestions: string[];
}

export type GapCalculationResult = PillarSuggestion[];
