import type { H3Event } from "h3";
import type { SoundboardRecord } from "../../shared/types/soundboard.ts";

export type SoundboardEvent = H3Event;
export type SoundboardBody = Record<string, unknown>;
export type SoundboardClipRecord = SoundboardRecord;

export interface SoundboardConversionResult {
  bytes: Buffer;
  duration: number;
}
