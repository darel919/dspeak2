import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { extractInviteLink } from "../app/shared/room-invite-link.ts";

test("invite link extraction accepts only a complete same-app join link", () => {
  const invite = extractInviteLink(
    "https://dspeak.example/join/invite-token.",
    "https://dspeak.example",
  );

  assert.deepEqual(invite, {
    token: "invite-token",
    url: "https://dspeak.example/join/invite-token",
  });
  assert.equal(
    extractInviteLink(
      "https://other.example/join/invite-token",
      "https://dspeak.example",
    ),
    null,
  );
  assert.equal(
    extractInviteLink(
      "Join us: https://dspeak.example/join/invite-token",
      "https://dspeak.example",
    ),
    null,
  );
});

test("room invite UI sends links to friends and renders accepted invites", async () => {
  const [dialog, chatMessage, directMessages, inviteCard] = await Promise.all([
    readFile(
      new URL("../app/components/RoomInviteDialog.vue", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/components/Chat/ChatMessage.vue", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/pages/messages.vue", import.meta.url), "utf8"),
    readFile(
      new URL("../app/components/Chat/InviteLinkCard.vue", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(dialog, /Invite friends/);
  assert.match(dialog, /friendsWithPresence/);
  assert.match(dialog, /directMessagesStore\.openConversation/);
  assert.match(
    dialog,
    /directMessagesStore\.sendMessage\(generatedLink\.value\)/,
  );
  assert.match(dialog, /Or, copy an invite link/);
  assert.match(chatMessage, /<InviteLinkCard v-if="inviteLink"/);
  assert.match(chatMessage, /inviteLink\.value/);
  assert.match(directMessages, /<InviteLinkCard/);
  assert.match(directMessages, /conversationPreview/);
  assert.doesNotMatch(
    directMessages,
    /<div class="direct-message-bubble">\s*\{\{ message\.content \}\}/,
  );
  assert.match(inviteCard, /Accept invite/);
  assert.match(inviteCard, /room\/invites/);
  assert.match(inviteCard, /roomsStore\.joinRoom/);
});
