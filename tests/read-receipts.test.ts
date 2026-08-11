import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  addReader,
  hasReader,
  mergeReaders,
  readerId,
  readerIds,
} from "../app/shared/read-receipts.ts";

test("read receipts normalize expanded users and plain identifiers", () => {
  assert.equal(readerId({ id: "user-a", name: "A" }), "user-a");
  assert.deepEqual(
    readerIds(["user-a", { id: "user-b" }, { id: "user-a" }, null]),
    ["user-a", "user-b"],
  );
  assert.equal(hasReader([{ id: "user-a" }], "user-a"), true);
});

test("adding a reader is idempotent and preserves expanded user data", () => {
  const existing = [{ id: "user-a", name: "A" }];
  assert.equal(addReader(existing, "user-a"), existing);
  assert.deepEqual(addReader(existing, { id: "user-b", name: "B" }), [
    ...existing,
    { id: "user-b", name: "B" },
  ]);
  assert.deepEqual(mergeReaders(existing, ["user-a", "user-b"]), [
    existing[0],
    "user-b",
  ]);
});

test("the read queue is deduplicated and retains failed batch entries", async () => {
  const chatStore = (
    await Promise.all(
      ["store.ts", "reads.ts"].map((file) =>
        readFile(
          new URL(`../app/stores/chat/${file}`, import.meta.url),
          "utf8",
        ),
      ),
    )
  ).join("\n");
  assert.match(chatStore, /const pendingReadIds = new Set\(\)/);
  assert.match(chatStore, /result\.status === "marked_as_read"/);
  assert.match(chatStore, /pendingReadIds\.delete\(result\.messageId\)/);
  assert.match(chatStore, /\[\.\.\.pendingReadIds\]\.slice\(0, 200\)/);
  assert.doesNotMatch(chatStore, /setInterval\(async \(\) =>/);
});

test("the server bounds read batches and aggregates unread counts in one query", async () => {
  const api = await readFile(
    new URL("../server/utils/dspeak-chat-api/messages.ts", import.meta.url),
    "utf8",
  );
  assert.match(api, /ids\.length > 200/);
  assert.match(api, /const channelById = new Map/);
  assert.match(api, /NOT \(\$\{messages\.readBy\}/);
});

test("read receipt status is only rendered for the message sender", async () => {
  const chatMessage = await readFile(
    new URL("../app/components/Chat/ChatMessage.vue", import.meta.url),
    "utf8",
  );
  assert.match(
    chatMessage,
    /isOwnMessage && \(isPending \|\| isFailed \|\| hasBeenReadByOthers\)/,
  );
  assert.doesNotMatch(chatMessage, /const isRead = computed/);
  assert.doesNotMatch(chatMessage, /return "Read";/);
});
