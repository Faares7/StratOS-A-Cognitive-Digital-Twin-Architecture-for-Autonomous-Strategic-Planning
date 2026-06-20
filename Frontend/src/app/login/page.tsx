import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import type { AccountStatus } from "@/types/next-auth";
import LoginScreen from "./LoginCard";

/**
 * /login — server-side session guard.
 *
 * Authenticated users are bounced to their correct destination before the
 * client ever renders, preventing the stale-login-card-in-history problem.
 * Unauthenticated users receive the full LoginScreen (client component).
 */
export default async function LoginPage() {
  const session = await getServerSession(authOptions);

  if (session) {
    const status = session.user.accountStatus as AccountStatus | undefined;
    if (!status || status === "pending") redirect("/pending-approval");
    redirect("/dashboard");
  }

  return <LoginScreen />;
}
