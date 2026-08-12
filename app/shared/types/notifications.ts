export interface NotificationRecord {
  id: string;
  read_at?: string | null;
  senderId?: string | number;
  sender?: { name?: string } | string | null;
  title?: string;
  body?: string;
  content?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface NotificationPreferences {
  mode: "all" | "none" | string;
  push: boolean;
  sound: boolean;
  previews: boolean;
}

export interface NotificationFetchOptions extends RequestInit {
  headers?: Record<string, string>;
}

export interface NotificationRealtimePayload {
  type?: string;
  data?: NotificationRecord & { ids?: string[] };
}
