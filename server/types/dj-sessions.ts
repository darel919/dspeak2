import type { ChildProcess } from "node:child_process";

export interface DjBridge {
  rtpPort: number;
  close: () => void;
  waitForRtp: () => Promise<void>;
}

export interface DjSession {
  id: string;
  token: string;
  path: string;
  userId: string;
  channelId: string;
  status: "waiting" | "connecting" | "recovering" | "live" | "stopped";
  error: string | null;
  bridge: DjBridge | null;
  process: ChildProcess | null;
  recoveryTimer: ReturnType<typeof setTimeout> | null;
  recoveryDeadline: number | null;
  expiryTimer: ReturnType<typeof setTimeout> | null;
  expiresAt: number;
  directUrl: string;
  fallbackUrl: string;
}

export interface DjState {
  sessions: Map<string, DjSession>;
  userSessions: Map<string, string>;
  channelSessions: Map<string, string>;
}

export interface DjIngestPayload {
  action?: string;
  protocol?: string;
  path?: string;
  user?: string;
  password?: string;
  token?: string;
  ip?: string;
}
