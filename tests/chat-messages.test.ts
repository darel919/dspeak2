import assert from "node:assert/strict";
import test from "node:test";
import {
  chatApiErrorMessage,
  hasDistinctUpdatedTimestamp,
  isValidMessageTimestamp,
  mergeServerMessagesWithPending,
  messageChannelId,
  isPendingDuplicate,
  pendingMessageClientId,
  removeMessageAliases,
  reconcileIncomingMessage,
  reconcileSentMessage,
} from "../app/shared/chat-messages.ts";
import { apiErrorMessage } from "../app/shared/api-errors.ts";
import { readFileSync } from "node:fs";

const chatApiSource = [
  "handler.ts",
  "messages.ts",
  "files.ts",
  "interactions.ts",
  "discovery.ts",
]
  .map((file) =>
    readFileSync(
      new URL(`../server/utils/dspeak-chat-api/${file}`, import.meta.url),
      "utf8",
    ),
  )
  .join("\n");
const chatStoreSource = [
  "store.ts",
  "cache.ts",
  "extras.ts",
  "messages.ts",
  "reads.ts",
  "transport.ts",
]
  .map((file) =>
    readFileSync(
      new URL(`../app/stores/chat/${file}`, import.meta.url),
      "utf8",
    ),
  )
  .join("\n");

test("reconciles a pending message without breaking existing references", () => {
  const pending = {
    id: "pending_client-1",
    created: "2026-07-23T14:30:11.000Z",
    updated: "2026-07-23T14:30:11.000Z",
    status: "pending",
  };
  const duplicate = {
    id: "message-1",
    created: "2026-07-23T14:30:12.000Z",
  };
  const messages = [pending, duplicate];

  const reconciled = reconcileSentMessage(messages, pending.id, {
    id: "message-1",
    room_channel: "channel-1",
    created: "2026-07-23T14:30:12.000Z",
    updated: "2026-07-23T14:30:12.000Z",
  });

  assert.equal(reconciled, pending);
  assert.deepEqual(messages, [pending]);
  assert.equal(pending.id, "message-1");
  assert.equal(pending.room_channel, "channel-1");
  assert.equal("status" in pending, false);
});

test("reconciles realtime delivery by stable client ID before the HTTP response", () => {
  const pending = {
    id: "pending_client-1",
    content: "before edit",
    status: "pending",
  };
  const messages = [pending];

  const result = reconcileIncomingMessage(messages, {
    id: "message-1",
    client_id: "client-1",
    content: "before edit",
  });

  assert.equal(result.inserted, false);
  assert.deepEqual(messages, [
    {
      id: "message-1",
      client_id: "client-1",
      content: "before edit",
    },
  ]);
});

test("edited server content does not reveal a pending duplicate", () => {
  const pending = {
    id: "pending_client-1",
    client_id: "client-1",
    content: "before edit",
    status: "pending",
  };
  const edited = {
    id: "message-1",
    client_id: "client-1",
    content: "after edit",
  };

  assert.equal(isPendingDuplicate(pending, [pending, edited]), true);
});

test("channel hydration drops a pending alias already persisted by the server", () => {
  const serverMessage = {
    id: "message-1",
    client_id: "client-1",
    content: "saved",
  };
  const pending = {
    id: "pending_client-1",
    client_id: "client-1",
    content: "saved",
    status: "pending",
  };

  assert.deepEqual(mergeServerMessagesWithPending([serverMessage], [pending]), [
    serverMessage,
  ]);
});

test("unsend removes a persisted message and its pending alias", () => {
  const messages = [
    {
      id: "message-1",
      client_id: "client-1",
      content: "saved",
    },
    {
      id: "pending_client-1",
      client_id: "client-1",
      content: "saved",
      status: "pending",
    },
  ];

  removeMessageAliases(messages, "message-1");

  assert.deepEqual(messages, []);
});

test("unsend response removes an alias after realtime deletion won the race", () => {
  const messages = [
    {
      id: "pending_client-1",
      client_id: "client-1",
      content: "saved",
      status: "pending",
    },
  ];

  removeMessageAliases(messages, "message-1", "client-1");

  assert.deepEqual(messages, []);
});

