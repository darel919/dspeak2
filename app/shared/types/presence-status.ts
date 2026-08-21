import { isExternalRecord, isExternalString } from "./boundary.ts";
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

export function isPresenceRecord<T>(value: T): value is T & PresenceRecord {
  return isExternalRecord(value);
}

export function parsePresenceChannelMessage<T>(
  value: T,
): PresenceChannelMessage | null {
  if (!isExternalRecord(value)) return null;
  const data = Array.isArray(value.data)
    ? value.data.filter(isPresenceRecord)
    : isPresenceRecord(value.data)
      ? value.data
      : undefined;
  return {
    type: isExternalString(value.type) ? value.type : undefined,
    data,
  };
}
