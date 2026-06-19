/**
 * GET /api/knowledge-base/[planId]
 * Returns the plan row + a short-lived signed URL for the PDF (60 min).
 * Used by the review page to feed the PDF viewer.
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
const BUCKET = "reference-plans";

async function fetchPlan(planId: string, orgId: string) {
  const url =
    `${SUPABASE_URL}/rest/v1/reference_plans` +
    `?plan_id=eq.${planId}` +
    `&org_id=eq.${orgId}` +
    `&select=plan_id,org_id,title,period_label,version_date,source_file_path,uploaded_at,extraction_status` +
    `&limit=1`;
  const res = await fetch(url, { headers: BASE_HEADERS, cache: "no-store" });
  if (!res.ok) return null;
  const rows = (await res.json()) as Record<string, string>[];
  return rows[0] ?? null;
}

async function getSignedUrl(sourcePath: string): Promise<string | null> {
  let objectPath = sourcePath.replace(/^reference-plans\//, "");
  const url = `${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${objectPath}`;
  try {
    const res = await fetch(url, {
      method:  "POST",
      headers: BASE_HEADERS,
      body:    JSON.stringify({ expiresIn: 3600 }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { signedURL?: string };
    const signed = data.signedURL ?? "";
    if (!signed) return null;
    // Supabase returns a relative path — prefix with the base URL
    return signed.startsWith("http")
      ? signed
      : `${SUPABASE_URL}${signed}`;
  } catch {
    return null;
  }
}

export async function GET(
  _req: Request,
  { params }: { params: { planId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const plan = await fetchPlan(params.planId, session.user.organizationId);
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  const signedUrl = await getSignedUrl(plan.source_file_path);
  return NextResponse.json({ ...plan, signed_url: signedUrl });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { planId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (session.user.role !== "Admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const plan = await fetchPlan(params.planId, session.user.organizationId);
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  // Delete PDF from storage
  const objectPath = plan.source_file_path.replace(/^reference-plans\//, "");
  await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${objectPath}`,
    { method: "DELETE", headers: BASE_HEADERS },
  );

  // Delete plan row (sections cascade via FK ON DELETE CASCADE)
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/reference_plans?plan_id=eq.${params.planId}`,
    { method: "DELETE", headers: { ...BASE_HEADERS, Prefer: "return=minimal" }, cache: "no-store" },
  );
  if (!res.ok) return NextResponse.json({ error: "DB delete failed" }, { status: 502 });

  return NextResponse.json({ ok: true });
}
