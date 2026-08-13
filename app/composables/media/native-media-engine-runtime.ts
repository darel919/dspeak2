import { triggerRef } from "vue";
import { getDeviceId } from "../../shared/device-identity.ts";
import { resolveChannelRoomId } from "../../shared/media/channel-room.ts";
import {
  EVENT_ALIASES,
  NATIVE_EVENT_NAMES,
  channelMediaPolicy,
  hasNativeCapability,
} from "./native-media-engine-common.ts";
import type { NativeMediaEngine } from "./nativeMediaEngine.ts";
import { handleNativeAudioTelemetry } from "./native-media-engine-audio.ts";
import type {
  NativeCaptureRequest,
  NativeCapabilities,
  NativeErrorLike,
  NativeFeed,
  NativeTopology,
} from "../../shared/types/native-media.ts";
import { resolveMediaProviderIdentity } from "../../shared/media-provider-identity.ts";

const NATIVE_MEDIA_READINESS_TIMEOUT_MS = 10_000;
const NATIVE_MEDIA_READINESS_POLL_MS = 100;

function expectedInboundSources(
  topology: NativeTopology,
  localPeerId: string | null,
) {
  return (Array.isArray(topology.peers) ? topology.peers : [])
    .filter((peer) => String(peer.peerId || "") !== String(localPeerId || ""))
    .reduce(
      (count, peer) =>
        count + (Array.isArray(peer.sources) ? peer.sources.length : 0),
      0,
    );
}

function nativeTopologyKey(
  topology: Record<string, unknown>,
  provider: string,
  providerId: string | null = null,
): string {
  return `${String(topology.mode || "idle")}:${topology.epoch}:${String(topology.target || "")}:${provider}:${providerId || "family"}:${topology.sourceRevision}`;
}

function isCurrentNativeTopology(
  engine: NativeMediaEngine,
  topologyKey: string,
  generation: number,
): boolean {
  return (
    engine.nativeTopologyKey === topologyKey &&
    engine.nativeTopologyGeneration === generation
  );
}

function assertCurrentNativeTopology(
  engine: NativeMediaEngine,
  topologyKey: string,
  generation: number,
): void {
  if (isCurrentNativeTopology(engine, topologyKey, generation)) return;
  const error = Object.assign(
    new Error("Native topology operation was superseded"),
    { code: "NATIVE_TOPOLOGY_SUPERSEDED" },
  );
  throw error;
}

async function waitForNativeMediaReadiness(
  engine: NativeMediaEngine,
  topology: NativeTopology,
  provider: string,
  topologyKey: string,
  generation: number,
) {
  const mediaSession =
    provider === "p2p" ? engine.nativeP2pSession : engine.nativeSession;
  if (typeof mediaSession?.mediaReadiness !== "function") return true;
  const localPeerId =
    topology.localPeerId ||
    mediaSession.localPeerId ||
    engine.nativeSession?.localPeerId;
  const topologyInbound = expectedInboundSources(topology, localPeerId || null);
  const startedAt = Date.now();
  let latest = null;
  while (Date.now() - startedAt < NATIVE_MEDIA_READINESS_TIMEOUT_MS) {
    assertCurrentNativeTopology(engine, topologyKey, generation);
    const observedInbound = Number(
      "expectedInboundFlowCount" in mediaSession
        ? mediaSession.expectedInboundFlowCount?.() || 0
        : 0,
    );
    latest = await mediaSession.mediaReadiness(
      Math.max(topologyInbound, observedInbound),
    );
    assertCurrentNativeTopology(engine, topologyKey, generation);
    if (latest?.ready === true) return latest;
    await new Promise((resolve) =>
      setTimeout(resolve, NATIVE_MEDIA_READINESS_POLL_MS),
    );
  }
  throw new Error(
    `Native ${provider} media did not become ready for handoff (outbound ${latest?.outboundFlowing || 0}/${latest?.outboundExpected || 0}, inbound ${latest?.inboundFlowing || 0}/${latest?.inboundExpected || topologyInbound})`,
  );
}

