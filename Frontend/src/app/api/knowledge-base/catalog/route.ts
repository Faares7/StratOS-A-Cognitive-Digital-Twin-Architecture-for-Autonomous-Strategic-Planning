/**
 * GET /api/knowledge-base/catalog
 * Returns the canonical section catalog for frontend label/ordering use.
 * Proxies from the FastAPI /ingest/catalog endpoint so Python remains the
 * single source of truth.  Falls back to an inline static list on failure.
 */

import { NextResponse } from "next/server";

const FASTAPI_URL = (process.env.FASTAPI_URL ?? "http://localhost:8000").replace(/\/$/, "");

// Static fallback (mirrors section_catalog.py exactly)
const STATIC_CATALOG = [
  { canonical_key: "prep_team",                  chapter: 1, order_index:  1, has_tables: false, label: "فريق الإعداد" },
  { canonical_key: "plan_intro",                 chapter: 1, order_index:  2, has_tables: false, label: "مقدمة الخطة" },
  { canonical_key: "faculty_overview",           chapter: 2, order_index:  3, has_tables: false, label: "نبذة عن الكلية" },
  { canonical_key: "faculty_descriptive_data",   chapter: 2, order_index:  4, has_tables: true,  label: "البيانات الوصفية للكلية" },
  { canonical_key: "org_structure",              chapter: 2, order_index:  5, has_tables: false, label: "الهيكل التنظيمي" },
  { canonical_key: "financial_infrastructure",   chapter: 2, order_index:  6, has_tables: true,  label: "البنية التحتية والمالية" },
  { canonical_key: "excellence_features",        chapter: 2, order_index:  7, has_tables: false, label: "مميزات التميز" },
  { canonical_key: "planning_philosophy",        chapter: 3, order_index:  8, has_tables: false, label: "فلسفة التخطيط" },
  { canonical_key: "quality_philosophy",         chapter: 3, order_index:  9, has_tables: false, label: "فلسفة الجودة" },
  { canonical_key: "plan_methodology",           chapter: 3, order_index: 10, has_tables: false, label: "منهجية إعداد الخطة" },
  { canonical_key: "intellectual_framework",     chapter: 3, order_index: 11, has_tables: false, label: "الإطار الفكري" },
  { canonical_key: "needs_identification",       chapter: 3, order_index: 12, has_tables: false, label: "تحديد الاحتياجات" },
  { canonical_key: "plan_steps",                 chapter: 3, order_index: 13, has_tables: false, label: "خطوات إعداد الخطة" },
  { canonical_key: "risk_assessment",            chapter: 3, order_index: 14, has_tables: true,  label: "تقييم المخاطر" },
  { canonical_key: "swot_analysis",              chapter: 4, order_index: 15, has_tables: true,  label: "تحليل SWOT" },
  { canonical_key: "gap_analysis",               chapter: 4, order_index: 16, has_tables: true,  label: "تحليل الفجوة" },
  { canonical_key: "vision_mission_methodology", chapter: 5, order_index: 17, has_tables: false, label: "منهجية صياغة الرؤية والرسالة" },
  { canonical_key: "vision_mission",             chapter: 5, order_index: 18, has_tables: false, label: "الرؤية والرسالة" },
  { canonical_key: "governing_values",           chapter: 5, order_index: 19, has_tables: false, label: "القيم الحاكمة" },
  { canonical_key: "strategic_goals",            chapter: 5, order_index: 20, has_tables: false, label: "الأهداف الاستراتيجية" },
  { canonical_key: "general_policies",           chapter: 5, order_index: 21, has_tables: false, label: "السياسات العامة" },
  { canonical_key: "executive_plan",             chapter: 6, order_index: 22, has_tables: true,  label: "الخطة التنفيذية" },
];

export async function GET() {
  try {
    const res = await fetch(`${FASTAPI_URL}/ingest/catalog`, {
      signal: AbortSignal.timeout(5_000),
      cache:  "no-store",
    });
    if (res.ok) {
      const data = (await res.json()) as { catalog: typeof STATIC_CATALOG };
      return NextResponse.json(data.catalog);
    }
  } catch {
    // FastAPI down — use static fallback
  }
  return NextResponse.json(STATIC_CATALOG);
}
