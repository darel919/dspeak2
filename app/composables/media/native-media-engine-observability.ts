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
import type { NativeMediaEngine } from "./nativeMediaEngine.ts";
import type {
  MediaDeviceInfo,
  MediaSignalMessage,
  MediaStats,
} from "../../shared/media/types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeMediaDevices(value: unknown): MediaDeviceInfo[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    if (typeof candidate.deviceId !== "string") return [];
    if (typeof candidate.kind !== "string") return [];
    return [
      {
        deviceId: candidate.deviceId,
        label: typeof candidate.label === "string" ? candidate.label : "",
        kind: candidate.kind,
        ...(typeof candidate.groupId === "string"
          ? { groupId: candidate.groupId }
          : {}),
      },
    ];
  });
}

export async function handleSignal(
  engine: NativeMediaEngine,
  message: MediaSignalMessage,
): Promise<unknown> {
  const data = isRecord(message.data) ? message.data : {};
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
    } catch (error: unknown) {
      if (engine.nativeOnly) throw error;
      return engine.browserEngine.getDevices?.() || [];
    }
  }
  return engine
    ._invoke("media_get_devices")
    .then(normalizeMediaDevices)
    .catch((error: unknown) => {
      if (engine.nativeOnly) throw error;
      return engine.browserEngine.getDevices?.() || [];
    });
}

export async function getCaptureSources(
  engine: NativeMediaEngine,
): Promise<unknown[]> {
  if (!engine.flags.nativeRtc || !engine.flags.nativeBackendReady) {
    if (engine.nativeOnly) throw nativeOnlyError("capture source enumeration");
    return [];
  }
  return engine
    ._invoke("media_list_capture_sources")
    .then((sources) => (Array.isArray(sources) ? sources : []))
    .catch(() => []);
}

export async function getStats(engine: NativeMediaEngine): Promise<MediaStats> {
  if (!engine.flags.nativeRtc || !hasNativeCapability(engine.flags)) {
    if (engine.nativeOnly) throw nativeOnlyError("statistics");
    return (await engine.browserEngine.getStats?.()) || {};
  }
  const statsSnapshot = engine.getWebRTCStatsSnapshot();
  return statsSnapshot
    .then((stats: unknown) => {
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
      const normalizedSnapshot = isRecord(snapshot) ? snapshot : {};
      emitQoe(engine, normalizedSnapshot);
      return normalizedSnapshot;
    })
    .catch((error: unknown) => {
      if (engine.nativeOnly) throw error;
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
): Promise<unknown> {
  if (!engine.flags.nativeRtc) return {};
  return engine._invoke("media_get_capabilities");
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
