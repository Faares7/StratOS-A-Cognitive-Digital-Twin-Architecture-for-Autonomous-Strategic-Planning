/**
 * Next.js Edge Middleware — Route Guard
 *
 * Execution order on every matched request:
 *  1. withAuth's `authorized` callback checks for a valid JWT.
 *     No JWT → redirect to /login.
 *  2. Main middleware routes based on account_status + role:
 *
 *     pending       → /pending-approval  (all protected routes blocked)
 *     active Admin
 *       + !profiling → /onboarding       (must complete setup first)
 *     active         → request passes through
 *
 *  /onboarding is guarded so:
 *    - non-Admin active users are bounced to /dashboard
 *    - Admins who already completed profiling are bounced to /dashboard
 *    - pending users can't reach it (no JWT for /onboarding would be
 *      possible, but the matcher keeps it safe)
 *
 * NOTE: withAuth's getToken() decodes the JWT cookie directly without
 * calling the jwt() callback from authOptions. This means profilingDone
 * in the token can be stale after a manual DB change. To avoid requiring
 * a re-login, active Admins get a live profiling_done check from Supabase
 * on every request. This is safe in the Edge Runtime and keeps routing
 * always consistent with the database.
 */

import { withAuth, type NextRequestWithAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

const SUPABASE_URL    = (process.env.NEXT_PUBLIC_SUPABASE_URL  ?? '').replace(/\/$/, '');
const SERVICE_KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY  ?? '';

/**
 * Fetches profiling_done for the user's organization directly from Supabase.
 * Used only for active Admins so the middleware always reflects the real DB
 * state without requiring a sign-out/sign-in cycle.
 * Returns true (safe default) on any network or parse error.
 */
async function fetchProfilingDone(email: string): Promise<boolean> {
  if (!SUPABASE_URL || !SERVICE_KEY) return true;
  try {
    const url =
      `${SUPABASE_URL}/rest/v1/users` +
      `?email=eq.${encodeURIComponent(email)}` +
      `&select=organizations(profiling_done)` +
      `&limit=1`;

    const res = await fetch(url, {
      headers: {
        apikey:        SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      // Edge Runtime: no Next.js cache layer — always fresh
      cache: 'no-store',
    });

    if (!res.ok) return true;

    const rows = (await res.json()) as { organizations: { profiling_done: boolean } | null }[];
    return rows[0]?.organizations?.profiling_done ?? true;
  } catch {
    return true; // fail open — don't block users on a DB hiccup
  }
}

export default withAuth(
  async function middleware(req: NextRequestWithAuth) {
    const { pathname } = req.nextUrl;
    const token = req.nextauth.token;

    // Read values baked into the JWT by auth.ts jwt() callback.
    // Default to the most restrictive value on any decode failure.
    const accountStatus = token?.accountStatus ?? 'pending';
    const role          = token?.role           ?? 'None';
    const email         = token?.email          ?? '';

    // ── Pending users: hold at the approval gate ─────────────────────
    if (accountStatus !== 'active') {
      if (pathname !== '/pending-approval') {
        return NextResponse.redirect(new URL('/pending-approval', req.url));
      }
      return NextResponse.next();
    }

    // ── Active users ─────────────────────────────────────────────────

    // Active user has no business on the pending-approval page
    if (pathname === '/pending-approval') {
      return NextResponse.redirect(new URL('/dashboard', req.url));
    }

    // For active Admins: always read profiling_done live from the DB so
    // manual resets (and onboarding completions) take effect immediately
    // without requiring a re-login.
    let profilingDone = token?.profilingDone ?? true;
    if (role === 'Admin' && email) {
      profilingDone = await fetchProfilingDone(email);
    }

    // Admin who has NOT completed onboarding → force to /onboarding
    if (role === 'Admin' && !profilingDone && pathname !== '/onboarding') {
      return NextResponse.redirect(new URL('/onboarding', req.url));
    }

    // /onboarding guards: non-admin or already-profiled admin → bounce
    if (pathname === '/onboarding') {
      if (role !== 'Admin' || profilingDone) {
        return NextResponse.redirect(new URL('/dashboard', req.url));
      }
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      // Returning false triggers a redirect to pages.signIn below.
      authorized: ({ token }) => !!token,
    },
    // withAuth reads its own pages config independently of authOptions.
    // Must be set here for the middleware redirect to hit /login.
    pages: {
      signIn: '/login',
    },
  }
);

/**
 * Matcher covers every protected route including /onboarding.
 * Truly public routes (/, /login, /api/*) are intentionally excluded.
 */
export const config = {
  matcher: [
    '/dashboard/:path*',
    '/gap-analysis/:path*',
    '/meetings/:path*',
    '/swot/:path*',
    '/research/:path*',
    '/surveys/:path*',
    '/notifications/:path*',
    '/plan-generation/:path*',
    '/settings/:path*',
    '/knowledge-base/:path*',
    '/pending-approval',
    '/onboarding',
  ],
};
