import type { Ref } from "vue";
import type {
  VoiceMediaSessionLike,
  VoiceUserRecord,
} from "./voice-media-actions.ts";

export interface VoiceParticipantStateOptions {
  clearSoundboardActivity: (
    userId: string | number,
    expectedActivity?: Record<string, unknown> | null,
  ) => void;
  connectedUsers: Ref<Map<string, VoiceUserRecord>>;
  getAuthenticatedUser: () => VoiceUserRecord | null;
  getMediaSession: () => VoiceMediaSessionLike | null;
  trackVolumes: Ref<Record<string, number>>;
  userDirectory: Ref<Map<string, VoiceUserRecord>>;
  userVolumes: Ref<Record<string, number>>;
}

export interface VoiceStateUpdate {
  muted?: boolean;
  deafened?: boolean;
  cameraEnabled?: boolean;
  screenSharing?: boolean;
}
