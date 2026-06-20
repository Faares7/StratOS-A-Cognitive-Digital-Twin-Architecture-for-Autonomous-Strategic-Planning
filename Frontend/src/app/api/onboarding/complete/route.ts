import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CompleteBody {
  faculty: string;
  strategicPeriod: string;
  selectedPriorities: string[];
  selectedPrograms: string[];
  selectedResearch: string[];
}

// ── Supabase REST helpers ─────────────────────────────────────────────────────

const SUPABASE_URL   = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const BASE_HEADERS   = {
  apikey:          SERVICE_KEY,
  Authorization:   `Bearer ${SERVICE_KEY}`,
  "Content-Type":  "application/json",
  Prefer:          "return=minimal",
} as const;

async function markProfilingDone(organizationId: string, data: CompleteBody) {
  const url = `${SUPABASE_URL}/rest/v1/organizations?id=eq.${organizationId}`;
  const res = await fetch(url, {
    method:  "PATCH",
    headers: BASE_HEADERS,
    body: JSON.stringify({
      profiling_done:        true,
      faculty:               data.faculty,
      strategic_period:      data.strategicPeriod,
      strategic_priorities:  data.selectedPriorities,
      academic_programs:     data.selectedPrograms,
      research_focus:        data.selectedResearch,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DB update failed (${res.status}): ${text}`);
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (session.user.role !== "Admin") {
    return NextResponse.json({ error: "Only Admins can complete onboarding." }, { status: 403 });
  }
  if (!session.user.organizationId) {
    return NextResponse.json({ error: "Organization ID missing from session." }, { status: 400 });
  }

  const body: CompleteBody = await request.json();

  if (!body.faculty?.trim() || !body.strategicPeriod?.trim()) {
    return NextResponse.json({ error: "Faculty and strategic period are required." }, { status: 400 });
  }

  try {
    await markProfilingDone(session.user.organizationId, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
