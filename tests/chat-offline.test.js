import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const chatStore = await readFile(
  new URL("../app/stores/chat.js", import.meta.url),
  "utf8",
);
const chatWindow = await readFile(
  new URL("../app/components/Chat/ChatWindow.vue", import.meta.url),
  "utf8",
);
const chatInput = await readFile(
  new URL("../app/components/Chat/ChatInput.vue", import.meta.url),
  "utf8",
);
const offlineBanner = await readFile(
  new URL("../app/components/Chat/OfflineBanner.vue", import.meta.url),
  "utf8",
);

test("offline chat preserves cached history without failure banners", () => {
  assert.match(chatStore, /getCachedChannelMessages/);
  assert.match(chatStore, /if \(!navigator\.onLine\)/);
  assert.match(chatWindow, /error && !offline/);
  assert.match(offlineBanner, /Showing saved messages/);
});

test("offline messages remain writable and queue for reconnection", () => {
  assert.match(chatStore, /await enqueueMessage\(queuedMessage\)/);
  assert.match(chatStore, /status: "queued-offline"/);
  assert.match(chatInput, /send when you’re back online/);
  assert.doesNotMatch(chatInput, /Sync Now/);
  assert.match(chatStore, /pendingMessage\.status = "failed"/);
});

test("connectivity recovery reconnects chat and flushes the queue", () => {
  assert.match(chatStore, /addEventListener\("online", handleBrowserOnline\)/);
  assert.match(chatStore, /connectToChannel\([\s\S]*true,/);
  assert.match(chatStore, /type: "FORCE_SYNC"/);
});

test("obsolete room teardown cannot disconnect the destination channel", () => {
  assert.match(
    chatStore,
    /expectedChannelId &&[\s\S]*currentChannelId\.value !== expectedChannelId[\s\S]*return false/,
  );
  assert.match(
    chatStore,
    /function disconnectFromChannel\([\s\S]*expectedChannelId = null/,
  );
});
