import { NextRequest, NextResponse } from "next/server";

const FASTAPI_URL = process.env.FASTAPI_URL ?? "http://localhost:8000";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const upstream = await fetch(`${FASTAPI_URL}/api/plan-chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      return NextResponse.json(data, { status: upstream.status });
    }
    return NextResponse.json(data);
  } catch (err) {
    console.error("[plan-chat proxy]", err);
    return NextResponse.json(
      { error: "Chat service unavailable" },
      { status: 503 }
    );
  }
}
