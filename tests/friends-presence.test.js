import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  resolveFriendPresence,
  resolveFriendsPresence,
} from "../app/shared/friend-presence.js";

test("friend rows use live presence status over the API fallback", () => {
  const friend = {
    id: "friend-1",
    online: false,
    presence_status: "offline",
  };

  assert.deepEqual(resolveFriendPresence(friend, { status: "dnd" }), {
    ...friend,
    online: true,
    presence_status: "dnd",
  });
});

test("offline realtime updates override a previously online friend", () => {
  const friend = {
    id: "friend-1",
    online: true,
    presence_status: "online",
  };

  assert.deepEqual(resolveFriendPresence(friend, { status: "offline" }), {
    ...friend,
    online: false,
    presence_status: "offline",
  });
});

test("friends without a live entry retain the API presence fallback", () => {
  const friends = [
    { id: "online-friend", online: true, presence_status: "online" },
    { id: "offline-friend", online: false, presence_status: "offline" },
  ];

  assert.deepEqual(resolveFriendsPresence(friends, new Map()), friends);
});

test("friends views render the reactive presence projection", async () => {
  const [page, dropdown] = await Promise.all([
    readFile(new URL("../app/pages/friends.vue", import.meta.url), "utf8"),
    readFile(
      new URL("../app/components/FriendsList.vue", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(page, /friendsWithPresence/);
  assert.match(dropdown, /friendsWithPresence/);
  assert.doesNotMatch(page, /storeToRefs\(friendsStore\).*friends,/s);
  assert.doesNotMatch(dropdown, /storeToRefs\(friendsStore\).*friends,/s);
});
