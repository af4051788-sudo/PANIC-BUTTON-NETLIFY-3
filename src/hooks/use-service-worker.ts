import { useEffect, useRef } from "react";
import { toast } from "sonner";

export function useServiceWorker() {
  const toastShown = useRef(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // In dev, a service worker caches Vite's HMR token and breaks hot reload
    if (!import.meta.env.PROD) {
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
      return;
    }

    let refreshing = false;
    // When the new SW takes control, reload once so the user gets fresh assets.
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    const showUpdateToast = (registration: ServiceWorkerRegistration) => {
      if (toastShown.current) return;
      toastShown.current = true;

      toast("Versi baru tersedia!", {
        description: "Muat ulang untuk mendapatkan pembaruan terbaru.",
        duration: Infinity,
        action: {
          label: "Perbarui",
          onClick: () => registration.waiting?.postMessage("SKIP_WAITING"),
        },
      });
    };

    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        if (registration.waiting) {
          showUpdateToast(registration);
          return;
        }

        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              showUpdateToast(registration);
            }
          });
        });
      })
      .catch((err) => console.log("Service Worker registration failed:", err));
  }, []);
}
