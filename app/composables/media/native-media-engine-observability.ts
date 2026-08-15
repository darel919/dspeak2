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

export async function handleSignal(
  engine: NativeMediaEngine,
  message: MediaSignalMessage,
): Promise<unknown> {
  const data =
    message.data &&
    typeof message.data === "object" &&
    !Array.isArray(message.data)
      ? (message.data as Record<string, unknown>)
      : {};
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
      return Array.isArray(devices) ? (devices as MediaDeviceInfo[]) : [];
    } catch (error: unknown) {
      if (engine.nativeOnly) throw error;
      return engine.browserEngine.getDevices?.() || [];
    }
  }
  return engine
    ._invoke("media_get_devices")
    .then((devices: unknown) => {
      if (Array.isArray(devices)) return devices as MediaDeviceInfo[];
      return [];
    })
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
  const statsSnapshot = (
    engine as unknown as { getWebRTCStatsSnapshot: () => Promise<unknown> }
  ).getWebRTCStatsSnapshot();
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
      emitQoe(engine, snapshot as MediaStats);
      return snapshot as MediaStats;
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
