import type { H3Event } from "h3";
import type { InferSelectModel } from "drizzle-orm";
import type { messages, profiles } from "../db/schema/index.ts";
import type { RoomMemberAccess } from "./room-authorization.ts";
import type { PushNotificationInput } from "./push-delivery.ts";
import type { MessageLike } from "../../shared/types/message.ts";
import type { DSpeakProfileInput, DSpeakProfileRow } from "./dspeak-api.ts";
import type { AuthorizationRoom } from "./room-authorization.ts";

export type ChatMessageRow = InferSelectModel<typeof messages>;
export type ChatProfileRow = InferSelectModel<typeof profiles>;
export type ChatRouteBody = Record<string, unknown>;
export type ChatRouteHandler = (
  event: H3Event,
  suffix: string,
  userId: string,
  body: ChatRouteBody,
) => Promise<unknown>;
export interface ChatAttachmentRecord {
  id: string;
  url: string;
  name: string | null | undefined;
  size: number | null | undefined;
  mime_type: string | null | undefined;
  width: number;
  height: number;
}

export interface ChatAttachmentFile {
  id: string;
  uploaderId?: string;
  uploader?: string;
  channelId?: string | null;
  room_channel?: string | null;
  messageId?: string | null;
  fileName?: string | null;
  name?: string | null;
  mimeType?: string | null;
  mime_type?: string | null;
  size?: number | null;
}

export interface ChatApiDependencies {
  assertSafeOutboundUrl: (
    value: string,
    options?: { allowedHosts?: readonly string[] },
  ) => Promise<URL>;
  broadcastToChannel: (
    channelId: string | number,
    message: unknown,
  ) => Promise<void>;
  broadcastToUser: (
    userId: string,
    message: Record<string, unknown>,
  ) => unknown;
  canDeleteMessage: (
    message: MessageLike | null | undefined,
    userId: unknown,
    permissions?: readonly string[],
    isRoomOwner?: boolean,
  ) => boolean;
  canViewMessageHistory: (
    permissions?: readonly string[],
    isRoomOwner?: boolean,
  ) => boolean;
  createError: (options: {
    statusCode: number;
    statusMessage: string;
  }) => Error;
  enforceRateLimit: (
    event: H3Event,
    scope: string,
    identity: string | null | undefined,
    limit: number,
    windowMs: number,
  ) => void;
  fetchPublicHtml: (
    value: string,
    options?: {
      allowedHosts?: readonly string[];
      maxBytes?: number;
      maxRedirects?: number;
      timeoutMs?: number;
    },
  ) => Promise<{ html: string; url: string }>;
  getHeader: (event: H3Event, name: string) => string | undefined;
  getQuery: (event: H3Event) => Record<string, string | undefined>;
  isMessageOwner: (
    message: MessageLike | null | undefined,
    userId: unknown,
  ) => boolean;
  parseBody: (event: H3Event) => Promise<ChatRouteBody>;
  persistMessageNotifications: (input: PushNotificationInput) => Promise<{
    notifications: number;
    recipients: string[];
  }>;
  presentUser: (
    user: DSpeakProfileInput | null | undefined,
    detailed?: boolean,
  ) => unknown;
  pushAllowedHosts: readonly string[];
  requireAuthenticatedUser: (event: H3Event) => Promise<string>;
  requireRoomMember: (
    room: AuthorizationRoom,
    userId: string,
  ) => Promise<RoomMemberAccess>;
  requireValue: (value: unknown, message: string) => string;
  sendPushTest: (userId: string, deviceId: string) => Promise<unknown>;
  setResponseStatus: (event: H3Event, statusCode: number) => void;
  [key: string]: unknown;
}

export interface ChatRouteDependencies extends ChatApiDependencies {
  assertSafeOutboundUrl: (
    value: string,
    options?: { allowedHosts?: readonly string[] },
  ) => Promise<URL>;
  broadcastToChannel: (
    channelId: string | number,
    message: unknown,
  ) => Promise<void>;
  canDeleteMessage: (
    message: MessageLike | null | undefined,
    userId: unknown,
    permissions?: readonly string[],
    isRoomOwner?: boolean,
  ) => boolean;
  canViewMessageHistory: (
    permissions?: readonly string[],
    isRoomOwner?: boolean,
  ) => boolean;
  enforceRateLimit: (
    event: H3Event,
    scope: string,
    identity: string | null | undefined,
    limit: number,
    windowMs: number,
  ) => void;
  fetchPublicHtml: (
    value: string,
    options?: {
      allowedHosts?: readonly string[];
      maxBytes?: number;
      maxRedirects?: number;
      timeoutMs?: number;
    },
  ) => Promise<{ html: string; url: string }>;
  getHeader: (event: H3Event, name: string) => string | undefined;
  isMessageOwner: (
    message: MessageLike | null | undefined,
    userId: unknown,
  ) => boolean;
  persistMessageNotifications: (input: PushNotificationInput) => Promise<{
    notifications: number;
    recipients: string[];
  }>;
  presentMessage: (message: ChatMessageRow) => Promise<Record<string, unknown>>;
  presentMessages: (
    rows: ChatMessageRow[],
  ) => Promise<Array<Record<string, unknown>>>;
  pushAllowedHosts: readonly string[];
  sendPushTest: (userId: string, deviceId: string) => Promise<unknown>;
  setResponseStatus: (event: H3Event, statusCode: number) => void;
  validateMessageAttachments: (
    submittedAttachments: unknown,
    channelId: string,
    userId: string,
    clientId?: string,
  ) => Promise<ChatAttachmentRecord[]>;
  validateReplyTarget: (
    replyTo: string | null | undefined,
    channelId: string,
  ) => Promise<string | null>;
}
