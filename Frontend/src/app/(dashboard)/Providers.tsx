"use client";

import { SessionProvider } from "next-auth/react";
import { AgentResultsProvider } from "@/contexts/AgentResultsContext";
import { ThemeProvider } from "@/contexts/ThemeContext";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <SessionProvider>
        <AgentResultsProvider>{children}</AgentResultsProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
