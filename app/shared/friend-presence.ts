import { normalizePresenceStatus } from "../../shared/presence-status.ts";

export function resolveFriendPresence(friend, trackedStatus) {
  const fallbackStatus =
    friend?.presence_status || (friend?.online ? "online" : "offline");
  const presenceStatus = normalizePresenceStatus(
    trackedStatus?.status || fallbackStatus,
  );

  return {
    ...friend,
    online: presenceStatus !== "offline",
    presence_status: presenceStatus,
  };
}

export function resolveFriendsPresence(friends, trackedUsers) {
  return friends.map((friend) =>
    resolveFriendPresence(friend, trackedUsers.get(String(friend.id))),
  );
}
