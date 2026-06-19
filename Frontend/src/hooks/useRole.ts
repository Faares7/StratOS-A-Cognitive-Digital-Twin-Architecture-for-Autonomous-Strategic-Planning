import { useSession } from "next-auth/react";
import type { UserRole } from "@/types/next-auth";

export function useRole() {
  const { data: session } = useSession();
  const role = (session?.user?.role ?? "None") as UserRole;
  return {
    role,
    isAdmin:    role === "Admin",
    isEditor:   role === "Editor",
    isViewer:   role === "Viewer",
    canMutate:  role === "Admin" || role === "Editor",
  };
}
