import {
  isExternalNumber,
  isExternalRecord,
  isExternalString,
} from "./types/boundary.ts";
import type {
  BrowserMediaTuningContext,
  BrowserSenderControlName,
  BrowserSenderEffectiveParameters,
  BrowserSenderTuningResult,
} from "./types/web-rtc-latency.ts";
import { recordWebRtcLatencyEvent } from "./web-rtc-latency-diagnostics.ts";

const DEGRADATION_PREFERENCES = [
  "balanced",
  "maintain-framerate",
  "maintain-resolution",
] as const;

type DegradationPreference = (typeof DEGRADATION_PREFERENCES)[number];

function resolveDegradationPreference(
  qualityPriority: BrowserMediaTuningContext["qualityPriority"],
): DegradationPreference {
  return qualityPriority === "resolution"
    ? "maintain-resolution"
    : "maintain-framerate";
}

export type BrowserSenderPolicyParameters = {
  degradationPreference: DegradationPreference;
  maxFramerate: number | null;
};

export function buildBrowserSenderPolicyParameters(
  context: BrowserMediaTuningContext,
): BrowserSenderPolicyParameters {
  return {
    degradationPreference: resolveDegradationPreference(
      context.qualityPriority,
    ),
    maxFramerate:
      Number.isFinite(context.configuredFrameRate) &&
      context.configuredFrameRate > 0
        ? Math.round(context.configuredFrameRate)
        : null,
  };
}

function encodingValue<T extends object>(
  parameters: T,
  key: string,
): number | string | null {
  if (!isExternalRecord(parameters)) return null;
  const encodings = parameters.encodings;
  if (!Array.isArray(encodings) || !encodings.length) return null;
  const first = encodings[0];
  if (!isExternalRecord(first)) return null;
  const value = first[key];
  return isExternalNumber(value) || isExternalString(value) ? value : null;
}

function readEffective<T extends object>(
  parameters: T,
): BrowserSenderEffectiveParameters {
  const degradationPreference = isExternalRecord(parameters)
    ? parameters.degradationPreference
    : null;
  const maxFramerate = encodingValue(parameters, "maxFramerate");
  const scaleResolutionDownBy = encodingValue(
    parameters,
    "scaleResolutionDownBy",
  );
  const maxBitrate = encodingValue(parameters, "maxBitrate");
  return {
    degradationPreference: isExternalString(degradationPreference)
      ? degradationPreference
      : null,
    maxFramerate: isExternalNumber(maxFramerate) ? maxFramerate : null,
    scaleResolutionDownBy: isExternalNumber(scaleResolutionDownBy)
      ? scaleResolutionDownBy
      : null,
    maxBitrate: isExternalNumber(maxBitrate) ? maxBitrate : null,
  };
}

function structuredCloneSafe<T>(value: T): T | null {
  try {
    return structuredClone(value);
  } catch {
    try {
      /* SAFETY: The JSON round trip preserves the plain parameter object returned by getParameters. */
      return JSON.parse(JSON.stringify(value)) as T | null;
    } catch {
      return null;
    }
  }
}

const TOLERATED_ERROR_NAMES = new Set([
  "InvalidModificationError",
  "InvalidAccessError",
  "NotSupportedError",
]);

const EMPTY_EFFECTIVE: BrowserSenderEffectiveParameters = {
  degradationPreference: null,
  maxFramerate: null,
  scaleResolutionDownBy: null,
  maxBitrate: null,
};

export async function applyBrowserSenderLatencyPolicy(
  sender: RTCRtpSender,
  context: BrowserMediaTuningContext,
): Promise<BrowserSenderTuningResult> {
  const notAttempted: BrowserSenderTuningResult = {
    attempted: false,
    applied: false,
    verified: false,
    changed: false,
    appliedControls: [],
    rejectedControls: [],
    errorName: null,
    effective: { ...EMPTY_EFFECTIVE },
  };
  if (!(sender.getParameters instanceof Function)) return notAttempted;
  if (!(sender.setParameters instanceof Function)) return notAttempted;
  let before: RTCRtpSendParameters;
  try {
    before = sender.getParameters();
  } catch {
    return notAttempted;
  }
  if (!isExternalRecord(before) || !before.encodings?.length)
    return notAttempted;
  const requested = buildBrowserSenderPolicyParameters(context);
  const probe = structuredCloneSafe(before);
  if (!probe?.encodings?.length) return notAttempted;
  const beforeEffective = readEffective(before);
  const appliedControls: BrowserSenderControlName[] = [];
  probe.degradationPreference = requested.degradationPreference;
  appliedControls.push("degradationPreference");
  if (requested.maxFramerate != null) {
    const probeEncoding = probe.encodings[0];
    if (!isExternalRecord(probeEncoding)) return notAttempted;
    probeEncoding.maxFramerate = requested.maxFramerate;
    appliedControls.push("maxFramerate");
  }
  let errorName: string | null = null;
  try {
    await sender.setParameters(probe);
  } catch (error) {
    errorName =
      error instanceof DOMException
        ? error.name
        : error instanceof Error
          ? error.name
          : String(error ?? "");
  }
  if (errorName !== null && !TOLERATED_ERROR_NAMES.has(errorName))
    throw new Error(`Sender parameter update failed: ${errorName}`);
  let after: RTCRtpSendParameters | null = null;
  try {
    after = sender.getParameters();
  } catch {}
  const effective = readEffective(after ?? before);
  const rejectedControls = appliedControls.filter((control) => {
    if (control === "degradationPreference")
      return (
        effective.degradationPreference !== requested.degradationPreference
      );
    if (control === "maxFramerate")
      return requested.maxFramerate != null
        ? effective.maxFramerate !== requested.maxFramerate
        : false;
    return true;
  });
  const verified = errorName === null && rejectedControls.length === 0;
  const changed =
    effective.degradationPreference !== beforeEffective.degradationPreference ||
    effective.maxFramerate !== beforeEffective.maxFramerate ||
    effective.scaleResolutionDownBy !== beforeEffective.scaleResolutionDownBy ||
    effective.maxBitrate !== beforeEffective.maxBitrate;
  const result: BrowserSenderTuningResult = {
    attempted: true,
    applied: errorName === null,
    verified,
    changed,
    appliedControls,
    rejectedControls,
    errorName,
    effective,
  };
  recordWebRtcLatencyEvent(
    verified
      ? { kind: "sender-policy-applied", appliedControls }
      : {
          kind: "sender-policy-rejected",
          rejectedControls,
          errorName,
        },
  );
  return result;
}
