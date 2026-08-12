export const FRIEND_REQUEST_STATUSES = Object.freeze({
  pending: "pending",
  accepted: "accepted",
  rejected: "rejected",
  blocked: "blocked",
});

function isFriendRequestStatus(value: unknown): value is FriendRequestStatus {
  return (
    value === FRIEND_REQUEST_STATUSES.pending ||
    value === FRIEND_REQUEST_STATUSES.accepted ||
    value === FRIEND_REQUEST_STATUSES.rejected ||
    value === FRIEND_REQUEST_STATUSES.blocked
  );
}

export function normalizeFriendRequestStatus(value: unknown) {
  return isFriendRequestStatus(value) ? value : FRIEND_REQUEST_STATUSES.pending;
}
import type { FriendRequestStatus } from "./types/friends.ts";
