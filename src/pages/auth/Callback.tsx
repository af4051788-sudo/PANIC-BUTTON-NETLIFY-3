// This page is no longer needed — Convex Auth does not use OIDC redirects.
// Kept as a fallback redirect to home.
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function AuthCallback() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate("/", { replace: true });
  }, [navigate]);
  return null;
}
