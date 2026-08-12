import type { SoundboardRecord } from "../../../shared/types/soundboard.ts";

export interface SoundboardClip extends SoundboardRecord {
  roomId: string;
  title?: string;
  name?: string;
  canManage?: boolean;
}

export interface SoundboardListResponse {
  clips: SoundboardClip[];
  canManageRoom: boolean;
}

export interface SoundboardUpdateInput extends SoundboardClip {
  iconImage?: File;
}

export interface SoundboardEventDetail {
  roomId?: string;
  activityId?: string;
  triggeredBy?: string;
  clipId?: string;
  clipTitle?: string;
  clipIcon?: string;
  duration?: number;
}
