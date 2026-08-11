import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const roomsApi = await readFile(
  new URL("../server/utils/dspeak-rooms-api.ts", import.meta.url),
  "utf8",
);
const joinPage = await readFile(
  new URL("../app/pages/join/[roomId].vue", import.meta.url),
  "utf8",
);

test("invite previews are public while room operations remain authenticated", () => {
  const preview = roomsApi.indexOf(
    'if (suffix === "invites" && method === "GET")',
  );
  const authentication = roomsApi.indexOf(
    "const userId = await requireAuthenticatedUser(event);",
  );

  assert.ok(preview >= 0);
  assert.ok(authentication > preview);
  assert.match(roomsApi, /room-invite-preview/);
  assert.match(roomsApi, /inviteMatchesPayload/);
});

test("anonymous invite visitors see the preview and authenticate on acceptance", () => {
  const loadInviteStart = joinPage.indexOf("async function loadInvite()");
  const loadInviteEnd = joinPage.indexOf(
    "async function checkAuthentication()",
  );
  const loadInvite = joinPage.slice(loadInviteStart, loadInviteEnd);

  assert.ok(loadInviteStart >= 0);
  assert.ok(loadInviteEnd > loadInviteStart);
  assert.doesNotMatch(loadInvite, /router\.push\("\/auth"\)/);
  assert.match(joinPage, /Sign in to accept the invitation and join the room/);
  assert.match(joinPage, /sessionStorage\.setItem\("redirectAfterAuth"/);
  assert.match(joinPage, /sessionStorage\.setItem\(pendingInviteJoinKey/);
  assert.match(joinPage, /consumePendingInviteJoin/);
});
