"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  CheckCircle2,
  Clock,
  ShieldOff,
  RefreshCw,
  Users,
  UserCheck,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type AccountStatus = "pending" | "active";
type UserRole = "Admin" | "Editor" | "Viewer" | "None";

interface DbUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  account_status: AccountStatus;
  role: UserRole;
  created_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string | null, email: string): string {
  if (name) {
    return name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const ROLE_BADGE: Record<UserRole, string> = {
  Admin:  "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
  Editor: "text-violet-400 bg-violet-500/10 border-violet-500/20",
  Viewer: "text-slate-400 bg-slate-500/10 border-slate-500/20",
  None:   "text-slate-600 bg-slate-800 border-slate-700",
};

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ name, email }: { name: string | null; email: string }) {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-600 to-blue-700 text-xs font-semibold text-white">
      {getInitials(name, email)}
    </div>
  );
}

// ─── Pending row ──────────────────────────────────────────────────────────────

function PendingRow({
  user,
  onApprove,
  busy,
}: {
  user: DbUser;
  onApprove: (id: string, role: UserRole) => Promise<void>;
  busy: boolean;
}) {
  const [role, setRole] = useState<UserRole>("Viewer");

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <Avatar name={user.name} email={user.email} />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-200">
          {user.name ?? user.email}
        </p>
        <p className="truncate text-xs text-slate-500">
          {user.name ? user.email : ""}
          <span className="ml-1.5 text-slate-600">
            · Requested {timeAgo(user.created_at)}
          </span>
        </p>
      </div>

      {/* Role picker + approve */}
      <div className="flex shrink-0 items-center gap-2">
        <Select value={role} onValueChange={(v) => setRole(v as UserRole)} disabled={busy}>
          <SelectTrigger className="h-8 w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Viewer">Viewer</SelectItem>
            <SelectItem value="Editor">Editor</SelectItem>
            <SelectItem value="Admin">Admin</SelectItem>
          </SelectContent>
        </Select>

        <button
          onClick={() => onApprove(user.id, role)}
          disabled={busy}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-cyan-500/10 px-3 text-xs font-semibold text-cyan-400 transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50 border border-cyan-500/20"
        >
          {busy ? (
            <RefreshCw className="h-3 w-3 animate-spin" />
          ) : (
            <CheckCircle2 className="h-3 w-3" />
          )}
          Approve
        </button>
      </div>
    </div>
  );
}

// ─── Active row ───────────────────────────────────────────────────────────────

