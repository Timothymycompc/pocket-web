// sw.js — makes Pocket Web installable and opens the app shell when offline.
// Network first, always: answers, the directory and agent files are never served stale.
// Only the page shell is kept, as a fallback for when the phone has no connection.
const SHELL = "pocket-shell-v1";
const FILES = ["./", "./index.html", "./app.css", "./app.js", "./manifest.webmanifest", "./icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin || req.mode !== "navigate") return;
  e.respondWith(fetch(req).catch(() => caches.match("./index.html")));
});
