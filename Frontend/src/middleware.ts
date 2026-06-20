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
 */

import { withAuth, type NextRequestWithAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

export default withAuth(
  function middleware(req: NextRequestWithAuth) {
    const { pathname } = req.nextUrl;
    const token = req.nextauth.token;

    // Read values baked into the JWT by auth.ts jwt() callback.
    // Default to the most restrictive value on any decode failure.
    const accountStatus = token?.accountStatus ?? 'pending';
    const role          = token?.role           ?? 'None';
    const profilingDone = token?.profilingDone  ?? true; // default true — no accidental loops

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
