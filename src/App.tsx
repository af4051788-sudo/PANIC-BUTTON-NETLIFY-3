import { BrowserRouter, Route, Routes } from "react-router-dom";
import { useServiceWorker } from "@/hooks/use-service-worker";
import { AlarmProvider } from "@/hooks/use-alarm-context";
import { ErrorBoundary } from "@/components/error-boundary.tsx";
import { AppLayout } from "@/components/app-layout.tsx";
import { DefaultProviders } from "./components/providers/default.tsx";
import { Authenticated, Unauthenticated, AuthLoading } from "convex/react";
import Index from "./pages/Index.tsx";
import ProfilePage from "./pages/profile/page.tsx";
import DevicesPage from "./pages/devices/page.tsx";
import AdminPage from "./pages/admin/page.tsx";
import CommunityPage from "./pages/community/page.tsx";
import AnalyticsPage from "./pages/analytics/page.tsx";
import FirmwarePage from "./pages/firmware/page.tsx";
import NotFound from "./pages/NotFound.tsx";

function AuthenticatedApp() {
  return (
    <AlarmProvider>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Index />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/community" element={<CommunityPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/firmware" element={<FirmwarePage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </AlarmProvider>
  );
}

function UnauthenticatedApp() {
  return (
    <Routes>
      <Route path="*" element={<Index />} />
    </Routes>
  );
}

export default function App() {
  useServiceWorker();
  return (
    <div className="dark">
      <ErrorBoundary>
        <DefaultProviders>
          <BrowserRouter>
            <AuthLoading>
              <Routes>
                <Route path="*" element={<Index />} />
              </Routes>
            </AuthLoading>
            <Authenticated>
              <AuthenticatedApp />
            </Authenticated>
            <Unauthenticated>
              <UnauthenticatedApp />
            </Unauthenticated>
          </BrowserRouter>
        </DefaultProviders>
      </ErrorBoundary>
    </div>
  );
}
