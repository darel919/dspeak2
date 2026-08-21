export const PRESENCE_STATUSES = Object.freeze([
  "online",
  "idle",
  "dnd",
  "offline",
]);

export const PRESENCE_LABELS = Object.freeze({
  online: "Online",
  idle: "Idle",
  dnd: "Do Not Disturb",
  offline: "Offline",
});

export const PRESENCE_ORDER = Object.freeze({
  online: 0,
  idle: 1,
  dnd: 2,
  offline: 3,
});

export const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
export const MIN_IDLE_TIMEOUT_MS = 60 * 1000;
export const MAX_IDLE_TIMEOUT_MS = 60 * 60 * 1000;
export const DEFAULT_IDLE_TIMEOUT_KEY = "dspeak:idleTimeout";
export const DEFAULT_PRESENCE_KEY = "dspeak:presenceOverride";

import { parseExternalNumber, type ExternalField } from "./types/external.ts";

export function normalizePresenceStatus(value: ExternalField): PresenceStatus {
  return value === "online" ||
    value === "idle" ||
    value === "dnd" ||
    value === "offline"
    ? value
    : "online";
}

export function resolveAutomaticPresence(
  manualStatus: ExternalField,
  automaticStatus: ExternalField,
) {
  return manualStatus
    ? normalizePresenceStatus(manualStatus)
    : normalizePresenceStatus(automaticStatus);
}

export function normalizeIdleTimeout(value: ExternalField) {
  const numeric = parseExternalNumber(value);
  return numeric !== null
    ? Math.min(MAX_IDLE_TIMEOUT_MS, Math.max(MIN_IDLE_TIMEOUT_MS, numeric))
    : DEFAULT_IDLE_TIMEOUT_MS;
}

export function presenceSortKey(status: ExternalField) {
  return PRESENCE_ORDER[normalizePresenceStatus(status)] ?? 99;
}
import type { PresenceStatus } from "./types/presence.ts";