test("orphaned pending messages retain the queue ID needed for local cleanup", () => {
  assert.equal(
    pendingMessageClientId({
      id: "pending_client-1",
      status: "pending",
    }),
    "client-1",
  );
});

test("message detail helpers reject absent timestamps and use channel IDs", () => {
  const message = {
    room_channel: "channel-1",
    created: "2026-07-23T14:30:11.000Z",
  };

  assert.equal(isValidMessageTimestamp(message.updated), false);
  assert.equal(hasDistinctUpdatedTimestamp(message), false);
  assert.equal(messageChannelId(message), "channel-1");
  assert.equal(messageChannelId({ room: "obsolete-room" }), "");
});

test("chat GET routes do not attempt to read a request body", () => {
  const api = chatApiSource;
  assert.match(
    api,
    /const body = event\.method === "GET" \? \{\} : await parseBody\(event\);[\s\S]*?if \(suffix === "message"/,
  );
});

test("chat messages preserve attachment and thread metadata end to end", () => {
  const api = chatApiSource;
  const store = chatStoreSource;

  assert.match(
    api,
    /attachments: files\.map\(\(file\) => \(\{[\s\S]*?reply_to:/,
  );
  assert.match(api, /const hasContent = typeof body\.content === "string"/);
  assert.match(api, /validateMessageAttachments\(/);
  assert.match(api, /validateReplyTarget\(/);
  assert.match(store, /attachments,\s+reply_to: replyTo/);
  assert.match(store, /queuedMessage = \{[\s\S]*?attachments,[\s\S]*?replyTo,/);
});

test("multipart uploads are parsed once and background delivery preserves metadata", () => {
  const api = chatApiSource;
  const worker = readFileSync(
    new URL("../public/sw.js", import.meta.url),
    "utf8",
  );
  assert.match(api, /const form = body/);
  assert.doesNotMatch(api, /const form = await parseBody\(event\)/);
  assert.match(worker, /attachments: message\.attachments/);
  assert.match(worker, /replyTo: message\.replyTo/);
});

test("chat image uploads use the CSRF-aware browser fetch path", () => {
  const upload = readFileSync(
    new URL("../app/shared/image-upload.ts", import.meta.url),
    "utf8",
  );

  assert.match(upload, /fetch\(`\$\{path\}\/chat\/upload`/);
  assert.doesNotMatch(upload, /XMLHttpRequest/);
});

test("chat uploads are associated with messages and abandoned files are removable", () => {
  const api = chatApiSource;

  const input = readFileSync(
    new URL("../app/components/Chat/ChatInput.vue", import.meta.url),
    "utf8",
  );

  assert.match(api, /suffix === "upload" && event\.method === "DELETE"/);
  assert.match(api, /messageId[\s\S]*?Image is already attached to a message/);
  assert.match(
    api,
    /\.update\(chatFiles\)[\s\S]*?set\(\{ messageId: created\.id \}\)/,
  );
  assert.match(
    input,
    /uploadedAttachmentIds\.map\(\(id\) => deleteChatFile\(id, apiPath\)\)/,
  );
});

test("chat message actions expose a direct reaction command", () => {
  const actions = readFileSync(
    new URL("../app/components/Chat/MessageActions.vue", import.meta.url),
    "utf8",
  );

  assert.match(actions, />\s*Add reaction\s*</);
  assert.match(actions, /emit\("react", props\.message\)/);
  assert.match(actions, /aria-expanded="isOpen"/);
  assert.match(actions, /role="menu"/);
  assert.match(actions, /handleMenuKeydown/);
  assert.match(actions, /event\.key === "Escape"/);
  assert.match(actions, /min-h-11 min-w-11/);
  assert.doesNotMatch(actions, /<label|btn-xs|shadow-xl/);
});

test("emoji picker reflows at 320px with Metro-sized controls", () => {
  const picker = readFileSync(
    new URL("../app/components/Chat/EmojiPicker.vue", import.meta.url),
    "utf8",
  );
  assert.match(picker, /w-\[min\(320px,calc\(100vw-2rem\)\)\]/);
  assert.doesNotMatch(picker, /w-\[320px\]/);
  assert.doesNotMatch(picker, /rounded-lg|shadow-xl|btn-xs|btn-sm/);
  assert.match(picker, /min-h-11 min-w-11/);
  assert.match(picker, /grid-cols-5/);
  assert.match(picker, /min-\[352px\]:grid-cols-6/);
});

test("thread refresh stays inside the Vue component contract", () => {
  const sidebar = readFileSync(
    new URL("../app/components/Chat/ThreadSidebar.vue", import.meta.url),
    "utf8",
  );
  const window = readFileSync(
    new URL("../app/components/Chat/ChatWindow.vue", import.meta.url),
    "utf8",
  );

  assert.match(sidebar, /defineExpose\(\{ refresh \}\)/);
  assert.doesNotMatch(sidebar, /querySelector|addEventListener|refresh-thread/);
  assert.match(window, /ref="threadSidebar"/);
  assert.match(window, /threadSidebar\.value\?\.refresh\(\)/);
  assert.match(sidebar, /threadRequestGeneration/);
  assert.match(sidebar, /requestGeneration !== threadRequestGeneration/);
});

test("reaction hydration is authorized and batched per channel", () => {
  const api = chatApiSource;
  const window = readFileSync(
    new URL("../app/components/Chat/ChatWindow.vue", import.meta.url),
    "utf8",
  );

  assert.match(api, /messageIds/);
  assert.match(api, /reactionsByMessage/);
  assert.match(window, /messageIds: reactionMessageIds\.join\(","\)/);
  assert.doesNotMatch(window, /window\._reactionLoadTimer/);
  assert.match(window, /reactionChannelGeneration/);
  assert.match(window, /messageReactions\.value = \{\}/);
  assert.match(window, /generation !== reactionChannelGeneration/);
});

test("reaction writes validate and bind client-controlled emoji values", () => {
  const api = chatApiSource;
  assert.match(api, /enforceRateLimit\(event, "chat-reaction"/);
  assert.match(api, /Invalid emoji/);
  assert.match(
    api,
    /eq\(messageReactions\.userId, userId\)[\s\S]*?eq\(messageReactions\.emoji, emoji\)/,
  );
  assert.doesNotMatch(api, /pb\.filter/);
});

test("link previews use bounded redirect-safe outbound HTML fetching", () => {
  const api = chatApiSource;
  const outbound = readFileSync(
    new URL(
      "../server/infrastructure/network/outbound-request.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(api, /fetchPublicHtml\(url/);
  assert.doesNotMatch(api, /const html = await response\.text\(\)/);
  assert.match(outbound, /maxRedirects/);
  assert.match(outbound, /maxBytes/);
  assert.match(outbound, /text\/html/);
});

test("message search binds and validates user-controlled filters", () => {
  const api = chatApiSource;

  assert.match(api, /ilike\(messages\.content/);
  assert.match(api, /Search query must be 200 characters or fewer/);
  assert.match(api, /if \(searchQ\) \{/);
  assert.match(api, /Invalid content filter/);
  assert.match(api, /Invalid author filter/);
  assert.doesNotMatch(api, /const escapedQ = searchQ\.replace/);
  assert.doesNotMatch(api, /pb\.filter\(conditions\.join/);
  const search = readFileSync(
    new URL("../app/components/Chat/MessageSearch.vue", import.meta.url),
    "utf8",
  );
  assert.match(search, /const hasFilters =/);
  assert.match(search, /if \(!searchQuery\.value\.trim\(\) && !hasFilters\)/);
});

test("chat mutations reject failed responses before changing local state", () => {
  const window = readFileSync(
    new URL("../app/components/Chat/ChatWindow.vue", import.meta.url),
    "utf8",
  );

  assert.match(window, /async function requireSuccessfulResponse/);
  assert.match(
    window,
    /await requireSuccessfulResponse\(response, "Reaction failed"\)/,
  );
  assert.match(
    window,
    /await requireSuccessfulResponse\(response, "Bookmark update failed"\)/,
  );
  assert.match(
    window,
    /await requireSuccessfulResponse\(response, "Pin update failed"\)/,
  );
  assert.match(window, /role="alert"[\s\S]*?\{\{ actionError \}\}/);
});

test("message policy is owned by the channel settings modal", () => {
  const window = readFileSync(
    new URL("../app/components/Chat/ChatWindow.vue", import.meta.url),
    "utf8",
  );
  const channelList = readFileSync(
    new URL("../app/components/ChannelList.vue", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(window, /Send permission/);
  assert.match(channelList, /Channel settings[\s\S]*?Message policy/);
  assert.match(channelList, /editingMessagePolicy/);
  assert.match(channelList, /editingSlowMode/);
  assert.match(channelList, /updateChannelPolicy/);
});

test("slow mode rejects concurrent sends before persistence", () => {
  const api = chatApiSource;
  assert.match(api, /validateReplyTarget[\s\S]*?insert\(messages\)/);
  assert.match(api, /enforceRateLimit\([^)]*"chat-slow-mode"/);
});

test("undo send uses the server message timestamp and preserves visible failures", () => {
  const window = readFileSync(
    new URL("../app/components/Chat/ChatWindow.vue", import.meta.url),
    "utf8",
  );
  const undo = readFileSync(
    new URL("../app/components/Chat/UndoSend.vue", import.meta.url),
    "utf8",
  );
  assert.match(window, /new Date\(result\.created\)\.getTime\(\) \+ 3000/);
  assert.match(window, /:expires-at="lastSentUndoExpiresAt"/);
  assert.match(undo, /const remainingMs = props\.expiresAt - Date\.now\(\)/);
  assert.match(undo, /role="alert"[\s\S]*?\{\{ undoError \}\}/);
  assert.doesNotMatch(undo, /finally[\s\S]*?emit\("expired"\)/);
  assert.doesNotMatch(undo, /rounded-lg|shadow-xl|btn-sm/);
});

test("the chat store does not expose stale duplicate mutation paths", () => {
  const store = chatStoreSource;
  assert.doesNotMatch(store, /async function fetchReactions/);
  assert.doesNotMatch(store, /async function toggleReaction/);
  assert.doesNotMatch(store, /async function toggleBookmark/);
  assert.doesNotMatch(store, /async function togglePin/);
});

test("thread replies use the shared chat delivery contract", () => {
  const sidebar = readFileSync(
    new URL("../app/components/Chat/ThreadSidebar.vue", import.meta.url),
    "utf8",
  );

  assert.match(
    sidebar,
    /chatStore\.sendMessage\(props\.channelId, content, \{/,
  );
  assert.match(sidebar, /replyTo: threadParent\.value\.id/);
  assert.doesNotMatch(
    sidebar,
    /fetch\(`\$\{config\.public\.apiPath\}\/chat\/message`/,
  );
  assert.match(sidebar, /role="alert"[\s\S]*?replyError/);
});

test("bookmark access and thread hydration preserve room-scoped message contracts", () => {
  const api = chatApiSource;
  assert.match(api, /accessibleBookmarks/);
  assert.match(api, /requireRoomMember\(room, userId\)/);
  assert.match(api, /enforceRateLimit\(event, "chat-pin"/);
  assert.match(api, /enforceRateLimit\(event, "chat-unpin"/);
  assert.match(api, /enforceRateLimit\(event, "chat-bookmark"/);
  assert.match(api, /parent: parentShown,/);
  assert.match(api, /replies: replyShown,/);
});

test("message images and thread layout remain keyboard and reflow accessible", () => {
  const message = readFileSync(
    new URL("../app/components/Chat/ChatMessage.vue", import.meta.url),
    "utf8",
  );
  const sidebar = readFileSync(
    new URL("../app/components/Chat/ThreadSidebar.vue", import.meta.url),
    "utf8",
  );
  const window = readFileSync(
    new URL("../app/components/Chat/ChatWindow.vue", import.meta.url),
    "utf8",
  );

  assert.match(
    message,
    /<button[\s\S]*?:aria-label="`Open image: \$\{att\.name/,
  );
  assert.match(message, /metro-message-attachment-img/);
  assert.match(sidebar, /fixed inset-0[\s\S]*?md:static/);
  assert.match(window, /flex-1 min-w-0 flex flex-col/);
});

test("message reactions and thread link share one compact footer row", () => {
  const message = readFileSync(
    new URL("../app/components/Chat/ChatMessage.vue", import.meta.url),
    "utf8",
  );

  assert.match(message, /class="metro-message-engagement"/);
  assert.match(message, /class="metro-message-engagement[\s\S]*?metro-react/);
  assert.match(message, /class="metro-thread-link/);
  assert.doesNotMatch(message, /class="chat-footer mt-1 flex flex-wrap gap-1"/);
  assert.doesNotMatch(message, /class="chat-footer mt-1 flex min-h-11/);
});

test("broadcast mentions require moderation permission", () => {
  const api = chatApiSource;

  assert.match(api, /messageContainsBroadcastMention\(content/);
  assert.match(api, /Missing permission to mention everyone or here/);
  assert.match(api, /access\.permissions\?\.includes\("message\.moderate"\)/);
});

test("pin state is synchronized through the realtime store contract", () => {
  const api = chatApiSource;
  const store = chatStoreSource;
  const window = readFileSync(
    new URL("../app/components/Chat/ChatWindow.vue", import.meta.url),
    "utf8",
  );

  assert.match(api, /type: "message_unpinned",[\s\S]*?channelId/);
  assert.match(store, /case "message_pinned":[\s\S]*?case "message_unpinned":/);
  assert.match(
    store,
    /updateMessage\(\{[\s\S]*?id: data\.data\.messageId,[\s\S]*?pinned:/,
  );
  assert.match(store, /pinChanged/);
  assert.match(
    window,
    /chatStore\.pinChanged[\s\S]*?pinnedMessages\.value\?\.refresh/,
  );
  assert.match(window, /ref="pinnedMessages"/);
});

test("pin records and message state mutate through Drizzle transactions", () => {
  const api = chatApiSource;
  assert.match(api, /insert\(pinnedMessages\)/);
  assert.match(
    api,
    /insert\(pinnedMessages\)[\s\S]*?update\(messages\)[\s\S]*?set\(\{ pinned: true \}\)/,
  );
  assert.doesNotMatch(api, /createBatch/);
});

test("chat action dialogs trap focus and restore message actions", () => {
  const window = readFileSync(
    new URL("../app/components/Chat/ChatWindow.vue", import.meta.url),
    "utf8",
  );
  const actions = readFileSync(
    new URL("../app/components/Chat/MessageActions.vue", import.meta.url),
    "utf8",
  );
  assert.match(actions, /data-message-actions-trigger/);
  assert.match(window, /ref="actionDialog"/);
  assert.match(window, /@keydown="handleActionDialogKeydown"/);
  assert.match(window, /event\.key !== "Tab"/);
  assert.match(window, /event\.key === "Escape"/);
  assert.match(window, /actionReturnFocus\?\.focus\(\)/);
  assert.match(window, /actionFirstControl\.value\?\.focus\(\)/);
});

test("chat API errors expose a user-facing message without the server stack", () => {
  const response = JSON.stringify({
    statusCode: 405,
    statusMessage: "HTTP method is not allowed.",
    stack: ["private stack"],
  });

  assert.equal(
    chatApiErrorMessage(response, 405),
    "HTTP method is not allowed.",
  );
});

test("API error parsing never falls back to a server stack from structured errors", () => {
  const response = JSON.stringify({
    statusCode: 400,
    stack: ["private stack"],
  });

  assert.equal(
    apiErrorMessage(response, 400, "Friend request failed"),
    "Friend request failed (400)",
  );
});

test("API error parsing preserves a plain user-facing response", () => {
  assert.equal(
    apiErrorMessage("Friend request already pending", 400),
    "Friend request already pending",
  );
});

test("API error parsing replaces an unstructured stack trace with a safe fallback", () => {
  assert.equal(
    apiErrorMessage(
      "Error: database failed\n    at handler (server.ts:10:2)",
      500,
    ),
    "Request failed (500)",
  );
});
