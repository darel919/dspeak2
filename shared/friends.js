export const FRIEND_REQUEST_STATUSES = Object.freeze({
  pending: "pending",
  accepted: "accepted",
  rejected: "rejected",
  blocked: "blocked",
});

export function normalizeFriendRequestStatus(value) {
  return Object.values(FRIEND_REQUEST_STATUSES).includes(value)
    ? value
    : FRIEND_REQUEST_STATUSES.pending;
}