export function handleNativeTopology(
  engine: NativeMediaEngine,
  topology: NativeTopology = {},
) {
  const mode = String(topology.mode || "idle");
  const target = String(topology.target || "");
  const identity = resolveMediaProviderIdentity(
    topology,
    target === "sfu" || mode === "switching",
  );
  const provider =
    identity.provider || engine.nativeSession?.selectedProvider || "mediasoup";
  const providerId = identity.providerId;
  const topologyKey = nativeTopologyKey(topology, provider, providerId);
  if (engine.nativeTopologyKey === topologyKey)
    return engine.nativeTopologyOperation || Promise.resolve();
  const generation = (Number(engine.nativeTopologyGeneration) || 0) + 1;
  engine.nativeTopologyGeneration = generation;
  engine.nativeTopologyKey = topologyKey;
  const previousOperation = engine.nativeTopologyOperation || Promise.resolve();
  const operation = previousOperation
    .catch(() => {})
    .then(() =>
      applyNativeTopology(
        engine,
        topology,
        provider,
        providerId,
        topologyKey,
        generation,
      ),
    );
  const tracked = operation.finally(() => {
    if (engine.nativeTopologyOperation === tracked)
      engine.nativeTopologyOperation = null;
  });
  engine.nativeTopologyOperation = tracked;
  tracked.catch(() => {});
  return tracked;
}

async function applyNativeTopology(
  engine: NativeMediaEngine,
  topology: NativeTopology,
  provider: string,
  providerId: string | null,
  topologyKey: string,
  generation: number,
) {
  const mode = String(topology.mode || "idle");
  const target = String(topology.target || "");
  const direct = mode === "probing" || mode === "p2p" || target === "p2p";
  const p2pTopology = {
    ...topology,
    mode: mode === "switching" && target === "p2p" ? "p2p" : mode,
  };
  let fallbackActivationFailed = false;
  try {
    if (engine.nativeSession) {
      engine.nativeSession.selectedProvider = provider;
      engine.nativeSession.selectedProviderId = providerId;
    }
    assertCurrentNativeTopology(engine, topologyKey, generation);
    if (direct) {
      if (
        mode === "probing" &&
        provider === "cloudflare-realtime" &&
        !engine.nativeSession?.activeSfuProvider
      ) {
        try {
          await engine.nativeSession?.activateProvider?.(provider);
          assertCurrentNativeTopology(engine, topologyKey, generation);
          await waitForNativeMediaReadiness(
            engine,
            topology,
            "sfu",
            topologyKey,
            generation,
          );
        } catch (error) {
          fallbackActivationFailed = true;
          throw error;
        }
      }
      await engine.nativeP2pSession?.applyTopology(p2pTopology);
      assertCurrentNativeTopology(engine, topologyKey, generation);
      if (mode === "p2p") {
        await engine.nativeSession?.activateProvider?.("mediasoup", {
          closeMedia: true,
        });
        assertCurrentNativeTopology(engine, topologyKey, generation);
        await waitForNativeMediaReadiness(
          engine,
          topology,
          "p2p",
          topologyKey,
          generation,
        );
        engine.nativeProvider = "p2p";
      } else if (mode === "switching" && target === "p2p")
        await waitForNativeMediaReadiness(
          engine,
          topology,
          "p2p",
          topologyKey,
          generation,
        );
      if (mode === "switching" && target === "p2p") {
        await engine.nativeSession?.activateProvider?.("mediasoup", {
          closeMedia: true,
        });
        assertCurrentNativeTopology(engine, topologyKey, generation);
        engine.nativeProvider = "p2p";
      }
    } else {
      await engine.nativeP2pSession?.applyTopology({
        ...p2pTopology,
        mode: "idle",
      });
      assertCurrentNativeTopology(engine, topologyKey, generation);
      if (mode === "sfu" || target === "sfu") {
        await engine.nativeSession?.activateProvider?.(provider, {
          ensureMedia: true,
        });
        assertCurrentNativeTopology(engine, topologyKey, generation);
        await waitForNativeMediaReadiness(
          engine,
          topology,
          "sfu",
          topologyKey,
          generation,
        );
      } else if (mode === "idle") {
        await engine.nativeSession?.activateProvider?.("mediasoup");
      }
      engine.nativeProvider = "sfu";
    }
    assertCurrentNativeTopology(engine, topologyKey, generation);
    engine._syncNativeFeeds();
    if (mode === "switching" && (target === "p2p" || target === "sfu")) {
      engine.nativeSession?.signaling?.send?.({
        type: "topology-ready",
        data: {
          provider,
          ...(providerId ? { providerId } : {}),
          epoch: topology.epoch,
          target,
          sourceRevision: topology.sourceRevision,
        },
      });
    }
  } catch (error) {
    const errorLike = error as NativeErrorLike;
    if (
      errorLike.code === "NATIVE_TOPOLOGY_SUPERSEDED" ||
      !isCurrentNativeTopology(engine, topologyKey, generation)
    )
      return;
    if (fallbackActivationFailed)
      engine.nativeSession?.signaling?.send?.({
        type: "provider-failure",
        data: {
          provider,
          ...(providerId ? { providerId } : {}),
          epoch: topology.epoch,
          sourceRevision: topology.sourceRevision,
          reason: errorLike.message || "native-sfu-fallback-failed",
        },
      });
    else if (direct) reportNativeP2pFailure(engine, error);
    else if (target === "sfu" || mode === "sfu")
      engine.nativeSession?.signaling?.send?.({
        type: mode === "switching" ? "topology-failed" : "provider-failure",
        data:
          mode === "switching"
            ? {
                provider,
                ...(providerId ? { providerId } : {}),
                epoch: topology.epoch,
                target: "sfu",
                sourceRevision: topology.sourceRevision,
                reason: errorLike.message || "native-sfu-transition-failed",
              }
            : {
                provider,
                ...(providerId ? { providerId } : {}),
                epoch: topology.epoch,
                sourceRevision: topology.sourceRevision,
                reason: errorLike.message || "native-sfu-activation-failed",
              },
      });
    engine._emit("error", { source: "native-p2p", error });
    throw error;
  }
}

