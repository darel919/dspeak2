export interface ChannelMediaPolicy {
  revision?: number | string;
  sharedAudioKbps?: number | string | null;
  microphoneKbps?: number | string | null;
  hdAudio?: boolean;
  [key: string]: unknown;
}

export interface ChannelRecord {
  id: string;
  name?: string;
  desc?: string;
  isMedia?: boolean;
  inRoom: string[];
  mediaPolicy?: ChannelMediaPolicy | null;
  participantStates?: Record<string, Record<string, unknown>>;
  policy?: string;
  slow_mode?: number;
  isModerator?: boolean;
  isAdmin?: boolean;
  isOwner?: boolean;
  [key: string]: unknown;
}

export interface ChannelInput {
  name: string;
  desc?: string;
  isMedia?: boolean;
  mediaPolicy?: ChannelMediaPolicy | null;
}

export interface FetchChannelsOptions {
  activate?: boolean;
  force?: boolean;
}

export interface VoicePresenceSnapshot {
  channelId: string;
  inRoom: Array<string | number>;
  participantStates?: Array<Record<string, unknown>>;
  profiles?: Array<Record<string, unknown> & { id?: string | number }>;
  [key: string]: unknown;
}

export interface VoicePresenceConnection {
  channel: import("../realtime-channel.ts").RealtimeChannelLike | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectAttempt: number;
  intentionalClose: boolean;
  connecting: boolean;
  close?: () => void;
}

export interface ChannelPolicyUpdate {
  policy?: string;
  slowMode?: number;
}
