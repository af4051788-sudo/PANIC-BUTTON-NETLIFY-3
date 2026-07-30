import { Outlet } from "react-router-dom";
import { AppNav } from "@/components/app-nav.tsx";

/**
 * Wraps every authenticated top-level page so AppNav is always present —
 * this is the fix for "nav bar hilang setelah pindah halaman, harus balik
 * ke home dulu". Padding here reserves space so fixed nav never overlaps
 * page content: bottom padding for the mobile tab bar, left padding for
 * the desktop sidebar.
 */
export function AppLayout() {
  return (
    <>
      <div className="pb-20 md:pb-0 md:pl-20">
        <Outlet />
      </div>
      <AppNav />
    </>
  );
}
