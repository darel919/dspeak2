import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDocumentTitle } from "../app/shared/document-title.js";

test("document title describes channel, room, and unread count", () => {
  assert.equal(
    buildDocumentTitle({
      room: { name: "Design" },
      channel: { name: "general", isMedia: false },
      unreadCount: 3,
    }),
    "(3) #general · Design · dSpeak",
  );
});

test("utility titles use stable labels", () => {
  assert.equal(
    buildDocumentTitle({ routeName: "settings" }),
    "Settings · dSpeak",
  );
});