export function reportNativeP2pFailure(
  engine: NativeMediaEngine,
  error: unknown,
): void {
  const topology = engine.nativeSession?.topologyState;
  const mode = String(topology?.mode || "");
  const target = String(topology?.target || "");
  if (!(mode === "probing" || mode === "p2p" || target === "p2p")) return;
  const epoch = Number(topology?.epoch);
  if (!Number.isFinite(epoch) || engine.nativeP2pFailureEpoch === epoch) return;
  engine.nativeP2pFailureEpoch = epoch;
  engine.nativeSession?.signaling?.send?.({
    type: "p2p-failed",
    data: {
      epoch,
      reason: `native-direct-path-${(error as NativeErrorLike).message || "failed"}`,
    },
  });
}

export async function setTopology(
  engine: NativeMediaEngine,
  topology: NativeTopology,
) {
  if (!engine.flags.nativeRtc || !hasNativeCapability(engine.flags)) return;
  await handleNativeTopology(engine, topology);
  const identity = resolveMediaProviderIdentity(
    topology,
    topology.target === "sfu" || topology.mode === "switching",
  );
  const resolvedProvider =
    identity.provider || engine.nativeSession?.selectedProvider || "mediasoup";
  if (
    engine.nativeTopologyKey !==
    nativeTopologyKey(topology, resolvedProvider, identity.providerId)
  )
    return;
  await engine._invoke("media_set_topology", { topology }).catch(() => {});
}

export async function setIceServers(
  engine: NativeMediaEngine,
  iceServers: unknown[],
) {
  if (!engine.flags.nativeRtc || !hasNativeCapability(engine.flags)) return;
  await engine._invoke("media_set_ice_servers", { iceServers }).catch(() => {});
}

export async function shutdown(engine: NativeMediaEngine) {
  engine._stopNativeAudioTelemetry();
  engine._stopNativeVideoAdaptation();
  if (engine.qoeTimer) clearInterval(engine.qoeTimer);
  engine.qoeTimer = null;
  engine.nativeTopologyGeneration =
    (Number(engine.nativeTopologyGeneration) || 0) + 1;
  engine.nativeTopologyKey = null;
  await engine.nativeTopologyOperation?.catch(() => {});
  engine.nativeTopologyOperation = null;
  if (engine.flags.nativeRtc && hasNativeCapability(engine.flags)) {
    await engine.nativeP2pSession?.shutdown().catch(() => undefined);
    await engine.nativeSession?.disconnect().catch(() => undefined);
    await engine._invoke("media_shutdown").catch(() => undefined);
  }
  if (!engine.nativeOnly) await engine.browserEngine.shutdown?.();
  await Promise.allSettled(
    engine.unlisten.splice(0).map((unlisten: () => void) => unlisten()),
  );
  engine.listeners.clear();
  engine.initialized = false;
  engine.nativeSession = null;
  engine.nativeP2pSession = null;
  engine.nativeActionHandler = null;
  engine.remoteVideoFeedsRef.value = new Map();
  engine.remoteAudioFeedsRef.value = new Map();
  triggerRef(engine.remoteVideoFeedsRef);
  triggerRef(engine.remoteAudioFeedsRef);
}

