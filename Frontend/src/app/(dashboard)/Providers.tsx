"use client";

import { SessionProvider } from "next-auth/react";
import { AgentResultsProvider } from "@/contexts/AgentResultsContext";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AgentResultsProvider>{children}</AgentResultsProvider>
    </SessionProvider>
  );
}
