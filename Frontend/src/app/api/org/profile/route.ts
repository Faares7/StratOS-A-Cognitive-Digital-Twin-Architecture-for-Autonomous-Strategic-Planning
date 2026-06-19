import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OrgProfile {
  display_name: string;
  profiling_done: boolean;
  faculty: string | null;
  strategic_period: string | null;
  strategic_priorities: string[] | null;
  academic_programs: string[] | null;
  research_focus: string[] | null;
}

// ── Supabase helpers ──────────────────────────────────────────────────────────

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const BASE_HEADERS = {
  apikey:         SERVICE_KEY,
  Authorization:  `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
} as const;

async function fetchOrgById(orgId: string): Promise<OrgProfile | null> {
  const url = `${SUPABASE_URL}/rest/v1/organizations`
    + `?id=eq.${orgId}`
    + `&select=display_name,profiling_done,faculty,strategic_period,strategic_priorities,academic_programs,research_focus`
    + `&limit=1`;
  const res = await fetch(url, { headers: BASE_HEADERS, cache: "no-store" });
  if (!res.ok) return null;
  const rows = (await res.json()) as OrgProfile[];
  return rows[0] ?? null;
}

async function patchOrg(orgId: string, patch: Partial<OrgProfile>): Promise<void> {
  const url = `${SUPABASE_URL}/rest/v1/organizations?id=eq.${orgId}`;
  const res = await fetch(url, {
    method:  "PATCH",
    headers: { ...BASE_HEADERS, Prefer: "return=minimal" },
    body:    JSON.stringify(patch),
    cache:   "no-store",
  });
  if (!res.ok) throw new Error(`Patch failed (${res.status}): ${await res.text().catch(() => "")}`);
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const org = await fetchOrgById(session.user.organizationId);
  if (!org) return NextResponse.json({ error: "Organization not found." }, { status: 404 });

  return NextResponse.json(org);
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (session.user.role !== "Admin") {
    return NextResponse.json({ error: "Only Admins can update the organization profile." }, { status: 403 });
  }

  const body = await request.json() as Partial<OrgProfile>;

  // Only allow updating the profiling fields — not display_name or profiling_done flag
  const allowed: (keyof OrgProfile)[] = [
    "faculty",
    "strategic_period",
    "strategic_priorities",
    "academic_programs",
    "research_focus",
  ];
  const patch = Object.fromEntries(
    Object.entries(body).filter(([k]) => allowed.includes(k as keyof OrgProfile))
  );

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "No updatable fields provided." }, { status: 400 });
  }

  try {
    await patchOrg(session.user.organizationId, patch);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown" }, { status: 502 });
  }
}