export function mergeNativeCapabilities(
  engine: NativeMediaEngine,
  capabilities: NativeCapabilities = {},
) {
  const mapping = {
    nativeRtc: "nativeRtc",
    nativeBackendReady: "nativeBackendReady",
    screenVideo: "nativeScreenShare",
    nativeScreenShare: "nativeScreenShare",
    screenAudio: "nativeScreenAudio",
    nativeScreenAudio: "nativeScreenAudio",
    microphone: "nativeMicrophone",
    nativeMicrophone: "nativeMicrophone",
    camera: "nativeCamera",
    nativeCamera: "nativeCamera",
    audioReceive: "nativeAudioReceive",
    nativeAudioReceive: "nativeAudioReceive",
    videoReceive: "nativeVideoReceive",
    nativeVideoReceive: "nativeVideoReceive",
    p2p: "nativeP2P",
    nativeP2P: "nativeP2P",
    sfu: "nativeSfu",
    nativeSfu: "nativeSfu",
  };
  for (const [nativeName, flagName] of Object.entries(mapping)) {
    if (Object.prototype.hasOwnProperty.call(capabilities, nativeName))
      engine.flags[flagName] = capabilities[nativeName] === true;
  }
  const capture = capabilities.capture || {};
  const hasSources = (name: string) =>
    capture[name]?.available === true &&
    Array.isArray(capture[name]?.sources) &&
    capture[name].sources.length > 0;
  if (Object.prototype.hasOwnProperty.call(capture, "microphone"))
    engine.flags.nativeMicrophone = hasSources("microphone");
  if (Object.prototype.hasOwnProperty.call(capture, "camera"))
    engine.flags.nativeCamera = hasSources("camera");
  const videoBackends = [
    "screenCaptureKit",
    "pipewirePortal",
    "x11",
    "windowsGraphicsCapture",
  ];
  const audioBackends = ["screenAudio", "systemAudio", "wasapiProcessLoopback"];
  const videoBackend = videoBackends.find((name) =>
    Object.prototype.hasOwnProperty.call(capture, name),
  );
  const audioBackend = audioBackends.find((name) =>
    Object.prototype.hasOwnProperty.call(capture, name),
  );
  if (videoBackend) engine.flags.nativeScreenShare = hasSources(videoBackend);
  if (audioBackend) engine.flags.nativeScreenAudio = hasSources(audioBackend);
  engine.flags.nativeBackendReady =
    capabilities.nativeRtc === true && capabilities.nativeBackendReady === true;
  if (!engine.flags.nativeBackendReady) {
    for (const flagName of Object.values(mapping))
      engine.flags[flagName] = false;
  }
}

export async function invoke(
  engine: NativeMediaEngine,
  command: string,
  payload: NativeCaptureRequest = {},
): Promise<NativeCaptureRequest> {
  const tauri = await getTauri(engine);
  return (await tauri.invoke(command, payload)) as NativeCaptureRequest;
}

export async function configureNativeIceServers(engine: NativeMediaEngine) {
  const config = engine.nativeConfig || {};
  const configuredPath = String(config.apiPath || "/api").replace(/\/$/, "");
  const serverUrl = String(config.serverUrl || "").replace(/\/$/, "");
  const connectionMode =
    channelMediaPolicy(engine.channelsStore, engine.voiceStore)
      ?.connectionMode || "auto";
  const accessToken = await loadSignalingToken(engine, config);
  if (accessToken) engine.nativeAuthToken = accessToken;
  const authToken = accessToken || engine.nativeAuthToken;
  const endpoint = /^https?:\/\//.test(configuredPath)
    ? `${configuredPath}/config?connectionMode=${encodeURIComponent(String(connectionMode))}`
    : `${serverUrl}${configuredPath}/config?connectionMode=${encodeURIComponent(String(connectionMode))}` ||
      "/api/config";
  if (!endpoint) return;
  try {
    const response = await fetch(endpoint, {
      credentials: "include",
      ...(authToken
        ? { headers: { Authorization: `Bearer ${authToken}` } }
        : {}),
    });
    if (!response.ok) return;
    const iceServers = await response.json();
    if (Array.isArray(iceServers)) await setIceServers(engine, iceServers);
  } catch {}
}

