"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
} from "lucide-react";
import { cn } from "@/lib/utils";

const StratOSLogo = ({ collapsed }: { collapsed: boolean }) => (
  <div className="flex items-center gap-2.5 px-3 py-2">
    {/* Red target icon — always visible */}
    <div className="flex h-8 w-8 shrink-0 items-center justify-center">
      <svg viewBox="0 0 40 40" fill="none" className="h-8 w-8">
        <circle cx="20" cy="20" r="19" stroke="#c0392b" strokeWidth="2" />
        <circle cx="20" cy="20" r="13" stroke="#c0392b" strokeWidth="2" />
        <circle cx="20" cy="20" r="7" stroke="#c0392b" strokeWidth="2" />
        <circle cx="20" cy="20" r="3" fill="#c0392b" />
        {/* Arrow */}
        <line x1="28" y1="12" x2="22" y2="18" stroke="#c0392b" strokeWidth="2.5" strokeLinecap="round" />
        <polygon points="32,8 28,12 32,16" fill="#c0392b" />
      </svg>
    </div>
    {!collapsed && (
      <span className="text-lg font-bold tracking-tight text-slate-100 transition-opacity duration-200">
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

const mainNav: NavItem[] = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Command Center" },
  { href: "/swot", icon: Target, label: "SWOT Analysis" },
  { href: "/gap-analysis", icon: BarChart3,  label: "Gap Analysis" },
  { href: "/strategy",     icon: Milestone,  label: "Strategic Goals" },
  { href: "/research", icon: GraduationCap, label: "Research Intelligence" },
  { href: "/meetings", icon: FileText, label: "Meetings" },
  { href: "/surveys", icon: ClipboardList, label: "Survey Generation" },
  { href: "/kpi-generation", icon: Gauge, label: "KPI Generation" },
];

const bottomNav: NavItem[] = [
  { href: "/settings/profile", icon: Building2, label: "Organization" },
  { href: "/settings/team", icon: Users, label: "Team" },
  { href: "/settings", icon: Settings, label: "Settings" },
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
        "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
        active
          ? "bg-cyan-500/10 text-cyan-400"
          : "text-slate-500 hover:bg-white/5 hover:text-slate-300"
      )}
    >
      <Icon
        className={cn(
          "h-4.5 w-4.5 shrink-0 transition-colors",
          active ? "text-cyan-400" : "text-slate-500 group-hover:text-slate-300"
        )}
      />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {!collapsed && active && (
        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-cyan-400" />
      )}
      {/* Tooltip for collapsed */}
      {collapsed && (
        <div className="pointer-events-none absolute left-full ml-3 z-50 hidden rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-200 shadow-lg group-hover:flex whitespace-nowrap">
          {item.label}
        </div>
      )}
    </Link>
  );
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(true);
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "relative flex h-screen flex-col border-r border-white/5 bg-[#080a16] transition-all duration-300",
        collapsed ? "w-[60px]" : "w-[220px]"
      )}
    >
      {/* Logo */}
      <div className="flex h-14 items-center border-b border-white/5">
        <StratOSLogo collapsed={collapsed} />
      </div>

      {/* Toggle button */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-16 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-[#0d1117] text-slate-400 shadow-md transition-colors hover:text-slate-200"
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3" />
        ) : (
          <ChevronLeft className="h-3 w-3" />
        )}
      </button>

      {/* Main navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-2 py-4">
        {mainNav.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            collapsed={collapsed}
            active={pathname === item.href || pathname.startsWith(item.href + "/")}
          />
        ))}
      </nav>

      {/* Divider */}
      <div className="mx-2 h-px bg-white/5" />

      {/* Bottom navigation */}
      <nav className="space-y-1 overflow-hidden px-2 py-4">
        {/* Notifications */}
        <Link
          href="/notifications"
          className="group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-500 transition-all hover:bg-white/5 hover:text-slate-300"
        >
          <div className="relative">
            <Bell className="h-4.5 w-4.5 shrink-0" />
            <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-cyan-500 text-[9px] font-bold text-slate-950">
              5
            </span>
          </div>
          {!collapsed && <span className="truncate">Notifications</span>}
          {collapsed && (
            <div className="pointer-events-none absolute left-full ml-3 z-50 hidden rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-200 shadow-lg group-hover:flex whitespace-nowrap">
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

        {/* User avatar */}
        <div
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2.5",
            !collapsed && "mt-1"
          )}
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 text-xs font-semibold text-white">
            SC
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-slate-300">Dr. Sarah Chen</p>
              <p className="truncate text-[10px] text-slate-500">Admin</p>
            </div>
          )}
        </div>
      </nav>
    </aside>
  );
}
