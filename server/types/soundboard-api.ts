import type { H3Event } from "h3";
import type { SoundboardRecord } from "../../shared/types/soundboard.ts";
import type { ExternalRecord } from "../../shared/types/external.ts";

export type SoundboardEvent = H3Event;
export type SoundboardBody = ExternalRecord;
export type SoundboardClipRecord = SoundboardRecord;

export interface SoundboardConversionResult {
  bytes: Buffer;
  duration: number;
}
