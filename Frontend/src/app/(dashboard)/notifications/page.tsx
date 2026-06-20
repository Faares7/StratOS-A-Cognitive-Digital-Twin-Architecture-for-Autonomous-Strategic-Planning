"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell, Check, CheckCheck, Loader2 } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { cn } from "@/lib/utils";
import type { Notification } from "@/app/api/notifications/route";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function NotifRow({
  notif,
  onMarkRead,
}: {
  notif: Notification;
  onMarkRead: (id: string) => void;
}) {
  const [marking, setMarking] = useState(false);

  async function markRead() {
    if (notif.read || marking) return;
    setMarking(true);
    try {
      await fetch("/api/notifications", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ id: notif.id }),
      });
      onMarkRead(notif.id);
    } finally {
      setMarking(false);
    }
  }

  const Inner = (
    <div
      className={cn(
        "flex items-start gap-4 rounded-xl border px-4 py-3.5 transition-colors",
        notif.read
          ? "border-white/5 bg-[#0d1117] opacity-60"
          : "border-cyan-500/15 bg-cyan-500/3 hover:bg-cyan-500/5",
      )}
    >
      {/* Icon */}
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-500/10">
        <Bell className="h-3.5 w-3.5 text-cyan-400" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={cn("text-sm font-medium", notif.read ? "text-slate-400" : "text-slate-100")}>
          {notif.title}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-600">{timeAgo(notif.created_at)}</p>
      </div>

      {/* Mark-read button */}
      {!notif.read && (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); void markRead(); }}
          className="mt-0.5 rounded p-1 text-slate-600 hover:text-cyan-400 transition"
          title="Mark as read"
        >
          {marking ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
        </button>
      )}
    </div>
  );

  if (notif.link) {
    return (
      <Link href={notif.link} onClick={() => { void markRead(); }}>
        {Inner}
      </Link>
    );
  }
  return <div>{Inner}</div>;
}

export default function NotificationsPage() {
  const [notifs,  setNotifs]  = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNotifs(await res.json() as Notification[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function markAllRead() {
    const unread = notifs.filter((n) => !n.read);
    await Promise.all(
      unread.map((n) =>
        fetch("/api/notifications", {
          method:  "PATCH",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ id: n.id }),
        }),
      ),
    );
    setNotifs((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  const unreadCount = notifs.filter((n) => !n.read).length;

  return (
    <div className="flex min-h-full flex-col">
      <Header title="Notifications" subtitle="System alerts and plan review requests" />

      <div className="max-w-2xl p-6 space-y-4">
        {/* Toolbar */}
        {notifs.length > 0 && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
            </p>
            {unreadCount > 0 && (
              <button
                onClick={() => void markAllRead()}
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-cyan-400 transition"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all read
              </button>
            )}
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 py-10 text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        )}

        {error && (
          <p className="text-sm text-rose-400">{error}</p>
        )}

        {!loading && !error && notifs.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-slate-600">
            <Bell className="h-8 w-8" />
            <p className="text-sm">No notifications yet</p>
          </div>
        )}

        {!loading && notifs.map((n) => (
          <NotifRow
            key={n.id}
            notif={n}
            onMarkRead={(id) =>
              setNotifs((prev) => prev.map((x) => x.id === id ? { ...x, read: true } : x))
            }
          />
        ))}
      </div>
    </div>
  );
}
