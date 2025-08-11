 
 

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

async function enqueueMessage(message) {
  await addMessage(message);
}

async function getQueue() {
  return await getAllMessages();
}

async function dequeueMessage(id) {
  await deleteMessage(id);
}

async function flushQueue(sendFn) {
  const queue = await getAllMessages();
  for (const message of queue) {
    try {
      await sendFn(message);
      await deleteMessage(message.id);
    } catch (e) {
      break;
    }
  }
}

export default {
  enqueueMessage,
  dequeueMessage,
  flushQueue,
  getQueue,
};
