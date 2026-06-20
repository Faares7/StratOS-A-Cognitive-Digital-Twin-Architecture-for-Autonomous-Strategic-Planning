import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const SB_HEADERS = {
  apikey:        SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
} as const;

/** GET /api/admin/users — returns all users ordered by created_at desc. Admin only. */
export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  if (session.user.role !== 'Admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/users`
      + `?select=id,email,name,image,account_status,role,created_at`
      + `&order=created_at.desc`,
    { headers: SB_HEADERS, cache: 'no-store' }
  );

  if (!res.ok) {
    console.error('[admin/users GET]', res.status, await res.text());
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 502 });
  }

  return NextResponse.json(await res.json());
}
