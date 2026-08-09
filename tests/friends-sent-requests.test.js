import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const storeSource = await readFile(
  new URL("../app/stores/friends.js", import.meta.url),
  "utf8",
);
const pageSource = await readFile(
  new URL("../app/pages/friends.vue", import.meta.url),
  "utf8",
);
const managerSource = await readFile(
  new URL("../server/utils/friends-manager.js", import.meta.url),
  "utf8",
);
const memberListSource = await readFile(
  new URL("../app/components/MemberList.vue", import.meta.url),
  "utf8",
);
const routeSource = await readFile(
  new URL("../server/routes/api/friends/index.js", import.meta.url),
  "utf8",
);

test("sending a friend request immediately adds the canonical request to Sent", () => {
  assert.match(
    storeSource,
    /sentRequests\.value = \[[\s\S]{0,80}result,[\s\S]{0,80}\.\.\.sentRequests\.value\.filter\(/,
  );
  assert.doesNotMatch(
    pageSource,
    /await friendsStore\.sendRequest\(handle\);[\s\S]{0,200}await friendsStore\.fetchSentRequests\(\);/,
  );
});

test("resending an existing outgoing request returns its canonical pending record", () => {
  assert.doesNotMatch(
    managerSource,
    /throw new Error\("Friend request already pending"\)/,
  );
  assert.match(
    managerSource,
    /existingFriendship\.status === "pending"[\s\S]{0,700}status: existingFriendship\.status/,
  );
});

test("declining a request removes the row so it can be sent again", () => {
  assert.match(
    managerSource,
    /if \(accept\)[\s\S]{0,220}else await db\.delete\(friends\)/,
  );
  assert.match(
    managerSource,
    /existingFriendship\.status === "rejected"[\s\S]{0,140}delete\(friends\)/,
  );
});

test("friend response parsing does not treat the string false as acceptance", () => {
  assert.match(routeSource, /accept === true \|\| accept === "true"/);
  assert.doesNotMatch(routeSource, /Boolean\(accept\)/);
});

test("a failed Sent refresh preserves confirmed requests and exposes the error", () => {
  assert.doesNotMatch(
    storeSource,
    /async function fetchSentRequests\(\)[\s\S]{0,400}catch \{[\s\S]{0,80}return \[\];/,
  );
  assert.match(
    storeSource,
    /async function fetchSentRequests\(\)[\s\S]{0,500}error\.value = cause\.message;[\s\S]{0,120}throw cause;/,
  );
});

test("Sent request avatars use the protected same-origin asset path", () => {
  assert.match(managerSource, /avatar: sameOriginAvatarPath\(recipient\)/);
  assert.match(
    pageSource,
    /<ProfileAvatar[\s\S]{0,180}:src="req\.recipient\?\.avatar"/,
  );
});

test("Sent persistence lookup uses Drizzle queries", () => {
  assert.match(
    managerSource,
    /import \{[^}]*inArray[^}]*\} from "drizzle-orm";/,
  );
  assert.match(
    managerSource,
    /getSentFriendRequests[\s\S]{0,500}from\(friends\)/,
  );
  assert.match(managerSource, /eq\(friends\.status, "pending"\)/);
  assert.match(managerSource, /sameOriginAvatarPath\(recipient\)/);

  assert.doesNotMatch(managerSource, /getBoundedList/);
});

test("room member rows do not display friend request status", () => {
  assert.doesNotMatch(memberListSource, /friendRequestLabel\(member\)/);
  assert.doesNotMatch(memberListSource, /Request sent/);
  assert.doesNotMatch(memberListSource, /Respond to request/);
  assert.doesNotMatch(memberListSource, /friendsStore\.fetchSentRequests\(\)/);
  assert.doesNotMatch(
    memberListSource,
    /friendsStore\.fetchFriendRequests\(\)/,
  );
});
