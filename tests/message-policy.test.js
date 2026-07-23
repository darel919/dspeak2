import test from "node:test";
import assert from "node:assert/strict";
import {
  canDeleteMessage,
  canEditMessage,
  canViewMessageHistory,
} from "../shared/message-policy.js";

const message = { id: "message-one", sender: { id: "author" } };

test("only a persisted message owner can edit a message", () => {
  assert.equal(canEditMessage(message, "author"), true);
  assert.equal(canEditMessage(message, "moderator"), false);
  assert.equal(
    canEditMessage({ ...message, id: "pending_local" }, "author"),
    false,
  );
});

test("owners can unsend and moderators can delete another user's message", () => {
  assert.equal(canDeleteMessage(message, "author"), true);
  assert.equal(
    canDeleteMessage(message, "moderator", ["message.moderate"]),
    true,
  );
  assert.equal(canDeleteMessage(message, "member"), false);
});

test("revision history requires room ownership or moderation permission", () => {
  assert.equal(canViewMessageHistory(["message.moderate"]), true);
  assert.equal(canViewMessageHistory([], true), true);
  assert.equal(canViewMessageHistory([]), false);
});
