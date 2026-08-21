import type { RtpSenderSettings } from "./types/shared-utilities.ts";
import {
  isExternalNumber,
  isExternalRecord,
  isExternalString,
} from "./types/boundary.ts";

export async function applyRtpSenderSettings(
  sender: RTCRtpSender,
  options: RtpSenderSettings = {},
) {
  if (!sender?.getParameters || !sender?.setParameters) return false;
  const parameters = sender.getParameters();
  if (!parameters.encodings?.length) return false;
  const requested = options.encodings?.[0] || {};
  const encoding = parameters.encodings[0];
  if (!encoding) return false;

  for (const key of [
    "maxBitrate",
    "maxFramerate",
    "priority",
    "networkPriority",
    "scaleResolutionDownBy",
  ]) {
    const value = requested[key];
    if (value != null && (isExternalNumber(value) || isExternalString(value)))
      Object.assign(encoding, { [key]: value });
  }
  if (
    options.degradationPreference === "balanced" ||
    options.degradationPreference === "maintain-framerate" ||
    options.degradationPreference === "maintain-resolution"
  )
    parameters.degradationPreference = options.degradationPreference;

  try {
    await sender.setParameters(parameters);
  } catch (error) {
    const errorName =
      error instanceof DOMException
        ? error.name
        : error instanceof Error
          ? error.name
          : isExternalRecord(error) && isExternalString(error.name)
            ? error.name
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
