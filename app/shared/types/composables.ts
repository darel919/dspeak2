export type ChatMessageInput = Record<string, unknown> & {
  sender?: { id?: string } | null;
  created?: string | number | Date;
};
export type ChatUserInput = { id: string; name?: string; email?: string };
export type ShortcutBinding = {
  id: string;
  keys: string[];
  scope?: string;
  handler: (event: KeyboardEvent) => boolean | void;
};
export type NavigationCause = Record<string, unknown> & {
  statusCode?: number;
  status?: number;
  response?: { status?: number };
  data?: { statusCode?: number };
};
export type RoomAppearanceRecord = { accent?: string };
export type UnreadCountRecord = { unreadCount?: number };
export type AppearanceInput = {
  surfaceMode?: "system" | "light" | "dark";
  accent?: string;
};
