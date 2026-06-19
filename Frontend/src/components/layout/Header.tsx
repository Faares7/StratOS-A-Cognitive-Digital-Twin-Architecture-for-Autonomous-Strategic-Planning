"use client";

import React from "react";
import { Search } from "lucide-react";
import { SyncStatus } from "@/components/shared/SyncStatus";

interface HeaderProps {
  title: string;
  subtitle?: string;
}

export function Header({ title, subtitle }: HeaderProps) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-white/5 bg-[#080a16]/80 px-6 backdrop-blur-sm">
      <div>
        <h1 className="text-base font-semibold text-slate-100">{title}</h1>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-3">
        <SyncStatus />

        <button className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200">
          <Search className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
