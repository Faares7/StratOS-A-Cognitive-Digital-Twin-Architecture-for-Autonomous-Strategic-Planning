/**
 * POST /api/knowledge-base/upload
 * Admin-only. Accepts multipart form data with fields:
 *   file        (File, required) — PDF
 *   title       (string, optional)
 *   period_label (string, optional) — e.g. "2020-2024"
 *   version_date (string, optional) — ISO date "YYYY-MM-DD"
 *
 * Flow:
 *   1. Upload PDF to Supabase Storage bucket "reference-plans"
 *   2. Insert reference_plans row (extraction_status = 'pending')
 *   3. Trigger FastAPI background task via POST /ingest/reference-plan
 *   4. Return { plan_id }
 */

import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";

export const runtime = "nodejs";

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const FASTAPI_URL  = (process.env.FASTAPI_URL ?? "http://localhost:8000").replace(/\/$/, "");
const BUCKET       = "reference-plans";

const BASE_HEADERS = {
  apikey:         SERVICE_KEY,
  Authorization:  `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
} as const;

async function uploadToStorage(
  orgId: string,
  planId: string,
  filename: string,
  fileBytes: ArrayBuffer,
): Promise<string> {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const objectPath = `${orgId}/${planId}/${safeName}`;
  const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${objectPath}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey:         SERVICE_KEY,
      "Content-Type": "application/pdf",
      "x-upsert":     "true",
    },
    body: fileBytes,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Storage upload failed (${res.status}): ${text}`);
  }

  return `${BUCKET}/${objectPath}`;
}

async function insertPlanRow(payload: {
  plan_id:          string;
  org_id:           string;
  source_file_path: string;
  title?:           string;
  period_label?:    string;
  version_date?:    string;
}): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/reference_plans`, {
    method:  "POST",
    headers: { ...BASE_HEADERS, Prefer: "return=minimal" },
    body:    JSON.stringify({ ...payload, extraction_status: "pending" }),
    cache:   "no-store",
  });
  if (!res.ok) {
    throw new Error(`DB insert failed (${res.status}): ${await res.text().catch(() => "")}`);
  }
}

async function triggerIngestion(planId: string): Promise<void> {
  const url = `${FASTAPI_URL}/ingest/reference-plan`;
  console.log(`[upload] Triggering pipeline → POST ${url}  plan_id=${planId}`);
  try {
    const res = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ plan_id: planId }),
      signal:  AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      console.log(`[upload] Pipeline queued ✓  plan_id=${planId}`);
    } else {
      const text = await res.text().catch(() => "");
      console.error(`[upload] FastAPI returned ${res.status}: ${text}`);
    }
  } catch (err) {
    console.error(`[upload] Could not reach FastAPI at ${url}:`, err);
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (session.user.role !== "Admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const orgId = session.user.organizationId;
  if (!orgId) return NextResponse.json({ error: "No organization" }, { status: 400 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "file is required" }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Only PDF files accepted" }, { status: 400 });
  }

  const title        = (formData.get("title")        as string | null) ?? "";
  const periodLabel  = (formData.get("period_label") as string | null) ?? "";
  const versionDate  = (formData.get("version_date") as string | null) ?? "";

  // Generate plan_id client-side so we can use it in the storage path
  const planId = crypto.randomUUID();

  try {
    const bytes = await file.arrayBuffer();
    const storagePath = await uploadToStorage(orgId, planId, file.name, bytes);

    await insertPlanRow({
      plan_id:          planId,
      org_id:           orgId,
      source_file_path: storagePath,
      ...(title       ? { title }                            : {}),
      ...(periodLabel ? { period_label: periodLabel }        : {}),
      ...(versionDate ? { version_date: versionDate }        : {}),
    });

    // Fire-and-forget — pipeline is idempotent, user can retry via UI
    void triggerIngestion(planId);

    return NextResponse.json({ plan_id: planId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
