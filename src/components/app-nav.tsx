import { useNavigate, useLocation } from "react-router-dom";
import { ShieldAlert, Users, LayoutDashboard, BarChart2, User } from "lucide-react";

const NAV_ITEMS = [
  { path: "/", label: "Panic", icon: ShieldAlert },
  { path: "/community", label: "Komunitas", icon: Users },
  { path: "/admin", label: "Admin", icon: LayoutDashboard },
  { path: "/analytics", label: "Laporan", icon: BarChart2 },
  { path: "/profile", label: "Profil", icon: User },
] as const;

/**
 * Persistent navigation, always visible on every authenticated page —
 * bottom tab bar on mobile (thumb-reachable, matches OS-native app
 * conventions), left icon-rail sidebar on desktop (md breakpoint+).
 * Deliberately NOT hover-triggered/auto-hide: in an emergency-safety app,
 * navigation needs to be instantly discoverable and predictable, not
 * something the user has to remember how to summon.
 */
export function AppNav() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <>
      {/* Mobile: bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-background/90 backdrop-blur border-t border-border flex justify-around py-3 z-30">
        {NAV_ITEMS.map(({ path, label, icon: Icon }) => {
          const active = path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={`flex flex-col items-center gap-1 transition-colors cursor-pointer ${active ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Icon className="size-5" />
              <span className={`text-xs ${active ? "font-medium" : ""}`}>{label}</span>
            </button>
          );
        })}
      </nav>

      {/* Desktop: always-visible left icon rail */}
      <nav className="hidden md:flex md:flex-col md:items-center md:gap-2 md:fixed md:left-0 md:top-0 md:bottom-0 md:w-20 md:py-6 md:bg-background/90 md:backdrop-blur md:border-r md:border-border md:z-30">
        {NAV_ITEMS.map(({ path, label, icon: Icon }) => {
          const active = path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              title={label}
              className={`w-16 flex flex-col items-center gap-1 py-2.5 rounded-xl transition-colors cursor-pointer ${active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-card hover:text-foreground"}`}
            >
              <Icon className="size-5" />
              <span className="text-[10px] font-medium">{label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
