// PANIC BUTTON service worker
// Strategy:
//  - Navigation requests: network-first (always try to get freshest app shell),
//    fall back to cached shell, then to offline.html if nothing cached yet.
//  - Same-origin static assets (js/css/img/font): stale-while-revalidate.
//  - Anything cross-origin (Convex API/websocket, analytics, etc.): never
//    intercepted — goes straight to the network so realtime alarms are never
//    delayed or served from cache.

const VERSION = "v1";
const STATIC_CACHE = `panic-button-static-${VERSION}`;
const SHELL_CACHE = `panic-button-shell-${VERSION}`;
const OFFLINE_URL = "/offline.html";

const PRECACHE_URLS = ["/", OFFLINE_URL];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => {
        // Best-effort precache; app still works if this fails (e.g. first
        // deploy before offline.html exists yet).
      }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE && key !== SHELL_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Let the page tell a waiting worker to activate immediately after the user
// taps "Refresh" on the update toast.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// ── Web Push: show a notification for incoming alarms even if the app is
// closed or backgrounded. Payload shape sent from convex/pushSender.ts:
// { title, body, alarmId, urgent, timestamp }
self.addEventListener("push", (event) => {
  let data = { title: "🚨 PANIC BUTTON", body: "Ada alarm darurat baru." };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // ignore malformed payloads, fall back to default text above
  }

  const options = {
    body: data.body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-96.png",
    tag: data.alarmId ? `alarm-${data.alarmId}` : "panic-button-alert",
    renotify: true,
    requireInteraction: !!data.urgent,
    vibrate: data.urgent ? [200, 100, 200, 100, 200] : [100],
    data: { url: "/", alarmId: data.alarmId, timestamp: data.timestamp },
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});

function isStaticAsset(request) {
  const dest = request.destination;
  return ["script", "style", "image", "font", "manifest"].includes(dest);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch Convex/API calls

  // Never cache Convex client bundle config or anything under /wemos (device API)
  if (url.pathname.startsWith("/wemos")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(
          async () =>
            (await caches.match("/")) ||
            (await caches.match(OFFLINE_URL)) ||
            Response.error(),
        ),
    );
    return;
  }

  if (isStaticAsset(request)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const networkFetch = fetch(request)
          .then((response) => {
            if (response && response.status === 200) {
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => cached);
        return cached || networkFetch;
      }),
    );
  }
});
