export const PRESENCE_STATUSES = ["online", "idle", "dnd", "offline"] as const;

export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];

export interface PresenceUpdateOptions {
  timestamp?: string | number | Date;
  isManualOverride?: boolean;
  platform?: string;
}
