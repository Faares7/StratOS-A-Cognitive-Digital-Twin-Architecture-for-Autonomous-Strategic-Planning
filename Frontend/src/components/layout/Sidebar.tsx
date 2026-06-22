"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import {
  LayoutDashboard,
  Target,
  BarChart3,
  FileText,
  GraduationCap,
  Milestone,
  Settings,
  Bell,
  Users,
  Building2,
  ChevronRight,
  ChevronLeft,
  ClipboardList,
  Gauge,
  Sparkles,
  LogOut,
  ListChecks,
  ScanText,
} from "lucide-react";
import { cn } from "@/lib/utils";

const StratOSLogo = ({ collapsed }: { collapsed: boolean }) => (
  <div className="flex items-center gap-2.5 px-3 py-2">
    <div className="flex h-8 w-8 shrink-0 items-center justify-center">
      <svg viewBox="0 0 40 40" fill="none" className="h-8 w-8">
        <circle cx="20" cy="20" r="19" stroke="#c0392b" strokeWidth="2" />
        <circle cx="20" cy="20" r="13" stroke="#c0392b" strokeWidth="2" />
        <circle cx="20" cy="20" r="7"  stroke="#c0392b" strokeWidth="2" />
        <circle cx="20" cy="20" r="3"  fill="#c0392b" />
        <line x1="28" y1="12" x2="22" y2="18" stroke="#c0392b" strokeWidth="2.5" strokeLinecap="round" />
        <polygon points="32,8 28,12 32,16" fill="#c0392b" />
      </svg>
    </div>
    {!collapsed && (
      <span className="text-[17px] font-bold tracking-tight text-[#e0e4ef] transition-opacity duration-200">
        Strat<span className="text-red-500">OS</span>
      </span>
    )}
  </div>
);

interface NavItem {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  badge?: number;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: "Intelligence",
    items: [
      { href: "/dashboard",     icon: LayoutDashboard, label: "Command Center" },
      { href: "/swot",          icon: Target,          label: "SWOT Analysis" },
      { href: "/gap-analysis",  icon: BarChart3,       label: "Gap Analysis" },
      { href: "/strategy",      icon: Milestone,       label: "Strategic Goals" },
      { href: "/research",      icon: GraduationCap,   label: "Research Intelligence" },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/meetings",        icon: FileText,       label: "Meetings" },
      { href: "/surveys",         icon: ClipboardList,  label: "Survey Generation" },
      { href: "/plan-generation", icon: Sparkles,       label: "Plan Generation" },
      { href: "/kpi-generation",  icon: Gauge,          label: "KPI Generation" },
      { href: "/action-plan",     icon: ListChecks,     label: "Action Plan" },
      { href: "/previous-plan",   icon: ScanText,       label: "Previous Plan OCR" },
    ],
  },
];

const bottomNav: NavItem[] = [
  { href: "/settings/profile", icon: Building2, label: "Organization" },
  { href: "/settings/team",    icon: Users,     label: "Team" },
  { href: "/settings",         icon: Settings,  label: "Settings" },
];

function NavLink({
  item,
  collapsed,
  active,
}: {
  item: NavItem;
  collapsed: boolean;
  active: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-150",
        active
          ? "bg-[#171e30] text-[#b8922f]"
          : "text-[#505672] hover:bg-[#0f1422] hover:text-[#8d97b8]"
      )}
    >
      {/* Left accent bar for active state */}
      {active && (
        <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-full bg-[#b8922f]" />
      )}
      <Icon
        className={cn(
          "h-4 w-4 shrink-0 transition-colors duration-150",
          active ? "text-[#b8922f]" : "text-[#505672] group-hover:text-[#8d97b8]"
        )}
      />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {/* Tooltip for collapsed state */}
      {collapsed && (
        <div className="pointer-events-none absolute left-full ml-3 z-50 hidden rounded bg-[#171e30] border border-white/[0.09] px-2.5 py-1.5 text-xs text-[#e0e4ef] shadow-lg group-hover:flex whitespace-nowrap">
          {item.label}
        </div>
      )}
    </Link>
  );
}

function NavGroupLabel({ label, collapsed }: { label: string; collapsed: boolean }) {
  if (collapsed) return <div className="mx-2 my-1 h-px bg-white/[0.06]" />;
  return (
    <p className="mb-1 mt-4 px-3 text-[9px] font-semibold uppercase tracking-[0.1em] text-[#b8922f]/60 first:mt-0">
      {label}
    </p>
  );
}

