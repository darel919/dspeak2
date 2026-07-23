const HEALTH_EVENT = "dspeak:idb-health";
const OPEN_TIMEOUT_MS = 5000;
const RETRY_DELAY_MS = 50;

const DATABASES = Object.freeze({
  rooms: {
    name: "dspeak-cache",
    version: 1,
    stores: {
      roomsCache: { keyPath: "userId" },
    },
  },
  chat: {
    name: "dspeak-chat",
    version: 1,
    stores: {
      channelMessages: { keyPath: "key" },
    },
  },
  queue: {
    name: "chat-bg-worker",
    version: 1,
    stores: {
      messageQueue: { keyPath: "id" },
    },
  },
});

const recentReports = new Map();
let lastHealthIssue = null;
let persistenceRequest = null;

export class IdbOperationError extends Error {
  constructor(issue, cause) {
    super(issue.message, { cause });
    this.name = "IdbOperationError";
    this.code = issue.code;
    this.database = issue.database;
    this.operation = issue.operation;
    this.severity = issue.severity;
    this.recoverable = issue.recoverable;
    this.canReset = issue.canReset;
  }
}

function idbFactory() {
  return globalThis.indexedDB;
}

function databaseDefinition(databaseId) {
  const definition = DATABASES[databaseId];
  if (!definition) throw new Error(`Unknown browser database: ${databaseId}`);
  return definition;
}

function errorName(error) {
  return error?.name || "UnknownError";
}

export function classifyIdbError(error, context = {}) {
  const name = errorName(error);
  const issue = {
    source: "indexeddb",
    database: context.database || null,
    operation: context.operation || "unknown",
    store: context.store || null,
    errorName: name,
    code: "operation-failed",
    severity: "warning",
    recoverable: false,
    canReset: false,
    message: "Local browser storage could not complete an operation.",
    timestamp: Date.now(),
  };

  if (name === "NotSupportedError") {
    return {
      ...issue,
      code: "unavailable",
      message: "Local browser storage is unavailable in this browser.",
    };
  }

  if (name === "QuotaExceededError") {
    return {
      ...issue,
      code: "quota-exceeded",
      message: "Local browser storage is full.",
    };
  }

  if (name === "BlockedError") {
    return {
      ...issue,
      code: "blocked",
      message:
        "Local browser storage is blocked by another open dSpeak client.",
      recoverable: true,
    };
  }

  if (
    name === "AbortError" ||
    name === "TransactionInactiveError" ||
    name === "InvalidStateError"
  ) {
    return {
      ...issue,
      code: "transaction-interrupted",
      message: "A local browser storage transaction was interrupted.",
      recoverable: true,
    };
  }

  if (
    name === "UnknownError" ||
    name === "VersionError" ||
    name === "NotFoundError"
  ) {
    return {
      ...issue,
      code: "database-damaged",
      severity: "fatal",
      message: "dSpeak local browser storage may be damaged.",
      recoverable: name === "UnknownError",
      canReset: true,
    };
  }

  if (name === "DataError" || name === "ConstraintError") {
    return {
      ...issue,
      code: "invalid-data",
      severity: "error",
      message: "dSpeak could not safely store local application data.",
    };
  }

  return issue;
}

function serializedIssue(issue) {
  return {
    source: issue.source,
    database: issue.database,
    operation: issue.operation,
    store: issue.store,
    errorName: issue.errorName,
    code: issue.code,
    severity: issue.severity,
    recoverable: issue.recoverable,
    canReset: issue.canReset,
    message: issue.message,
    timestamp: issue.timestamp,
    recovered: Boolean(issue.recovered),
  };
}

export function reportIdbHealth(issue) {
  const report = serializedIssue(issue);
  lastHealthIssue = report;
  const signature = `${report.database}:${report.operation}:${report.code}:${report.recovered}`;
  const lastReport = recentReports.get(signature) || 0;
  if (Date.now() - lastReport < 2000) return;
  recentReports.set(signature, Date.now());

  if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
    window.dispatchEvent(new CustomEvent(HEALTH_EVENT, { detail: report }));
    return;
  }

  if (globalThis.clients?.matchAll) {
    globalThis.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: "IDB_HEALTH", issue: report });
        }
      })
      .catch((error) => {
        console.warn(
          "[IndexedDB] Unable to report worker storage health:",
          error,
        );
      });
  }
}

export function getLastIdbHealthIssue() {
  return lastHealthIssue;
}

function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        request.error || new DOMException("Request failed", "UnknownError"),
      );
  });
}

function transactionPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(
        transaction.error ||
          new DOMException("Transaction failed", "UnknownError"),
      );
    transaction.onabort = () =>
      reject(
        transaction.error ||
          new DOMException("Transaction aborted", "AbortError"),
      );
  });
}

function ensureSchema(database, definition) {
  for (const [storeName, options] of Object.entries(definition.stores)) {
    if (!database.objectStoreNames.contains(storeName)) {
      database.createObjectStore(storeName, options);
    }
  }
}

function openDatabase(databaseId) {
  const factory = idbFactory();
  if (!factory) {
    return Promise.reject(
      new DOMException("IndexedDB is unavailable", "NotSupportedError"),
    );
  }

  const definition = databaseDefinition(databaseId);
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = factory.open(definition.name, definition.version);
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(
        new DOMException("Database open request was blocked", "BlockedError"),
      );
    }, OPEN_TIMEOUT_MS);

    request.onupgradeneeded = () => {
      try {
        ensureSchema(request.result, definition);
      } catch (error) {
        request.transaction?.abort();
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(error);
        }
      }
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(
        request.error ||
          new DOMException("Database open failed", "UnknownError"),
      );
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      clearTimeout(timeout);
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

