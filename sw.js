self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith("tower-guardian-app-"))
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.registration.unregister()),
  );
});
