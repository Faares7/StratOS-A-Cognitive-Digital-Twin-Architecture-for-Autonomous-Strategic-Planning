"use client";

import { useSession, signOut } from "next-auth/react";
import { LogOut, Clock, CheckCircle2, Circle } from "lucide-react";

// ─── Progress step indicator ──────────────────────────────────────────────────

type StepStatus = "done" | "active" | "waiting";

function Step({
  label,
  sublabel,
  status,
}: {
  label: string;
  sublabel: string;
  status: StepStatus;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex flex-col items-center gap-1 pt-0.5">
        {status === "done" ? (
          <CheckCircle2 className="h-5 w-5 shrink-0 text-cyan-400" />
        ) : status === "active" ? (
          <div className="relative h-5 w-5 shrink-0">
            <span className="absolute inset-0 animate-ping rounded-full bg-cyan-500 opacity-30" />
            <span className="relative flex h-5 w-5 items-center justify-center rounded-full border-2 border-cyan-500">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
            </span>
          </div>
        ) : (
          <Circle className="h-5 w-5 shrink-0 text-slate-700" />
        )}
        {/* Connector line — hidden for last item */}
        <div className="h-8 w-px bg-white/5" />
      </div>
      <div className="pb-6">
        <p
          className={
            status === "waiting"
              ? "text-sm font-medium text-slate-600"
              : "text-sm font-medium text-slate-200"
          }
        >
          {label}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">{sublabel}</p>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PendingApprovalPage() {
  const { data: session } = useSession();

  const displayName = session?.user?.name ?? "there";
  const email = session?.user?.email ?? "";
  const avatarInitials = displayName
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center bg-[#080a14] px-6 py-16">
      {/* ── Card ──────────────────────────────────────────────── */}
      <div className="w-full max-w-md rounded-2xl border border-white/[0.06] bg-[#0d1117] p-8 shadow-2xl">

        {/* Header */}
        <div className="mb-8 flex flex-col items-center text-center">
          {/* Pulsing clock badge */}
          <div className="glow-cyan mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-500/20 bg-cyan-500/10">
            <Clock className="h-8 w-8 text-cyan-400" />
          </div>

          <h1 className="text-xl font-bold tracking-tight text-slate-100">
            Access Request Pending
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            Your account has been registered. A StratOS administrator
            will review and activate it shortly.
          </p>
        </div>

        {/* User identity pill */}
        {session?.user && (
          <div className="mb-8 flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 text-xs font-bold text-white">
              {avatarInitials}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-200">
                {displayName}
              </p>
              <p className="truncate text-xs text-slate-500">{email}</p>
            </div>
            <span className="ml-auto shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
              Pending
            </span>
          </div>
        )}

        {/* Progress steps */}
        <div className="mb-8">
          <Step
            label="Access request submitted"
            sublabel="Your Google account has been registered in StratOS"
            status="done"
          />
          <Step
            label="Under admin review"
            sublabel="An administrator will assign your role and activate your account"
            status="active"
          />
          <Step
            label="Access granted"
            sublabel="You'll be able to sign in and reach the dashboard"
            status="waiting"
          />
        </div>

        {/* Divider */}
        <div className="mb-6 h-px bg-white/[0.06]" />

        {/* Info callout */}
        <p className="mb-6 text-center text-xs leading-relaxed text-slate-500">
          Once approved, simply sign in again with the same Google account —
          your session will reflect the updated access level immediately.
        </p>

        {/* Sign out */}
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-slate-400 transition-colors hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-slate-200"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>

      {/* Footer wordmark */}
      <p className="mt-8 text-xs text-slate-700">
        Strat<span className="text-red-700">OS</span> · Nile University
      </p>
    </div>
  );
}
