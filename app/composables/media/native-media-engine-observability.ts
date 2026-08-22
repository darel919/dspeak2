import {
  createMediaQoeReport,
  mediaQoePathsFromStats,
} from "../../shared/media-qoe.ts";
import {
  capabilityBackend,
  hasNativeCapability,
  nativeOnlyError,
} from "./native-media-engine-common.ts";
import { normalizeNativeStatsSnapshot } from "../../shared/native-mediasoup-diagnostics.ts";
import {
  isExternalBoolean,
  isExternalRecord,
  isExternalString,
} from "../../shared/types/boundary.ts";
import { normalizeAudioLatencyCapabilities } from "../../shared/types/audio-latency.ts";
import type { NativeMediaEngine } from "./nativeMediaEngine.ts";
import type {
  MediaDeviceInfo,
  MediaSignalMessage,
  MediaStats,
} from "../../shared/media/types.ts";
import type {
  NativeCapabilities,
  NativeCaptureRequest,
} from "../../shared/types/native-media.ts";
import type { MediaCommandResult } from "../../shared/types/boundary.ts";
import { normalizeParticipantMediaCapabilities } from "../../shared/types/video-codec-capabilities.ts";
import { parseThrownError } from "../../utils/external-values.ts";

function normalizeMediaDevices(value: MediaCommandResult): MediaDeviceInfo[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!isExternalRecord(candidate)) return [];
    if (!isExternalString(candidate.deviceId)) return [];
    if (!isExternalString(candidate.kind)) return [];
    const device = {
      deviceId: candidate.deviceId,
      label: isExternalString(candidate.label) ? candidate.label : "",
      kind: candidate.kind,
    };
    if (isExternalString(candidate.groupId))
      Object.assign(device, { groupId: candidate.groupId });
    return [device];
  });
}

export async function handleSignal(
  engine: NativeMediaEngine,
  message: MediaSignalMessage,
): Promise<MediaCommandResult> {
  const data = isExternalRecord(message.data) ? message.data : {};
  if (!engine.flags.nativeRtc || !hasNativeCapability(engine.flags)) {
    if (engine.nativeOnly) throw nativeOnlyError("signaling");
    return engine.browserEngine.handleSignal?.(message);
  }
  return engine.nativeSession?.handle(String(message.type || ""), data);
}

export async function getDevices(
  engine: NativeMediaEngine,
): Promise<MediaDeviceInfo[]> {
  if (!engine.flags.nativeRtc) {
    if (engine.nativeOnly) throw nativeOnlyError("device enumeration");
    return (await engine.browserEngine.getDevices?.()) || [];
  }
  if (!engine.flags.nativeBackendReady || !engine.nativeSession) {
    try {
      const devices = await engine._invoke("media_prepare_devices");
      return normalizeMediaDevices(devices);
    } catch (error) {
      if (engine.nativeOnly) throw parseThrownError(error);
      return engine.browserEngine.getDevices?.() || [];
    }
  }
  return engine
    ._invoke("media_get_devices")
    .then(normalizeMediaDevices)
    .catch((error) => {
      if (engine.nativeOnly) throw parseThrownError(error);
      return engine.browserEngine.getDevices?.() || [];
    });
}

export async function getCaptureSources(
  engine: NativeMediaEngine,
): Promise<NativeCaptureRequest[]> {
  if (!engine.flags.nativeRtc || !engine.flags.nativeBackendReady) {
    if (engine.nativeOnly) throw nativeOnlyError("capture source enumeration");
    return [];
  }
  return engine
    ._invoke("media_list_capture_sources")
    .then((sources) =>
      Array.isArray(sources)
        ? sources.filter((source): source is NativeCaptureRequest =>
            isExternalRecord(source),
          )
        : [],
    )
    .catch(() => []);
}

