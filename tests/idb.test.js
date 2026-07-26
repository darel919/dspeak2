import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";
import {
  cacheChannelMessages,
  cacheRooms,
  classifyIdbError,
  dequeueMessage,
  enqueueMessage,
  getCachedChannelMessages,
  getCachedRooms,
  getLastIdbHealthIssue,
  getPendingReadIds,
  getQueuedMessages,
  HEALTH_EVENT,
  IdbOperationError,
  putRecord,
  probeLocalDatabases,
  purgeUserLocalData,
  reportIdbHealth,
  resetLocalDatabases,
  savePendingReadIds,
} from "../app/utils/idb.js";

globalThis.indexedDB = fakeIndexedDB;

test("central database API preserves every existing cache contract", async () => {
  await resetLocalDatabases();

  await cacheRooms("user-one", [{ id: "room-one" }]);
  await cacheChannelMessages("user-one", "channel-one", [
    { id: "message-one" },
  ]);
  await enqueueMessage({
    id: "queue-one",
    channelId: "channel-one",
    content: "queued",
  });
  await savePendingReadIds("user-one", ["message-one", "message-two"]);

  assert.deepEqual(await getCachedRooms("user-one"), [{ id: "room-one" }]);
  assert.deepEqual(
    (await getCachedChannelMessages("user-one", "channel-one")).messages,
    [{ id: "message-one" }],
  );
  assert.deepEqual(await getQueuedMessages(), [
    {
      id: "queue-one",
      channelId: "channel-one",
      content: "queued",
    },
  ]);
  assert.deepEqual(await getPendingReadIds("user-one"), [
    "message-one",
    "message-two",
  ]);

  await dequeueMessage("queue-one");
  assert.deepEqual(await getQueuedMessages(), []);
});

test("reactive-style proxy records are converted to storage-safe snapshots", async () => {
  const message = new Proxy(
    {
      id: "proxied-message",
      sender: new Proxy({ id: "proxied-user" }, {}),
    },
    {},
  );
  const messages = new Proxy([message], {});

  await cacheChannelMessages("proxy-user", "proxy-channel", messages);
  assert.deepEqual(
    (await getCachedChannelMessages("proxy-user", "proxy-channel")).messages,
    [{ id: "proxied-message", sender: { id: "proxied-user" } }],
  );
});

test("logout purges only the outgoing user's local records", async () => {
  await resetLocalDatabases();
  await cacheRooms("user-one", [{ id: "room-one" }]);
  await cacheRooms("user-two", [{ id: "room-two" }]);
  await cacheChannelMessages("user-one", "channel-one", [
    { id: "message-one" },
  ]);
  await cacheChannelMessages("user-two", "channel-two", [
    { id: "message-two" },
  ]);
  await enqueueMessage({
    id: "queue-one",
    ownerId: "user-one",
    channelId: "channel-one",
    content: "one",
  });
  await enqueueMessage({
    id: "queue-two",
    ownerId: "user-two",
    channelId: "channel-two",
    content: "two",
  });
  await savePendingReadIds("user-one", ["message-one"]);
  await savePendingReadIds("user-two", ["message-two"]);

  await purgeUserLocalData("user-one");

  assert.deepEqual(await getCachedRooms("user-one"), []);
  assert.equal(await getCachedChannelMessages("user-one", "channel-one"), null);
  assert.deepEqual(await getCachedRooms("user-two"), [{ id: "room-two" }]);
  assert.deepEqual(
    (await getCachedChannelMessages("user-two", "channel-two")).messages,
    [{ id: "message-two" }],
  );
  assert.deepEqual(await getQueuedMessages(), [
    {
      id: "queue-two",
      ownerId: "user-two",
      channelId: "channel-two",
      content: "two",
    },
  ]);
  assert.deepEqual(await getPendingReadIds("user-one"), []);
  assert.deepEqual(await getPendingReadIds("user-two"), ["message-two"]);
});

test("recoverable database failures retry once without losing the operation", async () => {
  const workingFactory = globalThis.indexedDB;
  let opens = 0;
  globalThis.indexedDB = {
    open(...args) {
      opens += 1;
      if (opens > 1) return workingFactory.open(...args);
      const request = {};
      queueMicrotask(() => {
        request.error = new DOMException("Interrupted", "AbortError");
        request.onerror();
      });
      return request;
    },
    deleteDatabase: workingFactory.deleteDatabase.bind(workingFactory),
  };

  try {
    await cacheRooms("retry-user", [{ id: "recovered-room" }]);
    assert.equal(opens, 2);
    assert.deepEqual(await getCachedRooms("retry-user"), [
      { id: "recovered-room" },
    ]);
    assert.equal(getLastIdbHealthIssue().recovered, true);
  } finally {
    globalThis.indexedDB = workingFactory;
  }
});

