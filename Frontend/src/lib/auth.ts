/**
 * NextAuth configuration — Milestone 1
 *
 * Shared between the [...nextauth] route handler and any
 * getServerSession() call (e.g. /api/forms/publish).
 *
 * Sign-in flow:
 *  1. Google OAuth completes → jwt() fires with `account` present
 *  2. Email looked up in public.users via Supabase REST (service role)
 *  3. New user → silent registration row inserted (pending / None)
 *  4. account_status + role baked into the encrypted JWT cookie
 *  5. session() lifts those values onto the Session object
 *  6. Middleware reads session.user.accountStatus to gate routing
 */

import type { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import type { AccountStatus, UserRole } from '@/types/next-auth';

// ─── Internal DB row types ────────────────────────────────────────────────────

interface StratosUser {
  id: string;
  account_status: AccountStatus;
  role: UserRole;
  organization_id: string;
  /** Embedded via PostgREST FK join — may be null if org row missing */
  organizations: { profiling_done: boolean } | null;
}

// ─── Supabase REST helpers (server-only, service-role key) ───────────────────
// Uses the REST API directly to avoid adding @supabase/supabase-js to the
// frontend bundle. All calls use the service role key — never the anon key.

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const BASE_HEADERS = {
  apikey:        SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
} as const;

/**
 * Returns the StratOS user row for `email`, or null if unknown.
 * Never throws — a DB error is treated as "user not found" to keep
 * the sign-in cycle alive; the error is surfaced to the server log.
 */
async function fetchUserByEmail(email: string): Promise<StratosUser | null> {
  try {
    const url = `${SUPABASE_URL}/rest/v1/users`
      + `?email=eq.${encodeURIComponent(email)}`
      + `&select=id,account_status,role,organization_id,organizations(profiling_done)`
      + `&limit=1`;

    const res = await fetch(url, { headers: BASE_HEADERS, cache: 'no-store' });

    if (!res.ok) {
      console.error('[StratOS Auth] fetchUserByEmail →', res.status, await res.text());
      return null;
    }

    const rows = (await res.json()) as StratosUser[];
    return rows[0] ?? null;
  } catch (err) {
    console.error('[StratOS Auth] fetchUserByEmail threw:', err);
    return null;
  }
}

/**
 * Resolves the UUID of the Nile University organization row.
 * Throws if the row is missing — callers must run migration.sql first.
 */
async function fetchNileUniversityOrgId(): Promise<string> {
  const url = `${SUPABASE_URL}/rest/v1/organizations`
    + `?slug=eq.nile-university`
    + `&select=id`
    + `&limit=1`;

  const res = await fetch(url, { headers: BASE_HEADERS, cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`[StratOS Auth] fetchNileUniversityOrgId HTTP ${res.status}`);
  }

  const rows = (await res.json()) as { id: string }[];
  if (!rows[0]?.id) {
    throw new Error('[StratOS Auth] Nile University org row missing — run migration.sql');
  }
  return rows[0].id;
}

/**
 * Inserts a pending/None user row.
 * A 409 Conflict (race condition on concurrent first-sign-ins) is silently
 * accepted — the user row already exists at that point.
 */
async function insertPendingUser(payload: {
  email:           string;
  name:            string | null;
  image:           string | null;
  organization_id: string;
}): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/users`, {
    method:  'POST',
    headers: { ...BASE_HEADERS, Prefer: 'return=minimal' },
    body:    JSON.stringify({
      ...payload,
      account_status: 'pending' satisfies AccountStatus,
      role:           'None'    satisfies UserRole,
    }),
    cache: 'no-store',
  });

  if (!res.ok && res.status !== 409) {
    throw new Error(
      `[StratOS Auth] insertPendingUser HTTP ${res.status}: ${await res.text()}`
    );
  }
}

// ─── NextAuth config ──────────────────────────────────────────────────────────

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId:     process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          // forms.body → Survey Generation; calendar.events + meetings.space.readonly → Meetings Agent
          scope: [
            'openid email profile',
            'https://www.googleapis.com/auth/forms.body',
            'https://www.googleapis.com/auth/calendar.events',
            'https://www.googleapis.com/auth/meetings.space.readonly',
          ].join(' '),
          prompt:      'consent',
          access_type: 'offline',
        },
      },
    }),
  ],

  session: { strategy: 'jwt' },

  pages: {
    signIn: '/login',
    error:  '/login', // OAuth errors redirect to /login?error=Code
  },

  callbacks: {
    /**
     * jwt() — runs on sign-in and on every session decode.
     *
     * The `account` object is ONLY present during the initial OAuth
     * handshake (first sign-in call). All DB I/O is gated behind that
     * check so subsequent session reads hit zero external services.
     *
     * When called via useSession().update(data), trigger === 'update'
     * and session carries the client-supplied payload. We use this to
     * flip profilingDone after the onboarding wizard completes without
     * forcing a full sign-out/sign-in cycle.
     */
    async jwt(params) {
      const { token, account } = params;
      // Cast to access trigger + session (added in NextAuth v4.22)
      const trigger = (params as Record<string, unknown>).trigger as string | undefined;
      const sessionData = (params as Record<string, unknown>).session as { profilingDone?: boolean } | undefined;

      // ── Session update from client (e.g. after onboarding complete) ──
      if (trigger === 'update' && typeof sessionData?.profilingDone === 'boolean') {
        token.profilingDone = sessionData.profilingDone;
        return token;
      }

      if (account?.access_token) {
        token.accessToken  = account.access_token;
        token.refreshToken = account.refresh_token ?? token.refreshToken;
        token.expiresAt    = account.expires_at; // Unix seconds from Google
      }

      if (account && token.email) {
        const existingUser = await fetchUserByEmail(token.email);

        if (!existingUser) {
          // ── Silent registration ──────────────────────────────────────
          // User passed Google OAuth (whitelisted on GCP) but is unknown
          // to our system. Create a conservative pending/None row and
          // let an Admin promote them via the team settings panel.
          try {
            const orgId = await fetchNileUniversityOrgId();
            await insertPendingUser({
              email:           token.email,
              name:            token.name  ?? null,
              image:           token.picture ?? null,
              organization_id: orgId,
            });
          } catch (err) {
            // Non-fatal: the token still carries pending/None so the
            // middleware will hold the user at /pending-approval safely.
            console.error('[StratOS Auth] Silent registration failed:', err);
          }
          token.accountStatus       = 'pending' satisfies AccountStatus;
          token.role                 = 'None'    satisfies UserRole;
          token.profilingDone        = false;
          token.profilingRefreshedAt = Date.now();
        } else {
          // ── Known user: bake current DB state into token ─────────────
          token.accountStatus        = existingUser.account_status;
          token.role                  = existingUser.role;
          token.organizationId        = existingUser.organization_id;
          token.profilingDone         = existingUser.organizations?.profiling_done ?? false;
          token.profilingRefreshedAt  = Date.now();
        }
      }

      // ── Periodic re-check of profilingDone (no re-login required) ───────────
      // Re-reads profiling_done from the DB at most once every 30 seconds so
      // manual DB changes (or onboarding completion) propagate without a
      // sign-out/sign-in cycle. The TTL keeps the middleware from hitting the
      // DB on every single request.
      const PROFILING_TTL_MS = 30_000;
      if (
        !account &&
        token.email &&
        (
          typeof token.profilingRefreshedAt !== 'number' ||
          Date.now() - token.profilingRefreshedAt > PROFILING_TTL_MS
        )
      ) {
        try {
          const freshUser = await fetchUserByEmail(token.email);
          if (freshUser) {
            token.profilingDone        = freshUser.organizations?.profiling_done ?? false;
            token.accountStatus        = freshUser.account_status;
            token.role                  = freshUser.role;
          }
        } catch (err) {
          console.error('[StratOS Auth] Periodic profiling re-check failed:', err);
        }
        token.profilingRefreshedAt = Date.now();
      }

      // ── Silent refresh: runs on every session read after first sign-in ───────
      // Refresh when the token is within 5 minutes of expiry OR when expiresAt
      // is absent (sessions that pre-date this fix never had it baked in).
      if (
        !account &&
        token.refreshToken &&
        (typeof token.expiresAt !== 'number' || Date.now() / 1000 > token.expiresAt - 300)
      ) {
        try {
          const res = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id:     process.env.GOOGLE_CLIENT_ID!,
              client_secret: process.env.GOOGLE_CLIENT_SECRET!,
              refresh_token: token.refreshToken as string,
              grant_type:    'refresh_token',
            }),
          });
          if (res.ok) {
            const refreshed = await res.json() as { access_token: string; expires_in?: number };
            token.accessToken = refreshed.access_token;
            token.expiresAt   = Math.floor(Date.now() / 1000) + (refreshed.expires_in ?? 3600);
          } else {
            console.error('[StratOS Auth] Token refresh HTTP', res.status);
          }
        } catch (err) {
          console.error('[StratOS Auth] Silent token refresh failed:', err);
        }
      }

      return token;
    },

    /**
     * session() — shapes the client-visible Session object.
     *
     * Lifts accountStatus and role from the encrypted JWT into the
     * session so useSession() and getServerSession() expose them
     * without any additional DB round-trips.
     */
    async session({ session, token }) {
      session.accessToken            = token.accessToken;
      session.refreshToken           = token.refreshToken as string | undefined;
      session.user.accountStatus     = (token.accountStatus  ?? 'pending') as AccountStatus;
      session.user.role              = (token.role            ?? 'None')    as UserRole;
      session.user.profilingDone     = (token.profilingDone   ?? false)     as boolean;
      session.user.organizationId    = (token.organizationId  ?? '')        as string;
      return session;
    },
  },
};
