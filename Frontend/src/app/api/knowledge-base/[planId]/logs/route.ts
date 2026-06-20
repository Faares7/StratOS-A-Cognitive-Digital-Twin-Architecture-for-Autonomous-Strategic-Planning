/**
 * GET /api/knowledge-base/[planId]/logs
 * Proxies to FastAPI /ingest/logs/{planId} and returns the in-memory pipeline log.
 * Used by the frontend progress bar while extraction_status is pending/extracting.
 */

import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const FASTAPI_URL  = (process.env.FASTAPI_URL ?? "http://localhost:8000").replace(/\/$/, "");

export async function GET(
  _request: Request,
  { params }: { params: { planId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { planId } = params;
  const orgId = session.user.organizationId;

  // Verify plan belongs to this org (prevents log-snooping across orgs)
  const check = await fetch(
    `${SUPABASE_URL}/rest/v1/reference_plans?plan_id=eq.${planId}&org_id=eq.${orgId}&select=plan_id`,
    {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      cache: "no-store",
    },
  );
  const rows = (await check.json()) as { plan_id: string }[];
  if (!rows.length) return NextResponse.json({ logs: [] });

  try {
    const res = await fetch(`${FASTAPI_URL}/ingest/logs/${planId}`, {
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    if (!res.ok) return NextResponse.json({ logs: [] });
    const data = (await res.json()) as { logs: string[] };
    return NextResponse.json(data);
  } catch {
    // FastAPI unreachable — return empty, frontend shows "Waiting for pipeline…"
    return NextResponse.json({ logs: [] });
  }
}
