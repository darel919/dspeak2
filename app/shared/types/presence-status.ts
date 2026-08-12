import type { PresenceRecord } from "./presence.ts";
import type { PresenceStatus } from "../../../shared/types/presence.ts";
import type { RealtimeChannelLike } from "../realtime-channel.ts";

export type PresencePlatform =
  "web" | "macos" | "windows" | "linux" | "desktop";

export interface PresencePayload {
  status: PresenceStatus;
  manual: boolean;
  timestamp: string;
  platform: PresencePlatform;
}

export interface PresenceActivityTimer {
  events: string[];
  handler: (event: Event) => void;
}

export interface PresenceStoreUser extends Omit<PresenceRecord, "updatedAt"> {
  status: PresenceStatus;
  updatedAt?: string | number | Date | null;
  isManualOverride: boolean;
  platform?: PresencePlatform | string | null;
}

export interface PresenceChannelMessage {
  type?: string;
  data?: PresenceRecord | PresenceRecord[];
}

export type PresenceChannel = RealtimeChannelLike;

export function isPresenceRecord(value: unknown): value is PresenceRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