export async function getStats(engine: NativeMediaEngine): Promise<MediaStats> {
  if (!engine.flags.nativeRtc || !hasNativeCapability(engine.flags)) {
    if (engine.nativeOnly) throw nativeOnlyError("statistics");
    return (await engine.browserEngine.getStats?.()) || {};
  }
  const statsSnapshot = engine.getWebRTCStatsSnapshot();
  return statsSnapshot
    .then((stats: MediaCommandResult) => {
      const snapshot = normalizeNativeStatsSnapshot(
        Array.isArray(stats)
          ? {
              timestamp: Date.now(),
              engine: "native",
              topology: engine.nativeProvider === "p2p" ? "p2p" : "sfu",
              transports: stats,
            }
          : stats,
      );
      const normalizedSnapshot = isExternalRecord(snapshot) ? snapshot : {};
      emitQoe(engine, normalizedSnapshot);
      return normalizedSnapshot;
    })
    .catch((error) => {
      if (engine.nativeOnly) throw parseThrownError(error);
      return engine.browserEngine.getStats?.() || {};
    });
}

export function emitQoe(engine: NativeMediaEngine, stats: MediaStats): void {
  const report = createMediaQoeReport({
    provider:
      engine.nativeProvider === "p2p"
        ? "p2p"
        : engine.nativeSession?.selectedProvider || "mediasoup",
    epoch: engine.nativeSession?.topologyState?.epoch || 0,
    paths: mediaQoePathsFromStats(stats),
    sampledAt: stats?.sampledAt,
  });
  if (!report.paths.length) return;
  engine.onQoe?.(report);
  engine._emit("qoe", report);
}

export async function getNativeCapabilities(
  engine: NativeMediaEngine,
): Promise<NativeCapabilities> {
  if (!engine.flags.nativeRtc) return {};
  const capabilities = await engine._invoke("media_get_capabilities");
  return parseNativeCapabilities(capabilities);
}

export function parseNativeCapabilities<T>(value: T): NativeCapabilities {
  if (!isExternalRecord(value)) return {};
  const capabilities: NativeCapabilities = {};
  const flagNames = [
    "nativeRtc",
    "nativeBackendReady",
    "nativeScreenShare",
    "nativeScreenAudio",
    "nativeP2P",
    "nativeSfu",
    "nativeMicrophone",
    "nativeCamera",
    "nativeAudioReceive",
    "nativeVideoReceive",
  ];
  for (const flagName of flagNames) {
    const flag = value[flagName];
    if (isExternalBoolean(flag)) capabilities[flagName] = flag;
  }
  if (isExternalRecord(value.videoCodecDiagnostics))
    capabilities.videoCodecDiagnostics = value.videoCodecDiagnostics;
  if (isExternalRecord(value.videoCodecCapabilities))
    capabilities.videoCodecCapabilities = value.videoCodecCapabilities;
  if (isExternalRecord(value.concurrentEncode))
    capabilities.concurrentEncode = value.concurrentEncode;
  if (isExternalRecord(value.mediaCapabilities))
    capabilities.mediaCapabilities = normalizeParticipantMediaCapabilities(
      value.mediaCapabilities,
    );
  if (isExternalRecord(value.audioLatency))
    capabilities.audioLatency = normalizeAudioLatencyCapabilities(
      value.audioLatency,
    );
  return capabilities;
}

export function getCapabilities(engine: NativeMediaEngine) {
  return {
    microphone: capabilityBackend(
      engine._usesNativeCapture("nativeMicrophone"),
      false,
      engine.nativeOnly,
    ),
    camera: capabilityBackend(
      engine._usesNativeCapture("nativeCamera"),
      false,
      engine.nativeOnly,
    ),
    screenVideo: capabilityBackend(
      engine._usesNativeCapture("nativeScreenShare"),
      false,
      engine.nativeOnly,
    ),
    screenAudio: capabilityBackend(
      engine._usesNativeCapture("nativeScreenAudio"),
      false,
      engine.nativeOnly,
    ),
    p2p: capabilityBackend(
      hasNativeCapability(engine.flags) && engine.flags.nativeP2P,
      true,
      engine.nativeOnly,
    ),
    sfu: capabilityBackend(
      hasNativeCapability(engine.flags) && engine.flags.nativeSfu,
      true,
      engine.nativeOnly,
    ),
    receiveVideo: capabilityBackend(
      hasNativeCapability(engine.flags) && engine.flags.nativeVideoReceive,
      false,
      engine.nativeOnly,
    ),
    receiveAudio: capabilityBackend(
      hasNativeCapability(engine.flags) && engine.flags.nativeAudioReceive,
      false,
      engine.nativeOnly,
    ),
  };
}
