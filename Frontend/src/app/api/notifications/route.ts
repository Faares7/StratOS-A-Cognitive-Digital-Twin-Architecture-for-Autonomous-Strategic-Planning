import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";

export interface Notification {
  id: string;
  type: string;
  title: string;
  link: string | null;
  read: boolean;
  created_at: string;
}

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const BASE_HEADERS = {
  apikey:         SERVICE_KEY,
  Authorization:  `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
} as const;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const url =
    `${SUPABASE_URL}/rest/v1/notifications` +
    `?org_id=eq.${session.user.organizationId}` +
    `&order=created_at.desc` +
    `&limit=50` +
    `&select=id,type,title,link,read,created_at`;

  const res = await fetch(url, { headers: BASE_HEADERS, cache: "no-store" });
  if (!res.ok) return NextResponse.json({ error: "DB error" }, { status: 502 });

  const rows = (await res.json()) as Notification[];
  return NextResponse.json(rows);
}

export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await request.json()) as { id: string };
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const url =
    `${SUPABASE_URL}/rest/v1/notifications` +
    `?id=eq.${body.id}` +
    `&org_id=eq.${session.user.organizationId}`;

  const res = await fetch(url, {
    method:  "PATCH",
    headers: { ...BASE_HEADERS, Prefer: "return=minimal" },
    body:    JSON.stringify({ read: true }),
    cache:   "no-store",
  });

  if (!res.ok) return NextResponse.json({ error: "Update failed" }, { status: 502 });
  return NextResponse.json({ ok: true });
}