export async function configureNativeControl(
  engine: NativeMediaEngine,
  channelId: string,
  roomId: string,
) {
  const config = engine.nativeConfig || {};
  const configuredPath = String(config.apiPath || "/api").replace(/\/$/, "");
  const serverUrl = String(config.serverUrl || "").replace(/\/$/, "");
  const accessToken = await loadSignalingToken(engine, config);
  if (accessToken) engine.nativeAuthToken = accessToken;
  const authToken = accessToken || engine.nativeAuthToken;
  const derivedRoomId = engine.channelsStore
    ? resolveChannelRoomId(engine.channelsStore.getChannelById?.(channelId)) ||
      String(engine.channelsStore.loadedRoomId || "")
    : "";
  const resolvedRoomId = roomId || derivedRoomId;
  if (!resolvedRoomId) {
    if (!engine.channelsStore) return;
    throw new Error("Room ID is required for media bootstrap");
  }
  const connectionMode =
    channelMediaPolicy(engine.channelsStore, engine.voiceStore)
      ?.connectionMode || "auto";
  const bootstrapEndpoint = /^https?:\/\//.test(configuredPath)
    ? `${configuredPath}/media/bootstrap`
    : `${serverUrl}${configuredPath}/media/bootstrap`;
  const response = await fetch(bootstrapEndpoint, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({
      roomId: resolvedRoomId,
      channelId,
      connectionMode,
      deviceId: getDeviceId(),
    }),
  });
  if (!response.ok) {
    const error = new Error(
      `Media control bootstrap failed: ${response.status}`,
    );
    error.status = response.status;
    throw error;
  }
  engine.nativeSession?.configureControl({
    ...(await response.json()),
    channelId,
  });
}

export async function loadSignalingToken(
  _engine?: NativeMediaEngine,
  _config?: NativeCaptureRequest,
) {
  try {
    const { getSupabaseClient } = await import("../../utils/supabase-client");
    const sessionResult = await getSupabaseClient()?.auth.getSession();
    return sessionResult?.data?.session?.access_token || "";
  } catch {
    return "";
  }
}

export function syncNativeFeeds(engine: NativeMediaEngine) {
  if (!engine.nativeSession) return;
  const nativeVideoFeeds = [...engine.nativeSession.remoteVideoFeeds];
  const nativeAudioFeeds = [...engine.nativeSession.remoteAudioFeeds];
  const p2pVideoFeeds =
    engine.nativeProvider === "p2p"
      ? [...(engine.nativeP2pSession?.trackEntries?.values() || [])].filter(
          (entry) => entry.kind === "video" && !entry.closed,
        )
      : [];
  const p2pAudioFeeds =
    engine.nativeProvider === "p2p"
      ? [...(engine.nativeP2pSession?.trackEntries?.values() || [])].filter(
          (entry) => entry.kind === "audio" && !entry.closed,
        )
      : [];
  const mergeFeeds = (
    nativeFeeds: Iterable<[string, NativeFeed]>,
    p2pFeeds: NativeFeed[],
  ) => {
    const merged = new Map<string, [string, NativeFeed]>();
    for (const [key, entry] of nativeFeeds)
      merged.set(`${String(entry.userId)}:${String(entry.source)}`, [
        key,
        entry,
      ]);
    for (const entry of p2pFeeds) {
      const logicalKey = `${String(entry.userId)}:${String(entry.source)}`;
      const current = merged.get(logicalKey)?.[1];
      if (current?.kind === "video" && current.frame && !entry.frame) continue;
      merged.set(logicalKey, [entry.key || logicalKey, entry]);
    }
    return new Map(merged.values());
  };
  engine.remoteVideoFeedsRef.value = mergeFeeds(
    nativeVideoFeeds,
    p2pVideoFeeds,
  );
  engine.remoteAudioFeedsRef.value = mergeFeeds(
    nativeAudioFeeds,
    p2pAudioFeeds,
  );
  triggerRef(engine.remoteVideoFeedsRef);
  triggerRef(engine.remoteAudioFeedsRef);
}

export function syncLocalFeeds(engine: NativeMediaEngine) {
  if (!engine.nativeSession) return;
  const feeds = new Map(engine.nativeSession.localVideoFeeds);
  for (const [source, entry] of engine.nativeSession.sources || []) {
    const kind =
      entry?.kind ||
      (source === "camera" || source === "screen" ? "video" : "audio");
    if (kind !== "video" || feeds.has(source)) continue;
    feeds.set(source, {
      source,
      producerId: `local:${source}`,
      native: true,
      surfaceId: `local:${source}`,
      frame: null,
    });
  }
  engine.localVideoFeedsRef.value = feeds;
  triggerRef(engine.localVideoFeedsRef);
}

