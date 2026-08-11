import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeInvitePayload,
  encodeInvitePayload,
  validateInviteExpiry,
} from "../shared/room-invite.ts";

test("invite payload round-trips all attribution fields", () => {
  const payload = {
    id: "invite-1",
    createdBy: "user-1",
    createdAt: "2026-07-23T10:00:00.000Z",
    expiresAt: "2026-07-24T10:00:00.000Z",
    roomId: "room-1",
  };
  assert.deepEqual(decodeInvitePayload(encodeInvitePayload(payload)), payload);
});

test("invalid invite data and unsupported expiries are rejected", () => {
  assert.equal(decodeInvitePayload("not-base64-json"), null);
  assert.equal(validateInviteExpiry(60 * 60), 60 * 60);
  assert.equal(validateInviteExpiry(123), null);
});
