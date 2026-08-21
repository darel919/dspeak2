import type { H3Event } from "h3";
import type { db } from "../db/client.ts";
import type { DSpeakProfileInput, DSpeakProfileRow } from "./dspeak-api.ts";
import type { ProfileUpdateInput } from "./profile-repository.ts";
import type { AuthorizationRoom } from "./room-authorization.ts";
import type { ExternalField } from "../../shared/types/external.ts";

export interface ProfileApiDependencies {
  broadcastGlobally: (message: ExternalField) => Promise<void>;
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
  ) => ExternalField;
  presentUser: (user: DSpeakProfileInput | null | undefined) => ExternalField;
  requireAuthenticatedUser: (event: H3Event) => Promise<string>;
  requireRoomMember: (
    room: AuthorizationRoom,
    userId: string,
  ) => Promise<ExternalField>;
  requireValue: (value: ExternalField, message: string) => string;
  updateActiveUserProfile: (profile: ExternalField) => Promise<ExternalField>;
  updateProfileAvatar: (input: {
    db: typeof db;
    userId: string;
    body: Record<string, unknown>;
    update: ProfileUpdateInput;
  }) => Promise<DSpeakProfileRow | undefined>;
}
