/**
 * POST /api/plan-generation/generate
 * Admin-only. Proxies to FastAPI /api/plan-generation/generate and returns
 * { job_id } for the frontend to poll against FastAPI /api/jobs/{id}.
 */

import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";

const FASTAPI_URL = (process.env.FASTAPI_URL ?? "http://localhost:8000").replace(/\/$/, "");

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (session.user.role !== "Admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Inject org_id from the authenticated session if not provided
  if (!body.org_id) {
    body = { ...body, org_id: session.user.organizationId ?? "unknown" };
  }

  const url = `${FASTAPI_URL}/api/plan-generation/generate`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[plan-gen] FastAPI ${res.status}: ${text}`);
      return NextResponse.json(
        { error: `FastAPI returned ${res.status}: ${text}` },
        { status: 502 },
      );
    }

    return NextResponse.json(await res.json());
  } catch (err) {
    console.error(`[plan-gen] Cannot reach FastAPI at ${url}:`, err);
    return NextResponse.json(
      { error: `Cannot reach backend at ${url}` },
      { status: 502 },
    );
  }
}
