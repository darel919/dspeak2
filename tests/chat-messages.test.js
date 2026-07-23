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
} from "../app/shared/chat-messages.js";
import { readFileSync } from "node:fs";

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
  assert.equal(messageChannelId({ room: "legacy-room" }), "legacy-room");
});

test("chat GET routes do not attempt to read a request body", () => {
  const api = readFileSync(
    new URL("../server/utils/dspeak-api.js", import.meta.url),
    "utf8",
  );
  assert.match(
    api,
    /const body = event\.method === "GET" \? \{\} : await parseBody\(event\);\s+if \(suffix === "message"/,
  );
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
