
self.addEventListener('install', event => {
  self.skipWaiting();
  console.debug('[SW] skipWaiting called on install');
});
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
  console.debug('[SW] clients.claim called on activate');
});

importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.6.0/workbox-sw.js');
importScripts('idb.js');


if (workbox) {
  console.debug('[SW] Workbox loaded successfully');
  workbox.precaching.precacheAndRoute(self.__WB_MANIFEST || []);
  workbox.precaching.cleanupOutdatedCaches();
} else {
  console.debug('[SW] Workbox failed to load');
}


let apiConfig = {
  apiPath: ''
};

self.addEventListener('push', event => {
  console.debug('[SW] Push event received:', event);
  if (event.data) {
    try {

      console.debug('[SW] Raw push event data:', event.data.text());
    } catch (err) {
      console.warn('[SW] Could not read event.data.text():', err);
    }
  } else {
    console.debug('[SW] No event.data in push event');
  }
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    console.error('[SW] Error parsing push event data:', e);
    data = { title: 'Notification', body: 'You have a new message.' };
  }


  let shouldShow = true;
  try {
    const senderId = data.data && data.data.senderId;
    let currentUserId = self.currentUserId;

    if (!currentUserId && data.data && data.data.userId) {
      currentUserId = data.data.userId;
    }

    if (!currentUserId && self.clients && self.clients.matchAll) {
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
        for (const client of clients) {
          if (client.url && client.postMessage) {
            client.postMessage({ type: 'REQUEST_USER_ID' });
          }
        }
      });
    }
    if (senderId && currentUserId && senderId === currentUserId) {
      console.debug('[SW] Skipping notification for own message (senderId match)', { senderId, currentUserId, data });
      shouldShow = false;
    }

    console.debug('[SW] Notification userId check', { senderId, currentUserId, data });
  } catch (e) {

    console.warn('[SW] Could not check user id for push notification:', e);
  }

  if (shouldShow) {
    const title = data.title || 'dSpeak Notification';
    const options = {
      body: data.body || 'You have a new message.',
      icon: '/favicon-32x32.png',
      badge: '/favicon-16x16.png',
      data: data.data || {},
      tag: data.tag || 'dspeak-notification',
      requireInteraction: true,
      actions: [
        {
          action: 'open',
          title: 'Open Chat',
          icon: '/favicon-16x16.png'
        },
        {
          action: 'dismiss',
          title: 'Dismiss'
        }
      ]
    };
    event.waitUntil(self.registration.showNotification(title, options));
  }
});

self.addEventListener('notificationclick', event => {
  console.debug('[SW] Notification clicked:', event);
  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  const data = event.notification.data || {};
  let targetUrl = '/';

  if (data.roomId && data.channelId) {
    targetUrl = `/room/${data.roomId}?channel=${data.channelId}`;
  } else if (data.roomId) {
    targetUrl = `/room/${data.roomId}`;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

self.addEventListener('sync', event => {
  console.debug('[SW] Sync event triggered:', event.tag);
  if (event.tag === 'chat-sync') {
    event.waitUntil(flushChatQueue());
  }
});


self.addEventListener('message', event => {
  console.debug('[SW] Received message:', event.data);
  if (event.data && event.data.type === 'FORCE_SYNC') {
    console.debug('[SW] Force sync requested');
    flushChatQueue();
  } else if (event.data && event.data.type === 'SET_API_CONFIG') {
    apiConfig = event.data.config;
    console.debug('[SW] API config set:', apiConfig);
  } else if (event.data && event.data.type === 'PING') {
    console.debug('[SW] Ping received, sending pong');
    event.source.postMessage({
      type: 'PONG',
      originalTimestamp: event.data.timestamp,
      responseTimestamp: Date.now()
    });
  } else if (event.data && event.data.type === 'SET_USER_ID') {
    self.currentUserId = event.data.userId;
    console.debug('[SW] Set current user id:', self.currentUserId);
  }
});

async function flushChatQueue() {
  console.debug('[SW] Starting background sync...');
  console.debug('[SW] Current apiConfig:', apiConfig);

  if (!apiConfig.apiPath) {
    console.debug('[SW] No API path configured, cannot sync');
    return;
  }

  try {
    const messages = await self.getAllMessages();
    console.debug('[SW] Found', messages.length, 'queued messages');

    for (const message of messages) {
      try {
        console.debug('[SW] Sending message:', message);
        console.debug('[SW] Using URL:', `${apiConfig.apiPath}/chat/message`);

        const response = await fetch(`${apiConfig.apiPath}/chat/message`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': message.sender
          },
          body: JSON.stringify({
            channelId: message.channelId,
            content: message.content
          })
        });

        console.debug('[SW] Response status:', response.status);

        if (response.ok) {
          console.debug('[SW] Message sent successfully, removing from queue');
          await self.deleteMessage(message.id);


          const clients = await self.clients.matchAll();
          console.debug('[SW] Notifying', clients.length, 'clients');
          clients.forEach(client => {
            client.postMessage({
              type: 'BACKGROUND_SYNC_SUCCESS',
              pendingId: message.pendingId
            });
          });
        } else {
          console.debug('[SW] Failed to send message, HTTP', response.status);
          const responseText = await response.text();
          console.debug('[SW] Response text:', responseText);
          break;
        }
      } catch (e) {
        console.debug('[SW] Error sending message:', e);
        break;
      }
    }
  } catch (e) {
    console.debug('[SW] Error in flushChatQueue:', e);
  }
}
