import { dequeueMessage, getQueuedMessages } from "../app/utils/idb.js";

const PRECACHE_ENTRIES = [
  ...new Map(
    (self.__WB_MANIFEST || []).map((entry) => {
      const url = typeof entry === "string" ? entry : entry.url;
      return [new URL(url, self.location.origin).href, entry];
    }),
  ).values(),
];
const PRECACHE_URLS = PRECACHE_ENTRIES.map(
  (entry) =>
    new URL(typeof entry === "string" ? entry : entry.url, self.location.origin)
      .href,
);
const PRECACHE_SIGNATURE = PRECACHE_ENTRIES.map((entry) =>
  typeof entry === "string"
    ? entry
    : `${entry.url}:${entry.revision || "versioned"}`,
).join("|");
let precacheHash = 2166136261;
for (const character of PRECACHE_SIGNATURE) {
  precacheHash ^= character.charCodeAt(0);
  precacheHash = Math.imul(precacheHash, 16777619);
}
const PRECACHE_NAME = `dspeak-precache-${(precacheHash >>> 0).toString(16)}`;
const PAGE_CACHE_NAME = `dspeak-pages-${(precacheHash >>> 0).toString(16)}`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(PRECACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((names) =>
          Promise.all(
            names
              .filter(
                (name) =>
                  (name.startsWith("dspeak-precache-") &&
                    name !== PRECACHE_NAME) ||
                  (name.startsWith("dspeak-pages-") &&
                    name !== PAGE_CACHE_NAME),
              )
              .map((name) => caches.delete(name)),
          ),
        ),
      caches.open(PRECACHE_NAME).then(async (cache) => {
        const expectedUrls = new Set(
          PRECACHE_URLS.map((url) => new URL(url, self.location.origin).href),
        );
        const requests = await cache.keys();
        await Promise.all(
          requests
            .filter((request) => !expectedUrls.has(request.url))
            .map((request) => cache.delete(request)),
        );
      }),
    ]).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method === "GET" && request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const responseToCache = response.clone();
            const cache = await caches.open(PAGE_CACHE_NAME);
            await cache.put(request, responseToCache);
          }
          return response;
        })
        .catch(async () => {
          const cachedResponse = await caches.match(request);
          if (cachedResponse) return cachedResponse;
          return new Response(
            '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>dSpeak offline</title></head><body><main><h1>You’re offline</h1><p>Reconnect to load this page. Previously opened dSpeak pages remain available offline.</p></main></body></html>',
            {
              status: 503,
              headers: { "Content-Type": "text/html; charset=utf-8" },
            },
          );
        }),
    );
    return;
  }

  if (
    request.method !== "GET" ||
    new URL(request.url).origin !== self.location.origin
  ) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      return fetch(request);
    }),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Notification", body: "You have a new message." };
  }
  const title = data.title || "dSpeak Notification";
  const options = {
    body: data.body || "You have a new message.",
    icon: "/favicon-32x32.png",
    badge: "/favicon-16x16.png",
    data: data.data || {},
    tag: data.tag || `dspeak-${Date.now()}`,
    actions: [
      {
        action: "open",
        title: "Open Chat",
        icon: "/favicon-16x16.png",
      },
      {
        action: "dismiss",
        title: "Dismiss",
      },
    ],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.action === "dismiss") {
    return;
  }

  const data = event.notification.data || {};
  let targetUrl = "/";

  if (data.roomId && data.channelId) {
    targetUrl = `/room/${data.roomId}/${data.channelId}`;
  } else if (data.roomId) {
    targetUrl = `/room/${data.roomId}`;
  }

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(targetUrl) && "focus" in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      }),
  );
});

self.addEventListener("sync", (event) => {
  if (event.tag === "chat-sync") {
    event.waitUntil(flushChatQueue());
  }
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
  } else if (event.data && event.data.type === "FORCE_SYNC") {
    event.waitUntil(flushChatQueue());
  } else if (event.data && event.data.type === "PING") {
    event.source.postMessage({
      type: "PONG",
      originalTimestamp: event.data.timestamp,
      responseTimestamp: Date.now(),
    });
  }
});

async function flushChatQueue() {
  const messages = await getQueuedMessages();
  for (const message of messages) {
    try {
      const response = await fetch("/api/chat/message", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channelId: message.channelId,
          content: message.content,
          clientMessageId: message.id,
          ownerId: message.ownerId,
        }),
      });
      if (response.ok) {
        await dequeueMessage(message.id);
        const clients = await self.clients.matchAll();
        clients.forEach((client) => {
          client.postMessage({
            type: "BACKGROUND_SYNC_SUCCESS",
            pendingId: message.pendingId,
          });
        });
        continue;
      }
      if ([400, 403, 404, 409, 422].includes(response.status)) {
        await dequeueMessage(message.id);
        const clients = await self.clients.matchAll();
        clients.forEach((client) => {
          client.postMessage({
            type: "BACKGROUND_SYNC_FAILURE",
            pendingId: message.pendingId,
            status: response.status,
          });
        });
        continue;
      }
      throw new Error(
        `Queued message delivery failed with HTTP ${response.status}`,
      );
    } catch (error) {
      throw new Error("Queued message delivery remains pending", {
        cause: error,
      });
    }
  }
}
