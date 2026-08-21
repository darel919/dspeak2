import type { ChatMessage } from "../shared/types/chat-store.ts";
import {
  isExternalRecord,
  isExternalString,
} from "../shared/types/boundary.ts";
import type { ExternalValue } from "../shared/types/boundary.ts";
import { isRoomRecord, type RoomRecord } from "../shared/types/rooms-store.ts";
import { parseExternalValue } from "./external-values.ts";

const HEALTH_EVENT = "dspeak:idb-health";
const OPEN_TIMEOUT_MS = 5000;
const RETRY_DELAY_MS = 50;

type DatabaseDefinition = {
  readonly name: string;
  readonly version: number;
  readonly stores: Readonly<Record<string, IDBObjectStoreParameters>>;
};

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
    version: 2,
    stores: {
      channelMessages: { keyPath: "key" },
      pendingReads: { keyPath: "userId" },
    },
  },
  queue: {
    name: "chat-bg-worker",
    version: 1,
    stores: {
      messageQueue: { keyPath: "id" },
    },
  },
}) satisfies Record<string, DatabaseDefinition>;

type DatabaseId = keyof typeof DATABASES;
type StoreName = string;
type StorageRecord = Record<string, unknown>;

export interface IdbIssue {
  source: "indexeddb";
  database: string | null;
  operation: string;
  store: string | null;
  errorName: string | null;
  code: string;
  severity: "info" | "warning" | "error" | "fatal";
  recoverable: boolean;
  canReset: boolean;
  message: string;
  timestamp: number;
  recovered?: boolean;
}

interface IdbErrorContext {
  database?: string | null;
  operation?: string;
  store?: string | null;
}

interface CachedRoomsRecord extends StorageRecord {
  userId: string;
  rooms: ExternalValue[];
}

interface CachedMessagesRecord extends StorageRecord {
  key: string;
  userId: string;
  channelId: string;
  messages: ChatMessage[];
  updatedAt: number;
}

export interface QueuedMessage extends StorageRecord {
  id: string;
  channelId?: string;
  content?: string;
  ownerId?: string | number;
  pendingId?: string;
  attachments?: unknown[];
  replyTo?: unknown;
}

interface ServiceWorkerClientLike {
  postMessage(message: ExternalValue): void;
}

interface ServiceWorkerClientsLike {
  matchAll(options: {
    type: "window";
    includeUncontrolled: boolean;
  }): Promise<ServiceWorkerClientLike[]>;
}

const recentReports = new Map<string, number>();
let lastHealthIssue: IdbIssue | null = null;
let persistenceRequest: Promise<boolean> | null = null;

export class IdbOperationError extends Error {
  override name = "IdbOperationError";
  override readonly code: string;
  readonly database: string | null;
  readonly operation: string;
  readonly severity: IdbIssue["severity"];
  readonly recoverable: boolean;
  readonly canReset: boolean;

  constructor(issue: IdbIssue, cause: ExternalValue) {
    super(issue.message, { cause });
    this.code = issue.code;
    this.database = issue.database;
    this.operation = issue.operation;
    this.severity = issue.severity;
    this.recoverable = issue.recoverable;
    this.canReset = issue.canReset;
  }
}

function idbFactory(): IDBFactory | undefined {
  return globalThis.indexedDB;
}

function databaseDefinition(databaseId: DatabaseId): DatabaseDefinition {
  const definition = DATABASES[databaseId];
  if (!definition) throw new Error(`Unknown browser database: ${databaseId}`);
  return definition;
}

function errorName(error: ExternalValue): string {
  if (error instanceof Error) return error.name || "UnknownError";
  if (isExternalRecord(error) && isExternalString(error.name) && error.name)
    return error.name;
  return "UnknownError";
}

export function classifyIdbError(
  error: ExternalValue,
  context: IdbErrorContext = {},
): IdbIssue {
  const name = errorName(error);
  const issue: IdbIssue = {
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

  if (
    name === "DataError" ||
    name === "DataCloneError" ||
    name === "ConstraintError"
  ) {
    return {
      ...issue,
      code: "invalid-data",
      severity: "error",
      message: "dSpeak could not safely store local application data.",
    };
  }

  return issue;
}

function storageSnapshot(value: ExternalValue): ExternalValue {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined)
      throw new DOMException(
        "Local record is not JSON-compatible",
        "DataCloneError",
      );
    return JSON.parse(serialized);
  } catch (error) {
    if (errorName(parseExternalValue(error)) === "DataCloneError") throw error;
    throw new DOMException(
      error instanceof Error
        ? error.message
        : "Local record could not be cloned",
      "DataCloneError",
    );
  }
}

