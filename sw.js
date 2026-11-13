/* Gearizo service worker: works offline for the app shell, shows push notifications. */
const CACHE = "gearizo-v1";
const SHELL = ["./", "index.html", "app.js", "caption-ai.js", "runtime.js", "push.js", "config.js", "vendor/supabase.js",
  "cat.png", "cat-mk.png", "icons/icon-192.png", "icons/icon-512.png", "icons/badge-96.png", "manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Always try the network first so everyone gets the newest version; fall back to the cache offline.
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
  );
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Gearizo", {
    body: d.body || "New activity in the content studio",
    icon: "icons/icon-192.png",
    badge: "icons/badge-96.png",
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { url: d.url || "./" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((ws) => {
    for (const w of ws) { if ("focus" in w) { if ("navigate" in w) w.navigate(url).catch(() => {}); return w.focus(); } }
    return clients.openWindow(url);
  }));
});
