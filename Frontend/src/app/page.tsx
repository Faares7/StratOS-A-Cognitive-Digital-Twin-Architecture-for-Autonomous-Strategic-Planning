import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import type { AccountStatus } from "@/types/next-auth";

/**
 * Root route — session-aware smart redirect.
 *
 * No session          → /login
 * session + pending   → /pending-approval
 * session + active    → /dashboard
 *
 * This runs server-side before the client ever renders anything, so there
 * is no flash of dashboard content for unauthenticated users.
 */
export default async function RootPage() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/login");
  }

  const status = session.user.accountStatus as AccountStatus | undefined;

  if (!status || status === "pending") {
    redirect("/pending-approval");
  }

  redirect("/dashboard");
}
