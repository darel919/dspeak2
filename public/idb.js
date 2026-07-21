// idb.js - Simple IndexedDB wrapper for message queue (Service Worker compatible)
const DB_NAME = 'chat-bg-worker';
const STORE_NAME = 'messageQueue';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function addMessage(message) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).add(message);
  return tx.complete;
}

async function getAllMessages() {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deleteMessage(id) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).delete(id);
  return tx.complete;
}

// Make functions available globally for Service Worker
if (typeof self !== 'undefined' && self.constructor.name === 'ServiceWorkerGlobalScope') {
  // Running in Service Worker context
  self.addMessage = addMessage;
  self.getAllMessages = getAllMessages;
  self.deleteMessage = deleteMessage;
}
