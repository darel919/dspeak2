import type { RtpSenderSettings } from "./types/shared-utilities.ts";

export async function applyRtpSenderSettings(
  sender: RTCRtpSender,
  options: RtpSenderSettings = {},
) {
  if (!sender?.getParameters || !sender?.setParameters) return false;
  const parameters = sender.getParameters();
  if (!parameters.encodings?.length) return false;
  const requested = options.encodings?.[0] || {};
  const encoding = parameters.encodings[0];

  for (const key of [
    "maxBitrate",
    "maxFramerate",
    "priority",
    "networkPriority",
    "scaleResolutionDownBy",
  ]) {
    const value = requested[key];
    if (value != null)
      (encoding as RTCRtpEncodingParameters & Record<string, unknown>)[key] =
        value;
  }
  if (options.degradationPreference)
    parameters.degradationPreference =
      options.degradationPreference as RTCDegradationPreference;

  try {
    await sender.setParameters(parameters);
  } catch (error: unknown) {
    const errorName =
      error instanceof DOMException
        ? error.name
        : error && typeof error === "object" && "name" in error
          ? String(error.name)
          : "";
    if (
      [
        "InvalidModificationError",
        "InvalidAccessError",
        "NotSupportedError",
      ].includes(errorName)
    )
      return false;
    throw error;
  }
  return true;
}
