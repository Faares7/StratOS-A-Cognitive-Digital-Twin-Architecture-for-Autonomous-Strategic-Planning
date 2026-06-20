/**
 * POST /api/knowledge-base/[planId]/trigger
 * Admin-only. Re-fires the FastAPI ingestion pipeline for a plan
 * that is stuck in 'pending' or 'extracting'. Idempotent — the pipeline
 * deletes existing sections before re-inserting.
 */

import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const FASTAPI_URL  = (process.env.FASTAPI_URL ?? "http://localhost:8000").replace(/\/$/, "");

export async function POST(
  _request: Request,
  { params }: { params: { planId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (session.user.role !== "Admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { planId } = params;
  const orgId = session.user.organizationId;

  // Verify plan belongs to this org
  const check = await fetch(
    `${SUPABASE_URL}/rest/v1/reference_plans?plan_id=eq.${planId}&org_id=eq.${orgId}&select=plan_id,extraction_status`,
    {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      cache: "no-store",
    },
  );
  const rows = (await check.json()) as { plan_id: string; extraction_status: string }[];
  if (!rows.length) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  // Reset status to pending so the UI reflects a fresh attempt
  await fetch(`${SUPABASE_URL}/rest/v1/reference_plans?plan_id=eq.${planId}`, {
    method: "PATCH",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ extraction_status: "pending" }),
  });

  // Fire pipeline
  const url = `${FASTAPI_URL}/ingest/reference-plan`;
  console.log(`[trigger] POST ${url}  plan_id=${planId}`);
  try {
    const res = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ plan_id: planId }),
      signal:  AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[trigger] FastAPI ${res.status}: ${text}`);
      return NextResponse.json(
        { error: `FastAPI returned ${res.status}: ${text}` },
        { status: 502 },
      );
    }
    console.log(`[trigger] Queued ✓  plan_id=${planId}`);
    return NextResponse.json({ status: "queued", plan_id: planId });
  } catch (err) {
    console.error(`[trigger] Cannot reach FastAPI at ${url}:`, err);
    return NextResponse.json(
      { error: `Cannot reach FastAPI at ${url}` },
      { status: 502 },
    );
  }
}
