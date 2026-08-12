export interface DirectMessageSender {
  id: string;
  name?: string;
  display_name?: string;
  username?: string;
  avatar?: string;
  [key: string]: unknown;
}

export interface DirectMessage {
  id: string;
  conversation_id: string;
  content: string;
  sender: DirectMessageSender;
  created: string;
  client_id?: string;
  read_at?: string | null;
  delivered_at?: string | null;
  status?: "pending" | "failed";
  error?: string;
  [key: string]: unknown;
}

export interface DirectConversation {
  id: string;
  unread_count: number;
  last_message?: DirectMessage;
  updated_at?: string;
  friend?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface DirectMessageApiResponse extends Record<string, unknown> {
  items?: unknown;
  id?: string;
  friend?: Record<string, unknown>;
}

export interface DirectMessageFetchOptions extends RequestInit {
  headers?: Record<string, string>;
}

export interface DirectMessageRealtimePayload {
  type?: string;
  data?: {
    conversation_id?: string;
    message_ids?: unknown;
    delivered_at?: string | null;
    read_at?: string | null;
    message?: DirectMessage;
  };
}
