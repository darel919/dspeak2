const presenceStateKey = Symbol.for("dspeak.user-presence");

function getPresenceState() {
  if (!globalThis[presenceStateKey]) {
    globalThis[presenceStateKey] = {
      statuses: new Map(),
      lastActivity: new Map(),
      idleTimers: new Map(),
      autoAway: new Map(),
    };
  }
  return globalThis[presenceStateKey];
}

export function setUserPresence(
  userId,
  status,
  { clientTimestamp, idleTimeoutMs, isManualOverride } = {},
) {
  const state = getPresenceState();
  state.statuses.set(String(userId), {
    status,
    updatedAt: clientTimestamp || new Date().toISOString(),
    isManualOverride: Boolean(isManualOverride),
  });
  if (status === "online" || status === "dnd") {
    state.lastActivity.set(String(userId), Date.now());
    state.autoAway.set(String(userId), idleTimeoutMs || 5 * 60 * 1000);
  } else if (status === "idle") {
    // noop
  } else if (status === "offline") {
    state.lastActivity.delete(String(userId));
    state.autoAway.delete(String(userId));
  }
}

export function getUserPresence(userId) {
  const state = getPresenceState();
  const record = state.statuses.get(String(userId));
  return (
    record || { status: "offline", updatedAt: null, isManualOverride: false }
  );
}

export function getAllOnlineUsers() {
  const state = getPresenceState();
  const result = [];
  for (const [userId, record] of state.statuses) {
    if (record.status !== "offline") {
      result.push({ userId, ...record });
    }
  }
  return result;
}

export function touchUserActivity(userId) {
  const state = getPresenceState();
  if (!state.statuses.has(String(userId))) return;
  const record = state.statuses.get(String(userId));
  if (record.isManualOverride && record.status === "dnd") return;
  if (record.isManualOverride && record.status === "idle") return;
  state.lastActivity.set(String(userId), Date.now());
  if (record.status === "idle") {
    record.status = "online";
    record.updatedAt = new Date().toISOString();
  }
}

export async function checkAndTransitionIdleUsers() {
  const state = getPresenceState();
  const now = Date.now();

  for (const [userId, lastActive] of state.lastActivity) {
    const record = state.statuses.get(userId);
    if (!record) continue;
    if (record.isManualOverride) continue;
    if (record.status !== "online") continue;

    const idleTimeout = state.autoAway.get(userId) || 5 * 60 * 1000;
    if (now - lastActive >= idleTimeout) {
      record.status = "idle";
      record.updatedAt = new Date().toISOString();
    }
  }
}

export function setUserOfflineOnDisconnect(userId) {
  const state = getPresenceState();
  state.statuses.delete(String(userId));
  state.lastActivity.delete(String(userId));
  state.autoAway.delete(String(userId));
}

export function isUserOnline(userId) {
  const state = getPresenceState();
  const record = state.statuses.get(String(userId));
  return record && record.status !== "offline";
}

export function getAllActiveUserIds() {
  const state = getPresenceState();
  const active = [];
  for (const [userId, record] of state.statuses) {
    if (record.status !== "offline") {
      active.push(userId);
    }
  }
  return active;
}
