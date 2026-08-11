import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("timeline and thread messages expose the shared action menu on right click", async () => {
  const [message, thread, actions] = await Promise.all([
    readFile("app/components/Chat/ChatMessage.vue", "utf8"),
    readFile("app/components/Chat/ThreadSidebar.vue", "utf8"),
    readFile("app/components/Chat/MessageActions.vue", "utf8"),
  ]);

  assert.match(message, /@contextmenu\.prevent="openContextMenu"/);
  assert.match(thread, /@contextmenu\.prevent="openContextMenu"/);
  assert.equal(thread.match(/<MessageActions/g)?.length, 2);
  assert.match(actions, /data-message-actions-trigger/);
});

test("thread actions retain ownership and moderation policy and reach chat mutations", async () => {
  const [thread, window] = await Promise.all([
    readFile("app/components/Chat/ThreadSidebar.vue", "utf8"),
    readFile("app/components/Chat/ChatWindow.vue", "utf8"),
  ]);

  assert.match(thread, /:permissions="permissions"/);
  assert.match(thread, /:is-room-owner="isRoomOwner"/);
  for (const event of [
    "show-details",
    "edit",
    "delete",
    "history",
    "open-reaction-picker",
    "bookmark",
    "pin",
  ]) {
    assert.match(window, new RegExp(`@${event}=`));
  }
  assert.match(window, /await chatStore\.editMessage/);
  assert.match(window, /await chatStore\.deleteMessage/);
  assert.match(window, /threadSidebar\.value\?\.refresh\(\)/);
});
