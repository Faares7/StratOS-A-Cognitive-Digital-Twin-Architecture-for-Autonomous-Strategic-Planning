/**
 * GET /api/knowledge-base/[planId]/sections
 * Returns all sections for a plan, ordered by order_index.
 * Admin-only is NOT enforced for reads — any authenticated user can review.
 */

import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const BASE_HEADERS = {
  apikey:         SERVICE_KEY,
  Authorization:  `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
} as const;

export interface PlanSection {
  section_id: string;
  plan_id: string;
  canonical_key: string;
  heading_text: string | null;
  chapter: number | null;
  order_index: number;
  page_start: number | null;
  page_end: number | null;
  raw_extraction: string | null;
  content: string | null;
  structured_content: StructuredRow[] | null;
  has_tables: boolean;
  status: "auto" | "edited" | "verified";
  flagged: boolean;
}

export interface StructuredRow {
  criterion: string;
  type: string;
  text: string;
}

export async function GET(
  _req: Request,
  { params }: { params: { planId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Verify plan belongs to session org
  const planCheck = await fetch(
    `${SUPABASE_URL}/rest/v1/reference_plans` +
    `?plan_id=eq.${params.planId}` +
    `&org_id=eq.${session.user.organizationId}` +
    `&select=plan_id&limit=1`,
    { headers: BASE_HEADERS, cache: "no-store" },
  );
  if (!planCheck.ok) return NextResponse.json({ error: "DB error" }, { status: 502 });
  const planRows = (await planCheck.json()) as { plan_id: string }[];
  if (!planRows.length) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  const url =
    `${SUPABASE_URL}/rest/v1/reference_plan_sections` +
    `?plan_id=eq.${params.planId}` +
    `&order=order_index.asc` +
    `&select=section_id,plan_id,canonical_key,heading_text,chapter,order_index,` +
    `page_start,page_end,raw_extraction,content,structured_content,has_tables,status,flagged`;

  const res = await fetch(url, { headers: BASE_HEADERS, cache: "no-store" });
  if (!res.ok) return NextResponse.json({ error: "DB error" }, { status: 502 });

  const rows = (await res.json()) as PlanSection[];
  return NextResponse.json(rows);
}