function ActiveRow({
  user,
  isAdmin,
  isSelf,
  onRoleChange,
  onDeactivate,
  busy,
}: {
  user: DbUser;
  isAdmin: boolean;
  isSelf: boolean;
  onRoleChange: (id: string, role: UserRole) => Promise<void>;
  onDeactivate: (id: string) => Promise<void>;
  busy: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Avatar name={user.name} email={user.email} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-slate-200">
            {user.name ?? user.email}
          </p>
          {isSelf && (
            <span className="rounded-full bg-white/5 px-1.5 py-px text-[10px] text-slate-500">
              you
            </span>
          )}
        </div>
        <p className="truncate text-xs text-slate-500">{user.name ? user.email : ""}</p>
      </div>

      {/* Role badge / selector */}
      {isAdmin && !isSelf ? (
        <Select
          value={user.role}
          onValueChange={(v) => onRoleChange(user.id, v as UserRole)}
          disabled={busy}
        >
          <SelectTrigger className={cn("h-8 w-28 text-xs", ROLE_BADGE[user.role])}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Admin">Admin</SelectItem>
            <SelectItem value="Editor">Editor</SelectItem>
            <SelectItem value="Viewer">Viewer</SelectItem>
          </SelectContent>
        </Select>
      ) : (
        <span
          className={cn(
            "shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium",
            ROLE_BADGE[user.role]
          )}
        >
          {user.role}
        </span>
      )}

      {/* Deactivate — not available on self or other admins */}
      {isAdmin && !isSelf && user.role !== "Admin" && (
        <button
          onClick={() => onDeactivate(user.id)}
          disabled={busy}
          title="Revoke access"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-rose-500/10 hover:text-rose-400 disabled:pointer-events-none disabled:opacity-30"
        >
          <ShieldOff className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({
  title,
  count,
  accent,
  children,
}: {
  title: string;
  count: number;
  accent?: "amber" | "default";
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-300">{title}</h2>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-semibold",
            accent === "amber"
              ? "bg-amber-500/15 text-amber-400"
              : "bg-white/5 text-slate-500"
          )}
        >
          {count}
        </span>
      </div>
      <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-[#0d1117] divide-y divide-white/[0.04]">
        {children}
      </div>
    </div>
  );
}

function EmptyRow({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <Icon className="h-6 w-6 text-slate-700" />
      <p className="text-xs text-slate-600">{message}</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TeamPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "Admin";
  const selfEmail = session?.user?.email ?? "";

  const [users, setUsers]     = useState<DbUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [busyId, setBusyId]   = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users");
      if (res.status === 403) {
        setError("Only Admins can manage team members.");
        return;
      }
      if (!res.ok) throw new Error("fetch failed");
      setUsers(await res.json());
    } catch {
      setError("Could not load team members. Please refresh.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  // Approve a pending user: set status → active, assign role
  async function handleApprove(id: string, role: UserRole) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ account_status: "active", role }),
      });
      if (!res.ok) throw new Error();
      await loadUsers();
    } catch {
      setError("Failed to approve user. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  // Change role of an active user
  async function handleRoleChange(id: string, role: UserRole) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ role }),
      });
      if (!res.ok) throw new Error();
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role } : u)));
    } catch {
      setError("Failed to update role. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  // Revoke access: set status back to pending, role to None
  async function handleDeactivate(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ account_status: "pending", role: "None" }),
      });
      if (!res.ok) throw new Error();
      await loadUsers();
    } catch {
      setError("Failed to revoke access. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  const pending = users.filter((u) => u.account_status === "pending");
  const active  = users.filter((u) => u.account_status === "active");

  return (
    <div className="flex min-h-full flex-col">
      <Header
        title="Team Members"
        subtitle="Manage workspace access for Nile University ITCS"
      />

      <div className="flex flex-col gap-6 p-6">
        {/* Error banner */}
        {error && (
          <div className="flex items-center gap-2.5 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            <span className="font-medium">Error:</span> {error}
            <button
              onClick={() => setError(null)}
              className="ml-auto text-red-400 hover:text-red-200"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}

        {/* ── Pending access requests ───────────────────────────── */}
        {isAdmin && (
          <Section
            title="Access Requests"
            count={pending.length}
            accent="amber"
          >
            {loading ? (
              Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="skeleton mx-4 my-3 h-11 rounded-lg" />
              ))
            ) : pending.length === 0 ? (
              <EmptyRow icon={UserCheck} message="No pending access requests" />
            ) : (
              pending.map((u) => (
                <PendingRow
                  key={u.id}
                  user={u}
                  onApprove={handleApprove}
                  busy={busyId === u.id}
                />
              ))
            )}
          </Section>
        )}

        {/* ── Active members ────────────────────────────────────── */}
        <Section title="Active Members" count={active.length}>
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="skeleton mx-4 my-3 h-11 rounded-lg" />
            ))
          ) : active.length === 0 ? (
            <EmptyRow icon={Users} message="No active members yet" />
          ) : (
            active.map((u) => (
              <ActiveRow
                key={u.id}
                user={u}
                isAdmin={isAdmin}
                isSelf={u.email === selfEmail}
                onRoleChange={handleRoleChange}
                onDeactivate={handleDeactivate}
                busy={busyId === u.id}
              />
            ))
          )}
        </Section>

        {/* Non-admin read note */}
        {!isAdmin && !loading && (
          <p className="flex items-center gap-1.5 text-xs text-slate-600">
            <Clock className="h-3.5 w-3.5" />
            Role management is restricted to Admins.
          </p>
        )}
      </div>
    </div>
  );
}
