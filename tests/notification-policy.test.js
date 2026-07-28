import assert from "node:assert/strict";
import test from "node:test";
import {
  isMessageNotificationEligible,
  messageContainsBroadcastMention,
  messageMentionsHandle,
  notificationBody,
  resolveNotificationPreference,
} from "../shared/notification-policy.js";
import {
  isDeviceViewingChannel,
  isUserViewingChannel,
  setDeviceViewingChannel,
} from "../server/utils/dspeak-realtime.js";

test("room notification preferences override only explicit room values", () => {
  assert.deepEqual(
    resolveNotificationPreference(
      { mode: "mentions", push: true, sound: false, previews: false },
      { mode: "all", push: null, sound: true },
    ),
    {
      mode: "all",
      push: true,
      sound: true,
      previews: false,
    },
  );
});

test("mention matching uses complete normalized handles", () => {
  assert.equal(messageMentionsHandle("Hello @Darel-Isme!", "darel-isme"), true);
  assert.equal(
    messageMentionsHandle("Hello @darel-isme2", "darel-isme"),
    false,
  );
  assert.equal(messageMentionsHandle("mail@example.com", "example"), false);
});

test("message eligibility enforces muted and mentions modes", () => {
  assert.equal(
    isMessageNotificationEligible({
      preference: { mode: "muted" },
      content: "@darel hello",
      recipientHandle: "darel",
    }),
    false,
  );
  assert.equal(
    isMessageNotificationEligible({
      preference: { mode: "mentions" },
      content: "@darel hello",
      recipientHandle: "darel",
    }),
    true,
  );
  assert.equal(
    isMessageNotificationEligible({
      preference: { mode: "mentions" },
      content: "hello",
      recipientHandle: "darel",
    }),
    false,
  );
});

test("everyone and here mentions use complete tokens and respect notification modes", () => {
  assert.equal(
    messageContainsBroadcastMention("Hello @everyone!", "everyone"),
    true,
  );
  assert.equal(
    messageContainsBroadcastMention("Hello @everyone2", "everyone"),
    false,
  );
  assert.equal(messageContainsBroadcastMention("Hello @here", "here"), true);
  assert.equal(
    isMessageNotificationEligible({
      preference: { mode: "mentions" },
      content: "Hello @everyone",
      recipientHandle: "unmentioned-user",
      broadcastMention: true,
    }),
    true,
  );
  assert.equal(
    isMessageNotificationEligible({
      preference: { mode: "muted" },
      content: "Hello @everyone",
      recipientHandle: "unmentioned-user",
      broadcastMention: true,
    }),
    false,
  );
});

test("disabled previews never expose sender or message content", () => {
  assert.equal(
    notificationBody({
      previews: false,
      senderName: "Private Sender",
      content: "Private message",
    }),
    "You have a new message.",
  );
});

test("active-channel suppression is reference counted per device", () => {
  setDeviceViewingChannel("policy-user", "policy-device", "channel-one");
  setDeviceViewingChannel("policy-user", "policy-device", "channel-one");
  assert.equal(
    isDeviceViewingChannel("policy-user", "policy-device", "channel-one"),
    true,
  );
  setDeviceViewingChannel("policy-user", "policy-device", "channel-one", false);
  assert.equal(
    isDeviceViewingChannel("policy-user", "policy-device", "channel-one"),
    true,
  );
  setDeviceViewingChannel("policy-user", "policy-device", "channel-one", false);
  assert.equal(
    isDeviceViewingChannel("policy-user", "policy-device", "channel-one"),
    false,
  );
  assert.equal(isUserViewingChannel("policy-user", "channel-one"), false);
});
