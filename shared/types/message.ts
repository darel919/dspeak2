export type MessageLike = {
  id?: unknown;
  sender?: { id?: unknown } | string | null;
};
export type ChatMessageRecord = MessageLike & {
  client_id?: string;
  status?: string;
  error?: unknown;
  updated?: string | number | Date;
  created?: string | number | Date;
  room_channel?: string;
  [key: string]: unknown;
};
