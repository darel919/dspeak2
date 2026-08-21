import {
  parseExternalBoolean,
  parseExternalRecord,
  type ExternalField,
} from "./types/external.ts";

export function normalizeParticipantVoiceState(value: ExternalField) {
  const record = parseExternalRecord(value);
  const muted = parseExternalBoolean(record?.muted);
  const deafened = parseExternalBoolean(record?.deafened);
  if (muted === null || deafened === null) return null;

  return {
    muted,
    deafened,
  };
}
