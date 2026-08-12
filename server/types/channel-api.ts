import type { H3Event } from "h3";
import type { RoomRole } from "../../shared/types/room.ts";
import type { DSpeakChannelRow, DSpeakProfileRow } from "./dspeak-api.ts";
import type {
  AuthorizationRoom,
  RoomMemberAccess,
} from "./room-authorization.ts";

export interface ChannelApiDependencies {
  broadcastToChannel: (channelId: string, message: unknown) => Promise<void>;
  broadcastToRoom: (roomId: string, message: unknown) => Promise<void>;
  canModerateVoiceMember: (
    actorRoles: readonly RoomRole[] | null | undefined,
    targetRoles: readonly RoomRole[] | null | undefined,
    isOwner?: boolean,
  ) => boolean;
  createError: (options: {
    statusCode: number;
    statusMessage: string;
  }) => Error;
  disconnectVoiceParticipant: (
    channelId: string,
    userId: string,
  ) => Promise<number>;
  enforceRateLimit: (
    event: H3Event,
    scope: string,
    identity: string | null | undefined,
    limit: number,
    windowMs: number,
  ) => void;
  ensureMember: (
    room: AuthorizationRoom,
    userId: string,
  ) => Promise<RoomMemberAccess>;
  getQuery: (event: H3Event) => Record<string, string | undefined>;
  isActiveVoiceParticipant: (
    channelId: string,
    userId: string,
  ) => Promise<boolean>;
  moderateVoiceParticipant: (
    channelId: string,
    userId: string,
    targetChannelId?: string | null,
  ) => Promise<number>;
  parseBody: (event: H3Event) => Promise<Record<string, unknown>>;
  presentChannel: (channel: DSpeakChannelRow) => unknown;
  presentUser: (profile: DSpeakProfileRow | null | undefined) => unknown;
  requireAuthenticatedUser: (event: H3Event) => Promise<string>;
  requireRoomPermission: (
    room: AuthorizationRoom,
    userId: string,
    permission: string,
  ) => Promise<RoomMemberAccess>;
  requireValue: (value: unknown, message: string) => string;
  setResponseStatus: (event: H3Event, statusCode: number) => void;
}
