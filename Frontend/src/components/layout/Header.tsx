"use client";

import React from "react";
import { Search, Sun, Moon } from "lucide-react";
import { SyncStatus } from "@/components/shared/SyncStatus";
import { useTheme } from "@/contexts/ThemeContext";

interface HeaderProps {
  title: string;
  subtitle?: string;
}

export function Header({ title, subtitle }: HeaderProps) {
  const { theme, toggle } = useTheme();

  return (
    <header className="flex h-14 items-center justify-between border-b border-white/[0.07] bg-[#070911]/90 px-6 backdrop-blur-md">
      <div>
        <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-[#e0e4ef]">{title}</h1>
        {subtitle && <p className="text-[11px] text-[#505672]">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-2">
        <SyncStatus />

        <button
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[#505672] transition-colors duration-150 hover:bg-white/[0.05] hover:text-[#8d97b8]"
          aria-label="Search"
        >
          <Search className="h-4 w-4" />
        </button>

        <button
          onClick={toggle}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[#505672] transition-colors duration-150 hover:bg-white/[0.05] hover:text-[#b8922f]"
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </button>
      </div>
    </header>
  );
}
