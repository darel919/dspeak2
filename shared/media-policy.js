export const MEDIA_POLICY_LIMITS = Object.freeze({
  microphoneKbps: Object.freeze({ min: 16, max: 510, default: 64 }),
  cameraKbps: Object.freeze({ min: 250, max: 12000, default: 4500 }),
  screenKbps: Object.freeze({ min: 500, max: 20000, default: 8000 }),
  sharedAudioKbps: Object.freeze({ min: 16, max: 510, default: 128 }),
});

export function normalizeMediaPolicy(value = {}, legacyAudioBitrate = null) {
  value = value && typeof value === "object" ? value : {};
  return {
    microphoneKbps: readPolicyNumber(
      value.microphoneKbps ?? legacyAudioBitrate,
      MEDIA_POLICY_LIMITS.microphoneKbps,
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
  for (const [key, limits] of Object.entries(MEDIA_POLICY_LIMITS)) {
    const number = Number(value[key]);
    if (!Number.isFinite(number) || number < limits.min || number > limits.max)
      errors.push(
        `${key} must be between ${limits.min} and ${limits.max} kbps`,
      );
  }
  if (errors.length) return { valid: false, errors };
  return { valid: true, value: normalizeMediaPolicy(value) };
}

function readPolicyNumber(value, limits) {
  const number = Number(value);
  return Number.isFinite(number) && number >= limits.min && number <= limits.max
    ? Math.round(number)
    : limits.default;
}
