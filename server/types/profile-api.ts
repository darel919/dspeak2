import type { H3Event } from "h3";
import type { db } from "../db/client.ts";
import type { DSpeakProfileInput, DSpeakProfileRow } from "./dspeak-api.ts";
import type { ProfileUpdateInput } from "./profile-repository.ts";
import type { AuthorizationRoom } from "./room-authorization.ts";

export interface ProfileApiDependencies {
  broadcastGlobally: (message: unknown) => Promise<void>;
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
  getRoomById?: (roomId: string) => Promise<AuthorizationRoom | null>;
  parseBody: (event: H3Event) => Promise<Record<string, unknown>>;
  presentPublicProfile: (
    user: DSpeakProfileInput | null | undefined,
  ) => unknown;
  presentUser: (user: DSpeakProfileInput | null | undefined) => unknown;
  requireAuthenticatedUser: (event: H3Event) => Promise<string>;
  requireRoomMember: (
    room: AuthorizationRoom,
    userId: string,
  ) => Promise<unknown>;
  requireValue: (value: unknown, message: string) => string;
  updateActiveUserProfile: (profile: unknown) => Promise<unknown>;
  updateProfileAvatar: (input: {
    db: typeof db;
    userId: string;
    body: Record<string, unknown>;
    update: ProfileUpdateInput;
  }) => Promise<DSpeakProfileRow | undefined>;
}
