import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const chatStore = (
  await Promise.all(
    [
      "store.ts",
      "cache.ts",
      "extras.ts",
      "messages.ts",
      "reads.ts",
      "transport.ts",
    ].map((file) =>
      readFile(new URL(`../app/stores/chat/${file}`, import.meta.url), "utf8"),
    ),
  )
).join("\n");
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
  assert.match(
    chatStore,
    /await context\.dependencies\.enqueueMessage\(queuedMessage\)/,
  );
  assert.match(chatStore, /status: "queued-offline"/);
  assert.match(chatInput, /send when you’re back online/);
  assert.doesNotMatch(chatInput, /Sync Now/);
  assert.match(chatStore, /pendingMessage\.status = "failed"/);
});

test("orphaned pending messages are removed locally after server deletion", () => {
  assert.match(chatStore, /response\.status === 404 && isPending/);
  assert.match(
    chatStore,
    /await context\.dependencies\.dequeueMessage\(pendingClientId\)/,
  );
  assert.match(chatStore, /removeMessage\(messageId, pendingClientId\)/);
});

test("connectivity recovery reconnects chat and flushes the queue", () => {
  assert.match(
    chatStore,
    /addEventListener\("online", context\.handleBrowserOnline\)/,
  );
  assert.match(chatStore, /connectToChannel\([\s\S]*true,/);
  assert.match(chatStore, /type: "FLUSH_CHAT_QUEUE"/);
});

test("denied Background Sync registration is handled", () => {
  assert.match(chatStore, /async function requestBackgroundSync/);
  assert.match(
    chatStore,
    /await registration\.sync\.register\("chat-sync-v2"\)/,
  );
  assert.match(
    chatStore,
    /context\.dependencies\.debugLog\([\s\S]*?Background Sync unavailable:[\s\S]*?syncError,\s*\)/,
  );
  assert.doesNotMatch(
    chatStore,
    /navigator\.serviceWorker\.ready\.then\(\(reg\)/,
  );
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

test("permanent HTTP rejections are not queued for repeated delivery", () => {
  assert.match(chatStore, /deliveryError\.retryable =/);
  assert.match(chatStore, /fetchError\.retryable === false/);
  assert.match(
    chatStore,
    /removeMessage\(pendingMessage\.id, clientMessageId\)/,
  );
  assert.match(chatStore, /throw fetchError/);
  assert.doesNotMatch(chatStore, /response\.status === 429/);
});
