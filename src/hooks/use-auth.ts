import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";

export function useAuth() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn, signOut } = useAuthActions();

  return {
    isAuthenticated,
    isLoading,
    signin: () => signIn("password"),
    signout: () => signOut(),
  };
}

// Re-export for convenience
export { useConvexAuth as useUser };
