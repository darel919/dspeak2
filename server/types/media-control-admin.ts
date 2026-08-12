export interface MediaControlRequestOptions extends RequestInit {
  headers?: Record<string, string>;
}

export interface MediaControlParticipantsResponse {
  participants?: Array<{ userId?: unknown }>;
}

export interface MediaControlModerationResponse {
  affected?: unknown;
}
