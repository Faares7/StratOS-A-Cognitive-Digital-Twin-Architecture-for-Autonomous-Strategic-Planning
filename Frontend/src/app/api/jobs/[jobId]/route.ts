/**
 * GET /api/jobs/[jobId]
 * Server-side proxy to FastAPI /api/jobs/{jobId}.
 * Allows the browser to poll job status without exposing the internal FastAPI port.
 */
import { NextResponse } from "next/server";

const FASTAPI_URL = (process.env.FASTAPI_URL ?? "http://localhost:8000").replace(/\/$/, "");

export async function GET(
  _request: Request,
  { params }: { params: { jobId: string } },
) {
  const { jobId } = params;
  try {
    const res = await fetch(`${FASTAPI_URL}/api/jobs/${encodeURIComponent(jobId)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `FastAPI ${res.status}` },
        { status: res.status },
      );
    }

    return NextResponse.json(await res.json());
  } catch (err) {
    console.error("[jobs proxy] error:", err);
    return NextResponse.json({ error: "Cannot reach backend" }, { status: 502 });
  }
}
