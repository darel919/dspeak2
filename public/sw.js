// Force SW to activate and take control immediately
self.addEventListener('install', event => {
  self.skipWaiting();
  console.log('[SW] skipWaiting called on install');
});
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
  console.log('[SW] clients.claim called on activate');
});
// Import Workbox and our custom IDB functions
importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.6.0/workbox-sw.js');
importScripts('idb.js');

// Initialize Workbox
if (workbox) {
  console.log('[SW] Workbox loaded successfully');
  workbox.precaching.precacheAndRoute(self.__WB_MANIFEST || []);
  workbox.precaching.cleanupOutdatedCaches();
} else {
  console.log('[SW] Workbox failed to load');
}

// Store API configuration
let apiConfig = {
  apiPath: ''
};

self.addEventListener('push', event => {
  console.log('[SW] Push event received:', event);
  if (event.data) {
    try {
      // Log the raw text of the push event data
      console.log('[SW] Raw push event data:', event.data.text());
    } catch (err) {
      console.warn('[SW] Could not read event.data.text():', err);
    }
  } else {
    console.log('[SW] No event.data in push event');
  }
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    console.error('[SW] Error parsing push event data:', e);
    data = { title: 'Notification', body: 'You have a new message.' };
  }

  // Prevent notification for own messages (if possible)
  let shouldShow = true;
  try {
    const senderId = data.data && data.data.senderId;
    let currentUserId = self.currentUserId;
    // Try to get userId from notification data as fallback
    if (!currentUserId && data.data && data.data.userId) {
      currentUserId = data.data.userId;
    }
    // Fallback: if still not set, try to get from all open clients
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
      console.log('[SW] Skipping notification for own message (senderId match)', { senderId, currentUserId, data });
      shouldShow = false;
    }
    // Extra debug logging
    console.log('[SW] Notification userId check', { senderId, currentUserId, data });
  } catch (e) {
    // If any error, fallback to showing notification
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
  console.log('[SW] Notification clicked:', event);
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
  console.log('[SW] Sync event triggered:', event.tag);
  if (event.tag === 'chat-sync') {
    event.waitUntil(flushChatQueue());
  }
});

// Listen for messages from main thread
self.addEventListener('message', event => {
  console.log('[SW] Received message:', event.data);
  if (event.data && event.data.type === 'FORCE_SYNC') {
    console.log('[SW] Force sync requested');
    flushChatQueue();
  } else if (event.data && event.data.type === 'SET_API_CONFIG') {
    apiConfig = event.data.config;
    console.log('[SW] API config set:', apiConfig);
  } else if (event.data && event.data.type === 'PING') {
    console.log('[SW] Ping received, sending pong');
    event.source.postMessage({
      type: 'PONG',
      originalTimestamp: event.data.timestamp,
      responseTimestamp: Date.now()
    });
  } else if (event.data && event.data.type === 'SET_USER_ID') {
    self.currentUserId = event.data.userId;
    console.log('[SW] Set current user id:', self.currentUserId);
  }
});

async function flushChatQueue() {
  console.log('[SW] Starting background sync...');
  console.log('[SW] Current apiConfig:', apiConfig);
  
  if (!apiConfig.apiPath) {
    console.log('[SW] No API path configured, cannot sync');
    return;
  }
  
  try {
    const messages = await self.getAllMessages();
    console.log('[SW] Found', messages.length, 'queued messages');
    
    for (const message of messages) {
      try {
        console.log('[SW] Sending message:', message);
        console.log('[SW] Using URL:', `${apiConfig.apiPath}/chat/message`);
        
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
        
        console.log('[SW] Response status:', response.status);
        
        if (response.ok) {
          console.log('[SW] Message sent successfully, removing from queue');
          await self.deleteMessage(message.id);
          
          // Notify main thread that message was sent
          const clients = await self.clients.matchAll();
          console.log('[SW] Notifying', clients.length, 'clients');
          clients.forEach(client => {
            client.postMessage({
              type: 'BACKGROUND_SYNC_SUCCESS',
              pendingId: message.pendingId
            });
          });
        } else {
          console.log('[SW] Failed to send message, HTTP', response.status);
          const responseText = await response.text();
          console.log('[SW] Response text:', responseText);
          break;
        }
      } catch (e) {
        console.log('[SW] Error sending message:', e);
        break;
      }
    }
  } catch (e) {
    console.log('[SW] Error in flushChatQueue:', e);
  }
}
