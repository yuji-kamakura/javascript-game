"use strict";

const CACHE_NAME = "pingpong-pwa-v2";
const OFFLINE_URL = new URL("./index.html", self.location.href).href;
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./game.js",
  "./connection-experiment.mjs",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith("pingpong-pwa-") && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const requestUrl = new URL(request.url);

  if (request.method !== "GET" || requestUrl.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(request)
        .then((networkResponse) => {
          if (networkResponse.ok) {
            const responseCopy = networkResponse.clone();
            return caches.open(CACHE_NAME)
              .then((cache) => cache.put(request, responseCopy))
              .then(() => networkResponse);
          }
          return networkResponse;
        })
        .catch(() => {
          if (request.mode === "navigate") return caches.match(OFFLINE_URL);
          return Response.error();
        });
    }),
  );
});
