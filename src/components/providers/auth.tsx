// Auth is now handled by Convex Auth via ConvexAuthProvider in convex.tsx
// This file is kept as a passthrough for backwards compatibility
export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
