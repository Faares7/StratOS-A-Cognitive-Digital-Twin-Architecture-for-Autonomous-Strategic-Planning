/**
 * GET /api/plan-generation/[planId]
 * Reads the generated_plans row from Supabase and returns the PlanDocument.
 * Any authenticated user may read; generation is the Admin-guarded action.
 */

import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import type { PlanDocument } from "@/types/plan-document";

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

interface GeneratedPlanRow {
  plan_id:    string;
  org_id:     string;
  language:   string;
  template_id:string;
  status:     string;
  document:   PlanDocument | null;
  created_at: string;
  updated_at: string;
}

export async function GET(
  _request: Request,
  { params }: { params: { planId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { planId } = params;

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/generated_plans`
    + `?plan_id=eq.${encodeURIComponent(planId)}`
    + `&select=*`
    + `&limit=1`,
    {
      headers: {
        apikey:        SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      cache: "no-store",
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[plan-gen] Supabase ${res.status}: ${text}`);
    return NextResponse.json({ error: "Database error" }, { status: 502 });
  }

  const rows = (await res.json()) as GeneratedPlanRow[];
  const row = rows[0];

  if (!row) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  return NextResponse.json({
    planId:   row.plan_id,
    status:   row.status,
    language: row.language,
    document: row.document,
  });
}
