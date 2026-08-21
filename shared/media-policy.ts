import {
  parseExternalBoolean,
  parseExternalRecord,
  type ExternalField,
} from "./types/external.ts";
import type { MediaPolicyInput, PolicyLimits } from "./types/media.ts";

const MEDIA_POLICY_KEYS = [
  "microphoneKbps",
  "cameraKbps",
  "screenKbps",
  "sharedAudioKbps",
] as const;

export const MEDIA_POLICY_LIMITS = Object.freeze({
  microphoneKbps: Object.freeze({ min: 32, max: 256, default: 48 }),
  cameraKbps: Object.freeze({ min: 250, max: 2000, default: 1500 }),
  screenKbps: Object.freeze({ min: 2000, max: 6000, default: 4000 }),
  sharedAudioKbps: Object.freeze({ min: 64, max: 256, default: 128 }),
});

export const STANDARD_MICROPHONE_MAX_KBPS = 96;
export const HD_MICROPHONE_MIN_KBPS = 64;

export const VIDEO_POLICY_QUALITY_STEPS = Object.freeze({
  cameraKbps: Object.freeze([
    Object.freeze({ label: "Low", value: 250 }),
    Object.freeze({ label: "Medium", value: 750 }),
    Object.freeze({ label: "High", value: 1500 }),
    Object.freeze({ label: "Maximum", value: 2000 }),
  ]),
  screenKbps: Object.freeze([
    Object.freeze({ label: "Low", value: 2000 }),
    Object.freeze({ label: "Medium", value: 3000 }),
    Object.freeze({ label: "High", value: 4000 }),
    Object.freeze({ label: "Maximum", value: 6000 }),
  ]),
});

export function normalizeMediaPolicy(value: ExternalField = {}) {
  const record = parseExternalRecord(value) ?? {};
  const requestedMicrophone = record.microphoneKbps;
  const hdAudio =
    parseExternalBoolean(record.hdAudio) === true ||
    (record.hdAudio == null &&
      Number(requestedMicrophone) > STANDARD_MICROPHONE_MAX_KBPS);
  return {
    hdAudio,
    microphoneKbps: readPolicyNumber(
      requestedMicrophone,
      hdAudio
        ? {
            ...MEDIA_POLICY_LIMITS.microphoneKbps,
            min: HD_MICROPHONE_MIN_KBPS,
            default: 96,
          }
        : {
            ...MEDIA_POLICY_LIMITS.microphoneKbps,
            max: STANDARD_MICROPHONE_MAX_KBPS,
          },
    ),
    cameraKbps: readPolicyNumber(
      record.cameraKbps,
      MEDIA_POLICY_LIMITS.cameraKbps,
    ),
    screenKbps: readPolicyNumber(
      record.screenKbps,
      MEDIA_POLICY_LIMITS.screenKbps,
    ),
    sharedAudioKbps: readPolicyNumber(
      record.sharedAudioKbps,
      MEDIA_POLICY_LIMITS.sharedAudioKbps,
    ),
    connectionMode: normalizeConnectionMode(record.connectionMode),
    revision: Math.max(1, Math.floor(Number(record.revision) || 1)),
    updatedAt: record.updatedAt || null,
  };
}

export function validateMediaPolicy(value: MediaPolicyInput = {}) {
  const record = parseExternalRecord(value) ?? {};
  const errors: string[] = [];
  if (parseExternalBoolean(record.hdAudio) === null)
    errors.push("hdAudio must be a boolean");
  for (const key of MEDIA_POLICY_KEYS) {
    const limits: PolicyLimits = MEDIA_POLICY_LIMITS[key];
    const number = Number(record[key]);
    if (!Number.isFinite(number) || number < limits.min || number > limits.max)
      errors.push(
        `${key} must be between ${limits.min} and ${limits.max} kbps`,
      );
  }
  const microphone = Number(record.microphoneKbps);
  if (
    Number.isFinite(microphone) &&
    record.hdAudio === false &&
    microphone > STANDARD_MICROPHONE_MAX_KBPS
  )
    errors.push("microphoneKbps must be at most 96 kbps without HD audio");
  if (
    Number.isFinite(microphone) &&
    record.hdAudio === true &&
    microphone < HD_MICROPHONE_MIN_KBPS
  )
    errors.push("microphoneKbps must be at least 64 kbps with HD audio");
  if (errors.length) return { valid: false, errors };
  return { valid: true, value: normalizeMediaPolicy(record) };
}

export function readPolicyNumber(value: ExternalField, limits: PolicyLimits) {
  const number = Number(value);
  return Number.isFinite(number) && number >= limits.min && number <= limits.max
    ? Math.round(number)
    : limits.default;
}

export const ConnectionMode = Object.freeze({
  AUTO: "auto",
  DIRECT: "direct",
});

export const DEFAULT_CONNECTION_MODE = ConnectionMode.AUTO;

export function normalizeConnectionMode(value: ExternalField) {
  if (value === ConnectionMode.AUTO || value === ConnectionMode.DIRECT)
    return value;
  return DEFAULT_CONNECTION_MODE;
}

export function validateConnectionMode(value: ExternalField) {
  return value === ConnectionMode.AUTO || value === ConnectionMode.DIRECT;
}
