import { normalizePresenceStatus } from "../../shared/presence-status.ts";

interface FriendRecord {
  id?: string | number | null;
  presence_status?: string | null;
  online?: boolean;
  [key: string]: unknown;
}

interface TrackedPresence {
  status?: string;
}

export function resolveFriendPresence(
  friend: FriendRecord,
  trackedStatus?: TrackedPresence,
) {
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

export function resolveFriendsPresence(
  friends: FriendRecord[],
  trackedUsers: Map<string, TrackedPresence>,
) {
  return friends.map((friend) =>
    resolveFriendPresence(friend, trackedUsers.get(String(friend.id))),
  );
}
