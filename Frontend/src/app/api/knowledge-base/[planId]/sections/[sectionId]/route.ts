/**
 * PATCH /api/knowledge-base/[planId]/sections/[sectionId]
 * Admin-only.  Writes `content`, `structured_content`, and/or `status`.
 * `raw_extraction` is never updated — it is the frozen original.
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

interface SectionPatch {
  heading_text?: string;
  content?: string;
  structured_content?: unknown[] | null;
  status?: "auto" | "edited" | "verified";
}

export async function PATCH(
  request: Request,
  { params }: { params: { planId: string; sectionId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (session.user.role !== "Admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

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

  const body = (await request.json()) as SectionPatch;
  const allowed: (keyof SectionPatch)[] = ["heading_text", "content", "structured_content", "status"];
  const patch = Object.fromEntries(
    Object.entries(body).filter(([k]) => allowed.includes(k as keyof SectionPatch)),
  );

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "No updatable fields" }, { status: 400 });
  }

  const url =
    `${SUPABASE_URL}/rest/v1/reference_plan_sections` +
    `?section_id=eq.${params.sectionId}` +
    `&plan_id=eq.${params.planId}`;

  const res = await fetch(url, {
    method:  "PATCH",
    headers: { ...BASE_HEADERS, Prefer: "return=minimal" },
    body:    JSON.stringify(patch),
    cache:   "no-store",
  });

  if (!res.ok) {
    return NextResponse.json({ error: `DB error ${res.status}` }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