function wait(delay) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

async function runTransaction(databaseId, storeName, mode, operation, handler) {
  const definition = databaseDefinition(databaseId);
  if (!definition.stores[storeName]) {
    throw new Error(`Unknown store ${storeName} in ${databaseId}`);
  }

  let firstIssue = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let database = null;
    try {
      database = await openDatabase(databaseId);
      const transaction = database.transaction(storeName, mode);
      const completed = transactionPromise(transaction);
      const result = await handler(
        transaction.objectStore(storeName),
        requestPromise,
      );
      await completed;
      if (firstIssue) {
        reportIdbHealth({
          ...firstIssue,
          severity: "info",
          message: "Local browser storage recovered automatically.",
          recovered: true,
          timestamp: Date.now(),
        });
      }
      return result;
    } catch (error) {
      const issue = classifyIdbError(error, {
        database: definition.name,
        operation,
        store: storeName,
      });
      if (!firstIssue) firstIssue = issue;
      if (attempt === 0 && issue.recoverable) {
        await wait(RETRY_DELAY_MS);
        continue;
      }
      reportIdbHealth(issue);
      throw new IdbOperationError(issue, error);
    } finally {
      database?.close();
    }
  }
}

export function isIdbAvailable() {
  return Boolean(idbFactory());
}

export async function putRecord(databaseId, storeName, value) {
  return runTransaction(
    databaseId,
    storeName,
    "readwrite",
    "put",
    async (store, toPromise) => toPromise(store.put(value)),
  );
}

export async function getRecord(databaseId, storeName, key) {
  return runTransaction(
    databaseId,
    storeName,
    "readonly",
    "get",
    async (store, toPromise) => toPromise(store.get(key)),
  );
}

export async function getAllRecords(databaseId, storeName) {
  return runTransaction(
    databaseId,
    storeName,
    "readonly",
    "get-all",
    async (store, toPromise) => toPromise(store.getAll()),
  );
}

export async function deleteRecord(databaseId, storeName, key) {
  return runTransaction(
    databaseId,
    storeName,
    "readwrite",
    "delete",
    async (store, toPromise) => toPromise(store.delete(key)),
  );
}

export async function cacheRooms(userId, rooms) {
  await putRecord("rooms", "roomsCache", { userId, rooms });
}

export async function getCachedRooms(userId) {
  const record = await getRecord("rooms", "roomsCache", userId);
  return record?.rooms ?? [];
}

function channelCacheKey(userId, channelId) {
  return `${userId}:${channelId}`;
}

export async function cacheChannelMessages(userId, channelId, messages) {
  await putRecord("chat", "channelMessages", {
    key: channelCacheKey(userId, channelId),
    userId,
    channelId,
    messages,
    updatedAt: Date.now(),
  });
}

export async function getCachedChannelMessages(userId, channelId) {
  return (
    (await getRecord(
      "chat",
      "channelMessages",
      channelCacheKey(userId, channelId),
    )) || null
  );
}

export async function enqueueMessage(message) {
  await ensurePersistentStorage();
  await putRecord("queue", "messageQueue", message);
}

export async function getQueuedMessages() {
  return getAllRecords("queue", "messageQueue");
}

export async function dequeueMessage(id) {
  await deleteRecord("queue", "messageQueue", id);
}

function deleteDatabase(databaseId) {
  const factory = idbFactory();
  const definition = databaseDefinition(databaseId);
  if (!factory) {
    return Promise.reject(
      new DOMException("IndexedDB is unavailable", "NotSupportedError"),
    );
  }

  return new Promise((resolve, reject) => {
    const request = factory.deleteDatabase(definition.name);
    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(
        request.error ||
          new DOMException("Database reset failed", "UnknownError"),
      );
    request.onblocked = () =>
      reject(
        new DOMException(
          "Database reset is blocked by another tab",
          "BlockedError",
        ),
      );
  });
}

export async function resetLocalDatabases() {
  const results = await Promise.allSettled(
    Object.keys(DATABASES).map(deleteDatabase),
  );
  const failure = results.find((result) => result.status === "rejected");
  if (failure) {
    const issue = classifyIdbError(failure.reason, {
      operation: "reset",
    });
    reportIdbHealth(issue);
    throw new IdbOperationError(issue, failure.reason);
  }
  reportIdbHealth({
    source: "indexeddb",
    database: null,
    operation: "reset",
    store: null,
    errorName: null,
    code: "reset-complete",
    severity: "info",
    recoverable: false,
    canReset: false,
    message: "Local browser storage was reset.",
    timestamp: Date.now(),
    recovered: true,
  });
}

export async function getBrowserStorageEstimate() {
  if (!globalThis.navigator?.storage?.estimate) return null;
  const estimate = await globalThis.navigator.storage.estimate();
  return {
    usage: estimate.usage ?? null,
    quota: estimate.quota ?? null,
    persisted: globalThis.navigator.storage.persisted
      ? await globalThis.navigator.storage.persisted()
      : null,
  };
}

export async function ensurePersistentStorage() {
  if (!globalThis.navigator?.storage?.persisted) return false;
  if (!persistenceRequest) {
    persistenceRequest = (async () => {
      if (await globalThis.navigator.storage.persisted()) return true;
      if (!globalThis.navigator.storage.persist) return false;
      return globalThis.navigator.storage.persist();
    })().catch((error) => {
      persistenceRequest = null;
      console.warn(
        "[IndexedDB] Unable to request persistent browser storage:",
        error,
      );
      return false;
    });
  }
  return persistenceRequest;
}

export { HEALTH_EVENT };
