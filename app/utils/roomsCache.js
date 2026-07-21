const DB_NAME = 'dspeak-cache'
const DB_VERSION = 1
const STORE_NAME = 'roomsCache'

function openRoomsCacheDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'userId' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function cacheRooms(userId, rooms) {
  const db = await openRoomsCacheDB()

  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).put({ userId, rooms })
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}

export async function getCachedRooms(userId) {
  const db = await openRoomsCacheDB()

  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly')
        .objectStore(STORE_NAME)
        .get(userId)

      request.onsuccess = () => resolve(request.result?.rooms ?? [])
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}
