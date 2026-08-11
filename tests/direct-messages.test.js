import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schema = await readFile(
  new URL("../server/db/schema/index.js", import.meta.url),
  "utf8",
);
const migration = await readFile(
  new URL("../drizzle/migrations/0010_nasty_green_goblin.sql", import.meta.url),
  "utf8",
);
const receiptsMigration = await readFile(
  new URL(
    "../drizzle/migrations/0011_hesitant_sister_grimm.sql",
    import.meta.url,
  ),
  "utf8",
);
const manager = await readFile(
  new URL("../server/utils/direct-messages-manager.js", import.meta.url),
  "utf8",
);
const store = await readFile(
  new URL("../app/stores/directMessages.js", import.meta.url),
  "utf8",
);
const notificationCenter = await readFile(
  new URL("../app/components/NotificationCenter.vue", import.meta.url),
  "utf8",
);
const page = await readFile(
  new URL("../app/pages/messages.vue", import.meta.url),
  "utf8",
);
const friendPage = await readFile(
  new URL("../app/pages/friends.vue", import.meta.url),
  "utf8",
);
const friendMenu = await readFile(
  new URL("../app/components/MemberList.vue", import.meta.url),
  "utf8",
);
const roomRail = await readFile(
  new URL("../app/components/MetroRoomRail.vue", import.meta.url),
  "utf8",
);
const navbar = await readFile(
  new URL("../app/components/Navbar.vue", import.meta.url),
  "utf8",
);

test("direct messages have friend-gated, idempotent persistence", () => {
  assert.match(schema, /export const directConversations = pgTable/);
  assert.match(schema, /export const directMessages = pgTable/);
  assert.match(schema, /direct_conversation_participants/);
  assert.match(schema, /unique_direct_message_client/);
  assert.match(schema, /deliveredAt: timestamp\("delivered_at"/);
  assert.match(schema, /readAt: timestamp\("read_at"/);
  assert.match(migration, /CREATE TABLE "direct_conversations"/);
  assert.match(migration, /CREATE TABLE "direct_messages"/);
  assert.match(receiptsMigration, /ADD COLUMN "delivered_at"/);
  assert.match(manager, /eq\(friends\.status, "accepted"\)/);
  assert.match(manager, /Direct messages are available to friends only/);
  assert.match(manager, /\.onConflictDoNothing\(\)/);
  assert.match(manager, /clientMessageId/);
  assert.match(manager, /const profileMap = await profilesById/);
  assert.match(manager, /\.from\(profiles\)/);
  assert.match(manager, /profileMap\.get/);
  assert.match(manager, /new Date\(latest\.createdAt\)/);
  assert.match(manager, /type: "direct_message"/);
  assert.match(manager, /type: "notification_created"/);
  assert.match(manager, /type: "direct_messages_delivered"/);
  assert.match(manager, /type: "direct_messages_read"/);
  assert.match(page, /messageReceiptLabel/);
});

test("direct message routes authorize conversation reads, sends, and receipts", async () => {
  const [indexRoute, conversationRoute] = await Promise.all([
    readFile(
      new URL("../server/routes/api/direct-messages/index.js", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../server/routes/api/direct-messages/[conversationId].js",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  assert.match(indexRoute, /requireAuthenticatedUser\(event\)/);
  assert.match(indexRoute, /openDirectConversation/);
  assert.match(conversationRoute, /getDirectMessages/);
  assert.match(conversationRoute, /sendDirectMessage/);
  assert.match(conversationRoute, /markDirectConversationRead/);
  assert.match(conversationRoute, /markDirectMessagesDelivered/);
  assert.match(conversationRoute, /action === "delivered"/);
  assert.match(conversationRoute, /event\.method === "PATCH"/);
});

test("the client reconciles retries and subscribes to user-scoped realtime delivery", () => {
  assert.match(store, /clientMessageId/);
  assert.match(store, /pending_\$\{clientMessageId\}/);
  assert.match(store, /openRealtimeChannel/);
  assert.match(store, /notify:/);
  assert.match(store, /message\?\.type !== "direct_message"/);
  assert.match(store, /fetchConversations\(\)\.catch/);
  assert.match(notificationCenter, /conversationId = item\.conversationId/);
  assert.match(notificationCenter, /\/messages\?conversationId=/);
});

test("friends expose direct-message entry points", () => {
  assert.match(friendPage, /messageFriend\(friend\)/);
  assert.match(friendPage, /path: "\/messages"/);
  assert.match(friendMenu, /messageMemberFromMenu/);
  assert.match(friendMenu, /friendshipStatus\.status === 'friends'/);
  assert.match(page, /Direct messages/);
  assert.match(page, /store\.sendMessage/);
  assert.match(page, /direct-messages-composer-input/);
});

test("the room rail exposes direct messages beside the home destination", () => {
  assert.match(roomRail, /to="\/messages"/);
  assert.match(roomRail, /aria-label="Messages"/);
  assert.match(roomRail, /directMessagesStore\.unreadCount/);
  assert.doesNotMatch(navbar, /to="\/messages"/);
});
