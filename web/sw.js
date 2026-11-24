// sw.js — makes Pocket Web installable and opens the app shell when offline.
// Network first, always: answers, the directory and agent files are never served stale.
// Only the page shell is kept, as a fallback for when the phone has no connection.
const SHELL = "pocket-shell-v3";
const FILES = ["./", "./index.html", "./app.css", "./app.js", "./privacy.js", "./manifest.webmanifest", "./icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== SHARED).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Android share target (manifest.webmanifest, POST): keep a shared photo for the page in a
// cache entry, never on a server, and open the app with the shared text in the address.
const SHARED = "pocket-shared";
async function receiveShare(req) {
  const form = await req.formData();
  const q = new URLSearchParams();
  for (const k of ["title", "text", "url"]) { const v = String(form.get(k) || "").slice(0, 4000); if (v) q.set(k, v); }
  const photo = form.get("photo");
  const cache = await caches.open(SHARED);
  await cache.delete("./shared-photo");
  if (photo && typeof photo !== "string" && photo.size) {
    await cache.put("./shared-photo", new Response(photo, { headers: { "content-type": photo.type || "image/jpeg" } }));
    q.set("photo", "1");
  }
  return Response.redirect(`./?${q.toString()}#ask`, 303);
}
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method === "POST" && new URL(req.url).pathname === "/share") { e.respondWith(receiveShare(req)); return; }
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin || req.mode !== "navigate") return;
  e.respondWith(fetch(req).catch(() => caches.match("./index.html")));
});