function getInitials(name?: string | null) {
  if (!name) return "?";
  const parts = name.trim().split(" ");
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function roleBadgeClass(role?: string) {
  switch (role) {
    case "Admin":  return "bg-[#b8922f]/10 text-[#b8922f]";
    case "Editor": return "bg-violet-500/10 text-violet-400";
    case "Viewer": return "bg-[#505672]/20 text-[#8d97b8]";
    default:       return "bg-white/5 text-[#505672]";
  }
}

export function Sidebar() {
  const [collapsed,   setCollapsed]   = useState(false);
  const [menuOpen,    setMenuOpen]    = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const pathname  = usePathname();
  const { data: session, status } = useSession();
  const user      = session?.user;
  const menuRef   = useRef<HTMLDivElement>(null);

  const fetchUnread = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const rows = (await res.json()) as { read: boolean }[];
      setUnreadCount(rows.filter((r) => !r.read).length);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    void fetchUnread();
    const id = setInterval(() => { void fetchUnread(); }, 60_000);
    return () => clearInterval(id);
  }, [status, fetchUnread]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  return (
    <aside
      className={cn(
        "relative flex h-screen flex-col border-r border-white/[0.07] bg-[#070a16] transition-all duration-300",
        collapsed ? "w-[60px]" : "w-[240px]"
      )}
    >
      {/* Logo */}
      <div className="flex h-14 items-center border-b border-white/[0.07]">
        <StratOSLogo collapsed={collapsed} />
      </div>

      {/* Toggle button */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-16 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-white/[0.09] bg-[#0f1422] text-[#505672] shadow-md transition-colors duration-150 hover:text-[#e0e4ef]"
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3" />
        ) : (
          <ChevronLeft className="h-3 w-3" />
        )}
      </button>

      {/* Main navigation */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-4">
        {navGroups.map((group) => (
          <div key={group.label}>
            <NavGroupLabel label={group.label} collapsed={collapsed} />
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  collapsed={collapsed}
                  active={pathname === item.href || pathname.startsWith(item.href + "/")}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Divider */}
      <div className="mx-2 h-px bg-white/[0.06]" />

      {/* Bottom navigation */}
      <nav className="space-y-0.5 overflow-hidden px-2 py-4">
        {/* Notifications */}
        <Link
          href="/notifications"
          className="group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-[#505672] transition-all duration-150 hover:bg-[#0f1422] hover:text-[#8d97b8]"
        >
          <div className="relative">
            <Bell className="h-4 w-4 shrink-0" />
            {unreadCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#b8922f] text-[9px] font-bold text-[#070911]">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </div>
          {!collapsed && <span className="truncate">Notifications</span>}
          {collapsed && (
            <div className="pointer-events-none absolute left-full ml-3 z-50 hidden rounded bg-[#171e30] border border-white/[0.09] px-2.5 py-1.5 text-xs text-[#e0e4ef] shadow-lg group-hover:flex whitespace-nowrap">
              Notifications
            </div>
          )}
        </Link>

        {bottomNav.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            collapsed={collapsed}
            active={pathname === item.href}
          />
        ))}

        {/* User menu */}
        <div ref={menuRef} className="relative">
          {menuOpen && (
            <div
              className={cn(
                "absolute z-50 w-56 rounded-xl border border-white/[0.09] bg-[#0f1422] shadow-card",
                collapsed
                  ? "bottom-0 left-full ml-3"
                  : "bottom-full left-0 mb-2"
              )}
            >
              <div className="border-b border-white/[0.06] p-4">
                <div className="mb-2.5 flex items-center gap-3">
                  {user?.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={user.image} alt="" className="h-9 w-9 shrink-0 rounded-full" />
                  ) : (
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#b8922f]/20 text-sm font-semibold text-[#b8922f]">
                      {getInitials(user?.name)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[#e0e4ef]">
                      {user?.name ?? "—"}
                    </p>
                    <p className="truncate text-xs text-[#505672]">
                      {user?.email ?? "—"}
                    </p>
                  </div>
                </div>
                <span
                  className={cn(
                    "inline-block rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    roleBadgeClass(user?.role)
                  )}
                >
                  {user?.role ?? "None"}
                </span>
              </div>

              <div className="p-2">
                <button
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-[#505672] transition duration-150 hover:bg-rose-500/10 hover:text-rose-400"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </div>
            </div>
          )}

          <button
            onClick={() => setMenuOpen((v) => !v)}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150 hover:bg-[#0f1422]",
              !collapsed && "mt-1",
              menuOpen && "bg-[#0f1422]"
            )}
          >
            {user?.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.image} alt="" className="h-7 w-7 shrink-0 rounded-full" />
            ) : (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#b8922f]/20 text-xs font-semibold text-[#b8922f]">
                {getInitials(user?.name)}
              </div>
            )}
            {!collapsed && (
              <div className="min-w-0 flex-1 text-left">
                <p className="truncate text-xs font-medium text-[#8d97b8]">
                  {user?.name ?? "—"}
                </p>
                <p className="truncate text-[10px] text-[#505672]">
                  {user?.role ?? "None"}
                </p>
              </div>
            )}
          </button>
        </div>
      </nav>
    </aside>
  );
}