test("a later successful operation clears a previously reported interruption", async () => {
  const workingFactory = globalThis.indexedDB;
  globalThis.indexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.error = new DOMException("Interrupted", "InvalidStateError");
        request.onerror();
      });
      return request;
    },
    deleteDatabase: workingFactory.deleteDatabase.bind(workingFactory),
  };
  await assert.rejects(cacheRooms("recovery-user", []), IdbOperationError);
  assert.equal(getLastIdbHealthIssue().recovered, false);

  globalThis.indexedDB = workingFactory;
  try {
    await cacheRooms("recovery-user", [{ id: "after-recovery" }]);
    assert.equal(getLastIdbHealthIssue().recovered, true);
    assert.equal(await probeLocalDatabases(), true);
  } finally {
    globalThis.indexedDB = workingFactory;
  }
});

test("database errors distinguish repairable, capacity, and fatal states", () => {
  const interrupted = classifyIdbError(
    new DOMException("Interrupted", "AbortError"),
    { database: "test", operation: "get" },
  );
  const quota = classifyIdbError(
    new DOMException("Full", "QuotaExceededError"),
    { database: "test", operation: "put" },
  );
  const damaged = classifyIdbError(
    new DOMException("Damaged", "UnknownError"),
    { database: "test", operation: "open" },
  );

  assert.equal(interrupted.recoverable, true);
  assert.equal(interrupted.canReset, false);
  assert.equal(quota.code, "quota-exceeded");
  assert.equal(quota.severity, "warning");
  assert.equal(damaged.severity, "fatal");
  assert.equal(damaged.canReset, true);
  assert.equal(
    classifyIdbError(new DOMException("Proxy", "DataCloneError")).code,
    "invalid-data",
  );
});

test("invalid writes reject through the centralized error contract", async () => {
  await assert.rejects(
    putRecord("rooms", "roomsCache", { rooms: [] }),
    (error) =>
      error instanceof IdbOperationError &&
      error.code === "invalid-data" &&
      error.severity === "error",
  );
});

test("a missing installed store is reported as fatal and can be reset", async () => {
  await resetLocalDatabases();
  await new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open("dspeak-cache", 1);
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });

  await assert.rejects(
    getCachedRooms("damaged-user"),
    (error) =>
      error instanceof IdbOperationError &&
      error.code === "database-damaged" &&
      error.canReset,
  );
  await resetLocalDatabases();
});

test("explicit reset removes only dSpeak browser databases", async () => {
  await cacheRooms("reset-user", [{ id: "room-before-reset" }]);
  await cacheChannelMessages("reset-user", "reset-channel", [
    { id: "message-before-reset" },
  ]);

  await resetLocalDatabases();

  assert.deepEqual(await getCachedRooms("reset-user"), []);
  assert.equal(
    await getCachedChannelMessages("reset-user", "reset-channel"),
    null,
  );
});

test("all IndexedDB access is owned by idb.js", async () => {
  const files = [
    "../app/stores/chat.js",
    "../app/stores/rooms.js",
    "../public/sw.js",
  ];
  for (const path of files) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\bindexedDB\b|\.transaction\(/);
  }

  const idbSource = await readFile(
    new URL("../app/utils/idb.js", import.meta.url),
    "utf8",
  );
  assert.match(idbSource, /database\.transaction\(/);
  assert.match(idbSource, /classifyIdbError/);
  assert.match(idbSource, /reportIdbHealth/);
});

test("the repair UI requires confirmation before deleting local data", async () => {
  const prompt = await readFile(
    new URL("../app/components/DatabaseHealthPrompt.vue", import.meta.url),
    "utf8",
  );
  assert.match(prompt, /Reset local data/);
  assert.match(prompt, /Confirm reset/);
  assert.match(prompt, /if \(!resetConfirmation\.value\)/);
  assert.match(prompt, /await resetLocalDatabases\(\)/);
  assert.match(prompt, /await probeLocalDatabases\(\)/);
  assert.match(prompt, /diagnosticSummary/);
});

test("page and service-worker failures reach the main application", async () => {
  class TestCustomEvent extends Event {
    constructor(type, options) {
      super(type);
      this.detail = options.detail;
    }
  }

  const page = new EventTarget();
  globalThis.window = page;
  globalThis.CustomEvent = TestCustomEvent;
  const pageReport = new Promise((resolve) =>
    page.addEventListener(HEALTH_EVENT, (event) => resolve(event.detail), {
      once: true,
    }),
  );
  reportIdbHealth({
    source: "indexeddb",
    database: "page-test",
    operation: "page-report",
    store: "test",
    errorName: "UnknownError",
    code: "database-damaged",
    severity: "fatal",
    recoverable: false,
    canReset: true,
    message: "damaged",
    timestamp: Date.now(),
  });
  assert.equal((await pageReport).operation, "page-report");
  delete globalThis.window;
  delete globalThis.CustomEvent;

  let workerMessage = null;
  globalThis.clients = {
    async matchAll() {
      return [
        {
          postMessage(message) {
            workerMessage = message;
          },
        },
      ];
    },
  };
  reportIdbHealth({
    source: "indexeddb",
    database: "worker-test",
    operation: "worker-report",
    store: "test",
    errorName: "UnknownError",
    code: "database-damaged",
    severity: "fatal",
    recoverable: false,
    canReset: true,
    message: "damaged",
    timestamp: Date.now(),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(workerMessage.type, "IDB_HEALTH");
  assert.equal(workerMessage.issue.operation, "worker-report");
  delete globalThis.clients;
});