function serializedIssue(issue: IdbIssue): IdbIssue {
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

export function reportIdbHealth(issue: IdbIssue): void {
  const report = serializedIssue(issue);
  lastHealthIssue = report;
  const signature = `${report.database}:${report.operation}:${report.code}:${report.recovered}`;
  const lastReport = recentReports.get(signature) || 0;
  if (Date.now() - lastReport < 2000) return;
  recentReports.set(signature, Date.now());

  const browserWindow = globalThis.window;
  const customEventConstructor = globalThis.CustomEvent;
  if (browserWindow && customEventConstructor instanceof Function) {
    browserWindow.dispatchEvent(
      new customEventConstructor(HEALTH_EVENT, { detail: report }),
    );
    return;
  }

  /* SAFETY: Service-worker execution provides globalThis.clients, and this branch runs only after the browser-window branch above. */
  const workerClients = (
    globalThis as typeof globalThis & {
      clients?: ServiceWorkerClientsLike;
    }
  ).clients;
  if (workerClients?.matchAll) {
    workerClients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients: ServiceWorkerClientLike[]) => {
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

export function getLastIdbHealthIssue(): IdbIssue | null {
  return lastHealthIssue;
}

function reportRecoveredDatabase(database: string): void {
  if (
    !lastHealthIssue ||
    lastHealthIssue.recovered ||
    lastHealthIssue.database !== database
  ) {
    return;
  }
  reportIdbHealth({
    ...lastHealthIssue,
    severity: "info",
    message: "Local browser storage recovered automatically.",
    recovered: true,
    timestamp: Date.now(),
  });
}

function requestPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        request.error || new DOMException("Request failed", "UnknownError"),
      );
  });
}

function transactionPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
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

function ensureSchema(
  database: IDBDatabase,
  definition: DatabaseDefinition,
): void {
  for (const [storeName, options] of Object.entries(definition.stores)) {
    if (!database.objectStoreNames.contains(storeName)) {
      database.createObjectStore(storeName, options);
    }
  }
}

function openDatabase(databaseId: DatabaseId): Promise<IDBDatabase> {
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
      } catch (error: unknown) {
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

function wait(delay: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, delay));
}

async function runTransaction<T>(
  databaseId: DatabaseId,
  storeName: StoreName,
  mode: IDBTransactionMode,
  operation: string,
  handler: (
    store: IDBObjectStore,
    toPromise: <R>(request: IDBRequest<R>) => Promise<R>,
  ) => Promise<T>,
): Promise<T> {
  const definition = databaseDefinition(databaseId);
  if (!definition.stores[storeName]) {
    throw new Error(`Unknown store ${storeName} in ${databaseId}`);
  }

  let firstIssue: IdbIssue | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let database: IDBDatabase | null = null;
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
      } else {
        reportRecoveredDatabase(definition.name);
      }
      return result;
    } catch (error: unknown) {
      const parsedError = parseExternalValue(error);
      const issue = classifyIdbError(parsedError, {
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
      throw new IdbOperationError(issue, parsedError);
    } finally {
      database?.close();
    }
  }
  throw new Error(`IndexedDB operation did not complete: ${operation}`);
}

export function isIdbAvailable() {
  return Boolean(idbFactory());
}

export async function putRecord(
  databaseId: DatabaseId,
  storeName: StoreName,
  value: ExternalValue,
): Promise<IDBValidKey> {
  return runTransaction(
    databaseId,
    storeName,
    "readwrite",
    "put",
    async (store, toPromise) => toPromise(store.put(storageSnapshot(value))),
  );
}

export async function getRecord(
  databaseId: DatabaseId,
  storeName: StoreName,
  key: IDBValidKey,
): Promise<ExternalValue> {
  return runTransaction(
    databaseId,
    storeName,
    "readonly",
    "get",
    async (store, toPromise) => toPromise(store.get(key)),
  );
}

export async function getAllRecords(
  databaseId: DatabaseId,
  storeName: StoreName,
): Promise<ExternalValue[]> {
  return runTransaction(
    databaseId,
    storeName,
    "readonly",
    "get-all",
    async (store, toPromise) => toPromise(store.getAll()),
  );
}

export async function deleteRecord(
  databaseId: DatabaseId,
  storeName: StoreName,
  key: IDBValidKey,
): Promise<undefined> {
  return runTransaction(
    databaseId,
    storeName,
    "readwrite",
    "delete",
    async (store, toPromise) => toPromise(store.delete(key)),
  );
}

async function deleteRecordsWhere(
  databaseId: DatabaseId,
  storeName: StoreName,
  operation: string,
  predicate: (record: ExternalValue) => boolean,
): Promise<void> {
  return runTransaction(
    databaseId,
    storeName,
    "readwrite",
    operation,
    (store) =>
      new Promise<void>((resolve, reject) => {
        const request = store.openCursor();
        request.onerror = () =>
          reject(
            request.error ||
              new DOMException("Cursor request failed", "UnknownError"),
          );
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve();
            return;
          }
          if (predicate(cursor.value)) cursor.delete();
          cursor.continue();
        };
      }),
  );
}

