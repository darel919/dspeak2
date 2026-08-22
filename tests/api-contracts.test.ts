import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  roomsApi,
  roomAuth,
  schema,
  notificationSync,
  mediaBootstrap,
  dspeakApi,
  channelApi,
  chatHandler,
  socialRepository,
  roomApi,
  pushDelivery,
  cleanupRoute,
  reconcileRoute,
  threadSidebar,
  uploadPrepare,
  soundboardApi,
  fileCommit,
] = await Promise.all(
  [
    "../server/utils/dspeak-rooms-api.ts",
    "../server/utils/room-authorization.ts",
    "../server/db/schema/index.ts",
    "../server/routes/api/notifications/sync.ts",
    "../server/routes/api/media/bootstrap.post.ts",
    "../server/utils/dspeak-api.ts",
    "../server/utils/dspeak-channel-api.ts",
    "../server/utils/dspeak-chat-api/handler.ts",
    "../server/db/repositories/social.ts",
    "../server/utils/dspeak-rooms-api.ts",
    "../server/utils/push-delivery.ts",
    "../server/routes/api/files/cleanup.post.ts",
    "../server/routes/api/files/reconcile.post.ts",
    "../app/components/Chat/ThreadSidebar.vue",
    "../server/routes/api/files/prepare.post.ts",
    "../server/utils/soundboard-api.ts",
    "../server/routes/api/files/commit.post.ts",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
);

const chatApiModules = await Promise.all(
  ["messages.ts", "files.ts", "interactions.ts", "discovery.ts"].map((file) =>
    readFile(
      new URL(`../server/utils/dspeak-chat-api/${file}`, import.meta.url),
      "utf8",
    ),
  ),
);
const chatApi = [chatHandler, ...chatApiModules].join("\n");

test("room creation creates the owner membership exactly once inside one transaction", () => {
  const createRoom = roomsApi.slice(
    roomsApi.indexOf('if (!suffix && method === "POST")'),
    roomsApi.indexOf('if (!suffix && method === "PUT")'),
  );
  assert.match(createRoom, /db\.transaction\(async \(tx\)/);
  assert.match(createRoom, /seedRoomRoles\(nextRoom, userId, tx\)/);
  assert.doesNotMatch(createRoom, /insert\(roomMemberships\)/);
});

test("default room roles use the repository's snake_case template contract", () => {
  assert.match(roomAuth, /template\.is_default/);
});

test("room role mutations resolve the room from their JSON body", () => {
  const roleHandler = roomsApi.slice(
    roomsApi.indexOf("async function handleRoomRoles"),
    roomsApi.indexOf("async function handleRooms"),
  );
  assert.match(
    roleHandler,
    /const resolvedRoomId = requireValue\(\s*roomId \|\| body\.roomId,/,
  );
  assert.match(roleHandler, /getRoomById\(resolvedRoomId\)/);
});

test("room details filters the deduplicated member ID array, not the Set", () => {
  assert.match(roomsApi, /const memberIds = \[/);
  assert.match(roomsApi, /\.\.\.new Set\(memberships\.map\(/);
  assert.match(roomsApi, /\]\.filter\(Boolean\);/);
  assert.doesNotMatch(
    roomsApi,
    /new Set\(memberships\.map\(\(m\) => String\(m\.userId\)\)\)\.filter\(/,
  );
});

test("room details emits one member entry for users with multiple roles", () => {
  const memberResponse = roomsApi.slice(
    roomsApi.indexOf("members: memberIds"),
    roomsApi.indexOf(
      "channels: roomChannels.map",
      roomsApi.indexOf("members: memberIds"),
    ),
  );
  assert.match(memberResponse, /members: memberIds\s*\.map/);
  assert.match(memberResponse, /rolesByUserId\.get\(userId\)/);
  assert.doesNotMatch(memberResponse, /memberships\.map/);
});

test("internal API errors expose a request ID without a server stack", () => {
  assert.match(dspeakApi, /data: \{ code: "INTERNAL_ERROR", requestId \}/);
  assert.match(
    dspeakApi,
    /data: \{ code: "INTERNAL_ERROR", requestId \},\s*stack: ""/,
  );
});

test("channel policy fields are represented in the database schema", () => {
  assert.match(schema, /description: text\("description"\)/);
  assert.match(schema, /policy: text\("policy"\)\.default\("free"\)/);
  assert.match(schema, /slowMode: integer\("slow_mode"\)\.default\(0\)/);
  assert.match(schema, /duration: real\("duration"\)\.default\(0\)/);
});

test("channel join and leave persist the inRoom column and announce it to the room", () => {
  assert.match(channelApi, /\.set\(\{ inRoom: nextInRoom \}\)/);
  assert.match(channelApi, /await Promise\.all\(\[[\s\S]*broadcastToChannel/);
  assert.match(channelApi, /broadcastToRoom\(room\.id, \{/);
  assert.match(
    channelApi,
    /type: "voice-presence",\s*data: \{\s*channelId: String\(channel\.id\),\s*inRoom,\s*profiles: voiceProfiles,\s*participantStates: \[\],\s*\}/,
  );
  assert.match(channelApi, /type: "currentlyInChannel", inRoom/);
  assert.doesNotMatch(channelApi, /getVoicePresenceSnapshots/);
});

test("notification sync uses the actual notification read column", () => {
  assert.match(notificationSync, /eq\(notifications\.read, false\)/);
  assert.doesNotMatch(notificationSync, /notifications\.readAt/);
  assert.match(notificationSync, /Invalid since date/);
  assert.match(
    notificationSync,
    /Math\.max\(1, Math\.min\(requestedLimit, 200\)\)/,
  );
});

test("media bootstrap accepts both voice and stage channels", () => {
  assert.match(
    mediaBootstrap,
    /\["voice", "stage"\]\.includes\(channel\.type\)/,
  );
});

test("API channel edits import and persist channel policy fields", () => {
  assert.match(channelApi, /normalizeChannelPolicy/);
  assert.match(channelApi, /normalizeSlowMode/);
  assert.match(channelApi, /from "\.\.\/\.\.\/shared\/channel-policy\.ts"/);
  assert.match(
    channelApi,
    /body\.isMedia === true \|\| body\.isMedia === "true" \? "voice" : "text"/,
  );
});

test("chat accepts attachment-only messages and implements both content filters", () => {
  assert.match(chatApi, /if \(hasContent && contentValue\.length > 4000\)/);
  assert.match(chatApi, /query\.has === "attachment"/);
  assert.match(chatApi, /query\.has === "link"/);
  assert.match(chatApi, /Invalid before date/);
  assert.match(chatApi, /function parseNotificationData/);
});

test("social repository uses SQL null semantics for invite use and imports audit pagination", () => {
  assert.match(socialRepository, /isNull\(roomInvites\.usedAt\)/);
  assert.match(socialRepository, /import \{[^}]*lt[^}]*\} from "drizzle-orm"/s);
  assert.doesNotMatch(socialRepository, /eq\(roomInvites\.usedAt, null\)/);
});

test("room presentation returns persisted channel policy and profile handles", () => {
  assert.match(roomApi, /normalizeMediaPolicy\(\s*channel\.mediaPolicy/);
  assert.match(roomApi, /handle: profile\.username \|\| ""/);
});

test("push jobs include their required recipient and current soundboards are protected from cleanup", () => {
  assert.match(pushDelivery, /recipientId,/);
  assert.match(cleanupRoute, /from\(roomSoundboards\)/);
  assert.match(reconcileRoute, /from\(roomSoundboards\)/);
});

test("thread avatars use the current profile asset route", () => {
  assert.match(threadSidebar, /ProfileImage/);
  assert.doesNotMatch(threadSidebar, /pbUrl|_pb_users_auth_/);
});

test("upload preparation does not advertise an uncommitted album-art type", () => {
  assert.doesNotMatch(uploadPrepare, /"album-art"/);
  assert.match(soundboardApi, /clipTitle: clip\.name/);
});

test("generic file commits keep database references owned by the caller", () => {
  assert.match(fileCommit, /from\(messages\)/);
  assert.match(fileCommit, /Only the message author can attach this file/);
  assert.match(fileCommit, /update\(profiles\)/);
  assert.match(fileCommit, /messageId: messageId \|\| null/);
  assert.match(fileCommit, /room\.update_identity/);
  assert.match(fileCommit, /room\.manage_soundboard/);
  assert.match(uploadPrepare, /room\.update_identity/);
  assert.match(uploadPrepare, /room\.manage_soundboard/);
});