function decodeNativeAction(
  engine: NativeMediaEngine,
  action: NativeCaptureRequest,
): NativeCaptureRequest | null {
  if (!action.kind && !action.state) return null;
  let params = null;
  if (typeof action.paramsJson === "string") {
    try {
      params = JSON.parse(action.paramsJson);
    } catch (error) {
      engine._emit("error", {
        source: "native",
        operation: "native-event",
        error,
      });
    }
  }
  let state = action.state;
  if (typeof state === "string") {
    try {
      state = JSON.parse(state);
    } catch {}
  }
  return {
    ...action,
    type:
      action.kind === 1
        ? "transport-connect"
        : action.kind === 2
          ? "produce"
          : action.kind === 3 || action.kind === 4
            ? "consumer-event"
            : "transport-state",
    params,
    state,
  };
}

export async function dispatchNativeAction(
  engine: NativeMediaEngine,
  action: NativeCaptureRequest,
) {
  const nativeAction = decodeNativeAction(engine, action);
  if (!nativeAction) return;
  engine._emit("native-action", nativeAction);
  try {
    await engine.nativeActionHandler?.(nativeAction);
    if (nativeAction.state)
      engine._emit("ice-state", {
        transportPtr: nativeAction.transportPtr,
        state: nativeAction.state,
      });
  } catch (error) {
    engine._emit("error", {
      source: "native",
      operation: "native-event",
      error,
    });
    if (nativeAction.kind === 1) {
      await engine
        ._invoke("media_fail_connect", {
          transportPtr: nativeAction.transportPtr,
          error:
            (error as NativeErrorLike).message ||
            "Native transport connection failed",
        })
        .catch(() => {});
    } else if (nativeAction.kind === 2) {
      await engine
        ._invoke("media_fail_produce", {
          actionId: nativeAction.actionId,
          error:
            (error as NativeErrorLike).message ||
            "Native producer creation failed",
        })
        .catch(() => {});
    }
  }
}

export function dispatchNativeReceiveEvent(
  engine: NativeMediaEngine,
  receiveEvent: NativeCaptureRequest,
) {
  if (Number(receiveEvent.kind) === 7) {
    handleNativeAudioTelemetry(
      engine,
      (receiveEvent.payload || {}) as Record<string, unknown>,
    );
    return;
  }
  engine.nativeReceiveEventHandler?.(receiveEvent);
  syncLocalFeeds(engine);
  syncNativeFeeds(engine);
  engine._emit("native-receive-event", receiveEvent);
}

export async function bindNativeEvents(engine: NativeMediaEngine) {
  const tauri = await getTauri(engine);
  if (!tauri.listen || engine.unlisten.length > 0) return;
  for (const eventName of NATIVE_EVENT_NAMES) {
    const unlisten = await tauri.listen(
      eventName,
      ({ payload }: { payload: unknown }) => {
        const event = EVENT_ALIASES[eventName as keyof typeof EVENT_ALIASES];
        const task =
          event === "native-action"
            ? () =>
                dispatchNativeAction(engine, payload as NativeCaptureRequest)
            : event === "native-receive-event"
              ? () => {
                  dispatchNativeReceiveEvent(
                    engine,
                    payload as NativeCaptureRequest,
                  );
                }
              : () => {
                  engine._emit(event, payload);
                };
        const previous = engine.nativeEventOperation || Promise.resolve();
        const operation = previous.catch(() => {}).then(task);
        engine.nativeEventOperation = operation;
        operation
          .finally(() => {
            if (engine.nativeEventOperation === operation)
              engine.nativeEventOperation = null;
          })
          .catch(() => {});
      },
    );
    engine.unlisten.push(unlisten);
  }
}

export async function getTauri(engine: NativeMediaEngine) {
  if (engine.tauri) return engine.tauri;
  const [{ invoke }, { listen }] = await Promise.all([
    import("@tauri-apps/api/core"),
    import("@tauri-apps/api/event"),
  ]);
  engine.tauri = {
    invoke: (command, payload = {}) =>
      invoke("media_worker_invoke", { command, payload }),
    listen,
  };
  return engine.tauri;
}
