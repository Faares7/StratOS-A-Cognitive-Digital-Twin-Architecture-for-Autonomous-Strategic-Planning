// ── Primitives ─────────────────────────────────────────────────────────────────

export interface ActionPlanMeta {
  title:           string   // e.g. "تقييم الخطة التنفيذية"
  subtitle:        string   // e.g. "لعام 2022-2021"
  orgName:         string
  orgLogoUrl:      string | null
  partnerLogoUrls: string[]
}

// ── Row (one activity line inside an objective group) ─────────────────────────

export interface ActivityRow {
  id:         string
  activities: string   // الأنشطة التنفيذية
  indicators: string   // مؤشرات المتابعة
  completed:  string   // تم انجازه
  inProgress: string   // جاري انجازه
  reasons:    string   // أسباب عدم الإنجاز والإجراءات التصحيحية
  date:       string   // التاريخ
}

// ── Objective group (one هدف → N activity rows) ───────────────────────────────

export interface ObjectiveGroup {
  id:        string
  objective: string        // الأهداف — spans all rows in this group
  rows:      ActivityRow[]
}

// ── Section (one الغاية = one full table) ─────────────────────────────────────

export interface ActionPlanSection {
  id:         string
  goalNumber: number
  goalTitle:  string       // subtitle line of the goal
  objectives: ObjectiveGroup[]
}

// ── Top-level document ────────────────────────────────────────────────────────

export interface ActionPlanDocument {
  id:        string
  meta:      ActionPlanMeta
  sections:  ActionPlanSection[]
  language:  'ar' | 'en'
  dir:       'rtl' | 'ltr'
  createdAt: string
  updatedAt: string
}