export async function cacheRooms(
  userId: string | number,
  rooms: ExternalValue[],
): Promise<void> {
  await putRecord("rooms", "roomsCache", { userId, rooms });
}

export async function getCachedRooms(
  userId: string | number,
): Promise<RoomRecord[]> {
  const record = await getRecord("rooms", "roomsCache", userId);
  if (!isCachedRoomsRecord(record)) return [];
  return record.rooms.filter(isRoomRecord);
}

function isCachedRoomsRecord(value: ExternalValue): value is CachedRoomsRecord {
  return Boolean(isExternalRecord(value) && Array.isArray(value.rooms));
}

function isCachedMessagesRecord(
  value: ExternalValue,
): value is CachedMessagesRecord {
  return Boolean(isExternalRecord(value) && Array.isArray(value.messages));
}

function isQueuedMessage(value: ExternalValue): value is QueuedMessage {
  return Boolean(isExternalRecord(value) && isExternalString(value.id));
}

function channelCacheKey(userId: string | number, channelId: string): string {
  return `${userId}:${channelId}`;
}

export async function cacheChannelMessages(
  userId: string | number,
  channelId: string,
  messages: ChatMessage[],
): Promise<void> {
  await putRecord("chat", "channelMessages", {
    key: channelCacheKey(userId, channelId),
    userId,
    channelId,
    messages,
    updatedAt: Date.now(),
  });
}

export async function getCachedChannelMessages(
  userId: string | number,
  channelId: string,
): Promise<CachedMessagesRecord | null> {
  const record = await getRecord(
    "chat",
    "channelMessages",
    channelCacheKey(userId, channelId),
  );
  return isCachedMessagesRecord(record) ? record : null;
}

export async function savePendingReadIds(
  userId: string | number,
  messageIds: Array<string | number>,
): Promise<void> {
  await putRecord("chat", "pendingReads", {
    userId: String(userId),
    messageIds: [...new Set(messageIds.map(String))],
    updatedAt: Date.now(),
  });
}

export async function getPendingReadIds(
  userId: string | number,
): Promise<string[]> {
  const record = await getRecord("chat", "pendingReads", String(userId || ""));
  if (isExternalRecord(record) && Array.isArray(record.messageIds))
    return record.messageIds.filter((messageId): messageId is string =>
      isExternalString(messageId),
    );
  return [];
}

export async function enqueueMessage(message: QueuedMessage): Promise<void> {
  void ensurePersistentStorage();
  await putRecord("queue", "messageQueue", message);
}

export async function getQueuedMessages(): Promise<QueuedMessage[]> {
  return (await getAllRecords("queue", "messageQueue")).filter(isQueuedMessage);
}

export async function dequeueMessage(id: string): Promise<void> {
  await deleteRecord("queue", "messageQueue", id);
}

export async function purgeUserLocalData(userId: string): Promise<void> {
  const normalizedUserId = String(userId || "");
  if (!normalizedUserId) return;
  await Promise.all([
    deleteRecord("rooms", "roomsCache", normalizedUserId),
    deleteRecordsWhere(
      "chat",
      "channelMessages",
      "purge-user",
      (record) => recordField(record, "userId") === normalizedUserId,
    ),
    deleteRecord("chat", "pendingReads", normalizedUserId),
    deleteRecordsWhere(
      "queue",
      "messageQueue",
      "purge-user",
      (record) => recordField(record, "ownerId") === normalizedUserId,
    ),
  ]);
}

function recordField(record: ExternalValue, field: string): string {
  if (!isExternalRecord(record) || !(field in record)) return "";
  const value = Object.getOwnPropertyDescriptor(record, field)?.value;
  return String(value || "");
}

function databaseIds(): DatabaseId[] {
  return Object.keys(DATABASES).filter(
    (databaseId): databaseId is DatabaseId => databaseId in DATABASES,
  );
}

function deleteDatabase(databaseId: DatabaseId): Promise<void> {
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

export async function resetLocalDatabases(): Promise<void> {
  const results = await Promise.allSettled(databaseIds().map(deleteDatabase));
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

export async function probeLocalDatabases(): Promise<boolean> {
  for (const databaseId of databaseIds()) {
    const definition = DATABASES[databaseId];
    let database: IDBDatabase | null = null;
    try {
      database = await openDatabase(databaseId);
      for (const storeName of Object.keys(definition.stores)) {
        const transaction = database.transaction(storeName, "readonly");
        const completed = transactionPromise(transaction);
        await requestPromise(transaction.objectStore(storeName).count());
        await completed;
      }
    } finally {
      database?.close();
    }
  }
  return true;
}

export async function getBrowserStorageEstimate(): Promise<{
  usage: number | null;
  quota: number | null;
  persisted: boolean | null;
} | null> {
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

export async function ensurePersistentStorage(): Promise<boolean> {
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
