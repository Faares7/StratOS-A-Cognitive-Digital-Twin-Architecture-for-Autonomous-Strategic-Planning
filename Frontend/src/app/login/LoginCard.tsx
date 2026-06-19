"use client";

// force-dynamic is required so useSearchParams() can read the ?error= param
// that NextAuth appends when an OAuth failure occurs.
export const dynamic = "force-dynamic";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

// ─── Error code → human message map ──────────────────────────────────────────

const AUTH_ERRORS: Record<string, string> = {
  OAuthSignin:
    "Could not start the Google sign-in process. Please try again.",
  OAuthCallback:
    "Google returned an error during sign-in. Please try again.",
  OAuthCreateAccount:
    "Your account could not be created. Please contact your administrator.",
  OAuthAccountNotLinked:
    "This email is already linked to a different sign-in method.",
  AccessDenied:
    "Access was denied. Please use your authorised Nile University Google account.",
  Callback:
    "An error occurred in the authentication callback. Please try again.",
  Default:
    "An unexpected authentication error occurred. Please try again.",
};

function resolveError(code: string | null): string | null {
  if (!code) return null;
  return AUTH_ERRORS[code] ?? AUTH_ERRORS.Default;
}

// ─── Google wordmark SVG ──────────────────────────────────────────────────────

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden>
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

// ─── StratOS target logo (mirrors Sidebar) ───────────────────────────────────

function StratOSLogo() {
  return (
    <div className="flex flex-col items-center gap-3">
      <svg viewBox="0 0 40 40" fill="none" className="h-12 w-12" aria-hidden>
        <circle cx="20" cy="20" r="19" stroke="#c0392b" strokeWidth="2" />
        <circle cx="20" cy="20" r="13" stroke="#c0392b" strokeWidth="2" />
        <circle cx="20" cy="20" r="7"  stroke="#c0392b" strokeWidth="2" />
        <circle cx="20" cy="20" r="3"  fill="#c0392b" />
        <line
          x1="28" y1="12" x2="22" y2="18"
          stroke="#c0392b" strokeWidth="2.5" strokeLinecap="round"
        />
        <polygon points="32,8 28,12 32,16" fill="#c0392b" />
      </svg>
      <div className="text-center">
        <p className="text-2xl font-bold tracking-tight text-slate-100">
          Strat<span className="text-red-500">OS</span>
        </p>
        <p className="mt-0.5 text-xs font-medium tracking-widest text-slate-500 uppercase">
          Nile University · ITCS
        </p>
      </div>
    </div>
  );
}

// ─── Inner component — uses useSearchParams ───────────────────────────────────

function LoginCard() {
  const searchParams   = useSearchParams();
  const errorCode      = searchParams.get("error");
  const errorMessage   = resolveError(errorCode);

  const [loading, setLoading] = useState(false);

  // Clear the ?error= param from the URL bar after display so a page refresh
  // doesn't re-surface a stale error message.
  useEffect(() => {
    if (errorCode) {
      const clean = new URL(window.location.href);
      clean.searchParams.delete("error");
      window.history.replaceState({}, "", clean.toString());
    }
  }, [errorCode]);

  async function handleSignIn() {
    if (loading) return;
    setLoading(true);
    // callbackUrl targets /dashboard; middleware will intercept pending users
    // and redirect them to /pending-approval before they ever see it.
    await signIn("google", { callbackUrl: "/dashboard" });
    // signIn() triggers a full-page redirect — setLoading back to false only
    // runs if the redirect somehow doesn't happen (e.g. popup blocker).
    setLoading(false);
  }

  return (
    <div className="w-full max-w-sm">
      {/* Logo */}
      <div className="mb-8 flex justify-center">
        <StratOSLogo />
      </div>

      {/* Card */}
      <div className="rounded-2xl border border-white/[0.06] bg-[#0d1117] px-8 py-8 shadow-2xl">
        {/* Heading */}
        <div className="mb-6 text-center">
          <h1 className="text-base font-semibold text-slate-100">
            Sign in to your workspace
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">
            Use your authorised Nile University Google account to continue.
          </p>
        </div>

        {/* Error callout */}
        {errorMessage && (
          <div
            role="alert"
            className="mb-5 flex items-start gap-2.5 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3"
          >
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              className="mt-px h-4 w-4 shrink-0 text-red-400"
              aria-hidden
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm-.75-9.75a.75.75 0 011.5 0v3a.75.75 0 01-1.5 0v-3zm.75 6a.75.75 0 100-1.5.75.75 0 000 1.5z"
                clipRule="evenodd"
              />
            </svg>
            <p className="text-xs leading-relaxed text-red-300">{errorMessage}</p>
          </div>
        )}

        {/* Google sign-in button */}
        <button
          onClick={handleSignIn}
          disabled={loading}
          aria-busy={loading}
          className="flex w-full items-center justify-center gap-3 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-sm transition-all hover:bg-slate-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? (
            <svg
              className="h-4 w-4 animate-spin text-slate-500"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <circle
                className="opacity-25"
                cx="12" cy="12" r="10"
                stroke="currentColor" strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          ) : (
            <GoogleIcon />
          )}
          {loading ? "Redirecting…" : "Continue with Google"}
        </button>

        {/* Divider */}
        <div className="my-6 h-px bg-white/[0.06]" />

        {/* Access restriction note */}
        <p className="text-center text-xs leading-relaxed text-slate-600">
          Access is restricted to authorised Nile University accounts.
          If you believe you should have access, contact your ITCS administrator.
        </p>
      </div>

      {/* Footer wordmark */}
      <p className="mt-8 text-center text-xs text-slate-700">
        Strat<span className="text-red-800">OS</span> · Cognitive Digital Twin ·{" "}
        {new Date().getFullYear()}
      </p>
    </div>
  );
}

// ─── Screen wrapper — rendered by the server page when no session exists ──────
// Wrapped in Suspense so Next.js can suspend on useSearchParams during SSR
// while dynamic = "force-dynamic" ensures no stale static render is served.

export default function LoginScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#080a14] px-4 py-16">
      <Suspense fallback={null}>
        <LoginCard />
      </Suspense>
    </main>
  );
}
