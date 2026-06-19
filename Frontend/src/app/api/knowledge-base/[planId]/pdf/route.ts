/**
 * GET /api/knowledge-base/[planId]/pdf
 * Server-side proxy: fetches the PDF from private Supabase Storage using the
 * service-role key and streams it to the browser. Avoids CORS entirely — the
 * browser only talks to Next.js, never directly to Supabase Storage.
 */

import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";

export const runtime = "nodejs";

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const BUCKET       = "reference-plans";

export async function GET(
  _req: Request,
  { params }: { params: { planId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { planId } = params;
  const orgId = session.user.organizationId;

  // Verify plan belongs to this org and retrieve the storage path
  const dbRes = await fetch(
    `${SUPABASE_URL}/rest/v1/reference_plans` +
    `?plan_id=eq.${planId}&org_id=eq.${orgId}&select=source_file_path&limit=1`,
    {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      cache: "no-store",
    },
  );
  if (!dbRes.ok) return NextResponse.json({ error: "DB error" }, { status: 502 });

  const rows = (await dbRes.json()) as { source_file_path: string }[];
  if (!rows.length) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  // source_file_path is stored as "reference-plans/{orgId}/{planId}/{filename}"
  const sourcePath = rows[0].source_file_path;
  const objectPath = sourcePath.startsWith(`${BUCKET}/`)
    ? sourcePath.slice(BUCKET.length + 1)
    : sourcePath;

  const storageUrl = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${objectPath}`;

  const storageRes = await fetch(storageUrl, {
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY },
  });

  if (!storageRes.ok) {
    console.error(`[pdf-proxy] Storage fetch failed ${storageRes.status} for ${storageUrl}`);
    return NextResponse.json(
      { error: `PDF not available (storage ${storageRes.status})` },
      { status: 502 },
    );
  }

  return new Response(storageRes.body, {
    headers: {
      "Content-Type":        "application/pdf",
      "Cache-Control":       "private, max-age=3600",
      "Content-Disposition": "inline",
    },
  });
}
