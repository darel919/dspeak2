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

export function normalizeMediaPolicy(value = {}, legacyAudioBitrate = null) {
  value = value && typeof value === "object" ? value : {};
  const requestedMicrophone = value.microphoneKbps ?? legacyAudioBitrate;
  const hdAudio =
    value.hdAudio === true ||
    (value.hdAudio == null &&
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
      value.cameraKbps,
      MEDIA_POLICY_LIMITS.cameraKbps,
    ),
    screenKbps: readPolicyNumber(
      value.screenKbps,
      MEDIA_POLICY_LIMITS.screenKbps,
    ),
    sharedAudioKbps: readPolicyNumber(
      value.sharedAudioKbps ?? legacyAudioBitrate,
      MEDIA_POLICY_LIMITS.sharedAudioKbps,
    ),
    revision: Math.max(1, Math.floor(Number(value.revision) || 1)),
    updatedAt: value.updatedAt || null,
  };
}

export function validateMediaPolicy(value = {}) {
  value = value && typeof value === "object" ? value : {};
  const errors = [];
  if (typeof value.hdAudio !== "boolean")
    errors.push("hdAudio must be a boolean");
  for (const [key, limits] of Object.entries(MEDIA_POLICY_LIMITS)) {
    const number = Number(value[key]);
    if (!Number.isFinite(number) || number < limits.min || number > limits.max)
      errors.push(
        `${key} must be between ${limits.min} and ${limits.max} kbps`,
      );
  }
  const microphone = Number(value.microphoneKbps);
  if (
    Number.isFinite(microphone) &&
    value.hdAudio === false &&
    microphone > STANDARD_MICROPHONE_MAX_KBPS
  )
    errors.push("microphoneKbps must be at most 96 kbps without HD audio");
  if (
    Number.isFinite(microphone) &&
    value.hdAudio === true &&
    microphone < HD_MICROPHONE_MIN_KBPS
  )
    errors.push("microphoneKbps must be at least 64 kbps with HD audio");
  if (errors.length) return { valid: false, errors };
  return { valid: true, value: normalizeMediaPolicy(value) };
}

function readPolicyNumber(value, limits) {
  const number = Number(value);
  return Number.isFinite(number) && number >= limits.min && number <= limits.max
    ? Math.round(number)
    : limits.default;
}
