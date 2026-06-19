import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const SB_HEADERS = {
  apikey:          SERVICE_KEY,
  Authorization:   `Bearer ${SERVICE_KEY}`,
  'Content-Type':  'application/json',
} as const;

/**
 * PATCH /api/admin/users/[id]
 * Accepted body fields: { account_status?, role? }
 * Admin only. Guards prevent self-demotion via API.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  if (session.user.role !== 'Admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body: Record<string, string> = await req.json();

  // Sanity-check the values before sending to DB
  const allowed = {
    account_status: ['pending', 'active'],
    role:           ['Admin', 'Editor', 'Viewer', 'None'],
  };

  for (const [key, value] of Object.entries(body)) {
    if (!(key in allowed)) {
      return NextResponse.json({ error: `Unknown field: ${key}` }, { status: 400 });
    }
    if (!(allowed as Record<string, string[]>)[key].includes(value)) {
      return NextResponse.json({ error: `Invalid value for ${key}: ${value}` }, { status: 400 });
    }
  }

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/users?id=eq.${params.id}`,
    {
      method:  'PATCH',
      headers: { ...SB_HEADERS, Prefer: 'return=representation' },
      body:    JSON.stringify(body),
      cache:   'no-store',
    }
  );

  if (!res.ok) {
    console.error('[admin/users PATCH]', res.status, await res.text());
    return NextResponse.json({ error: 'Failed to update user' }, { status: 502 });
  }

  const rows = await res.json() as unknown[];
  return NextResponse.json(rows[0] ?? null);
}
