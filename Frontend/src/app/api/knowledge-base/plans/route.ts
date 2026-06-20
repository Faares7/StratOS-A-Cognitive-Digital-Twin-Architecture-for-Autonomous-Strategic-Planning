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

export interface ReferencePlan {
  plan_id: string;
  org_id: string;
  title: string | null;
  period_label: string | null;
  version_date: string | null;
  source_file_path: string;
  uploaded_at: string;
  extraction_status: "pending" | "extracting" | "ready" | "failed";
  /** Computed from sections: auto | edited | verified | needs_review */
  computed_status?: string;
  section_counts?: { auto: number; edited: number; verified: number };
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Fetch plans for this org, including nested section status counts via PostgREST
  const url =
    `${SUPABASE_URL}/rest/v1/reference_plans` +
    `?org_id=eq.${session.user.organizationId}` +
    `&order=uploaded_at.desc` +
    `&select=plan_id,org_id,title,period_label,version_date,source_file_path,uploaded_at,extraction_status,` +
    `reference_plan_sections(status)`;

  const res = await fetch(url, { headers: BASE_HEADERS, cache: "no-store" });
  if (!res.ok) return NextResponse.json({ error: "DB error" }, { status: 502 });

  const rows = (await res.json()) as (ReferencePlan & {
    reference_plan_sections?: { status: string }[];
  })[];

  const plans: ReferencePlan[] = rows.map((row) => {
    const sections = row.reference_plan_sections ?? [];
    const counts = { auto: 0, edited: 0, verified: 0 };
    for (const s of sections) {
      if (s.status === "auto") counts.auto++;
      else if (s.status === "edited") counts.edited++;
      else if (s.status === "verified") counts.verified++;
    }
    let computed_status = "needs_review";
    if (sections.length > 0) {
      if (counts.auto === 0 && counts.edited === 0) computed_status = "verified";
      else if (counts.auto === 0) computed_status = "edited";
      else computed_status = "needs_review";
    }
    const { reference_plan_sections: _omit, ...rest } = row;
    return { ...rest, computed_status, section_counts: counts };
  });

  return NextResponse.json(plans);
}
