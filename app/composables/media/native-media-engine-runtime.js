import { triggerRef } from "vue";
import { getDeviceId } from "../../shared/device-identity.js";
import { resolveChannelRoomId } from "../../shared/media/channel-room.js";
import {
  EVENT_ALIASES,
  NATIVE_ACTION_POLL_ACTIVE_MS,
  NATIVE_ACTION_POLL_IDLE_MS,
  NATIVE_EVENT_NAMES,
  channelMediaPolicy,
  hasNativeCapability,
} from "./native-media-engine-common.js";

const NATIVE_MEDIA_READINESS_TIMEOUT_MS = 10_000;
const NATIVE_MEDIA_READINESS_POLL_MS = 100;

function expectedInboundSources(topology, localPeerId) {
  return (Array.isArray(topology.peers) ? topology.peers : [])
    .filter((peer) => String(peer.peerId || "") !== String(localPeerId || ""))
    .reduce(
      (count, peer) =>
        count + (Array.isArray(peer.sources) ? peer.sources.length : 0),
      0,
    );
}

function nativeTopologyKey(topology, provider) {
  return `${String(topology.mode || "idle")}:${topology.epoch}:${String(topology.target || "")}:${provider}:${topology.sourceRevision}`;
}

function isCurrentNativeTopology(engine, topologyKey, generation) {
  return (
    engine.nativeTopologyKey === topologyKey &&
    engine.nativeTopologyGeneration === generation
  );
}

function assertCurrentNativeTopology(engine, topologyKey, generation) {
  if (isCurrentNativeTopology(engine, topologyKey, generation)) return;
  const error = new Error("Native topology operation was superseded");
  error.code = "NATIVE_TOPOLOGY_SUPERSEDED";
  throw error;
}

async function waitForNativeMediaReadiness(
  engine,
  topology,
  provider,
  topologyKey,
  generation,
) {
  const mediaSession =
    provider === "p2p" ? engine.nativeP2pSession : engine.nativeSession;
  if (typeof mediaSession?.mediaReadiness !== "function") return true;
  const localPeerId =
    topology.localPeerId ||
    mediaSession.localPeerId ||
    engine.nativeSession?.localPeerId;
  const topologyInbound = expectedInboundSources(topology, localPeerId);
  const startedAt = Date.now();
  let latest = null;
  while (Date.now() - startedAt < NATIVE_MEDIA_READINESS_TIMEOUT_MS) {
    assertCurrentNativeTopology(engine, topologyKey, generation);
    const observedInbound = Number(
      mediaSession.expectedInboundFlowCount?.() || 0,
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

export function handleNativeTopology(engine, topology = {}) {
  const mode = String(topology.mode || "idle");
  const target = String(topology.target || "");
  const provider = String(
    topology.provider ||
      topology.targetProvider ||
      topology.route?.provider ||
      engine.nativeSession?.selectedProvider ||
      "mediasoup",
  );
  const topologyKey = nativeTopologyKey(topology, provider);
  if (engine.nativeTopologyKey === topologyKey)
    return engine.nativeTopologyOperation || Promise.resolve();
  const generation = (Number(engine.nativeTopologyGeneration) || 0) + 1;
  engine.nativeTopologyGeneration = generation;
  engine.nativeTopologyKey = topologyKey;
  const previousOperation = engine.nativeTopologyOperation || Promise.resolve();
  const operation = previousOperation
    .catch(() => {})
    .then(() =>
      applyNativeTopology(engine, topology, provider, topologyKey, generation),
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
  engine,
  topology,
  provider,
  topologyKey,
  generation,
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
        await engine.nativeSession?.activateProvider?.("mediasoup");
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
    } else {
      await engine.nativeP2pSession?.applyTopology({
        ...p2pTopology,
        mode: "idle",
      });
      assertCurrentNativeTopology(engine, topologyKey, generation);
      if (mode === "sfu" || target === "sfu") {
        await engine.nativeSession?.activateProvider?.(provider);
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
          epoch: topology.epoch,
          target,
          sourceRevision: topology.sourceRevision,
        },
      });
    }
  } catch (error) {
    if (
      error?.code === "NATIVE_TOPOLOGY_SUPERSEDED" ||
      !isCurrentNativeTopology(engine, topologyKey, generation)
    )
      return;
    if (fallbackActivationFailed)
      engine.nativeSession?.signaling?.send?.({
        type: "provider-failure",
        data: {
          provider,
          epoch: topology.epoch,
          sourceRevision: topology.sourceRevision,
          reason: error?.message || "native-sfu-fallback-failed",
        },
      });
    else if (direct) reportNativeP2pFailure(engine, error);
    else if (target === "sfu" || mode === "sfu")
      engine.nativeSession?.signaling?.send?.({
        type: mode === "switching" ? "topology-failed" : "provider-failure",
        data:
          mode === "switching"
            ? {
                epoch: topology.epoch,
                target: "sfu",
                sourceRevision: topology.sourceRevision,
                reason: error?.message || "native-sfu-transition-failed",
              }
            : {
                provider,
                epoch: topology.epoch,
                sourceRevision: topology.sourceRevision,
                reason: error?.message || "native-sfu-activation-failed",
              },
      });
    engine._emit("error", { source: "native-p2p", error });
    throw error;
  }
}

export function reportNativeP2pFailure(engine, error) {
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
      reason: `native-direct-path-${error?.message || "failed"}`,
    },
  });
}

export async function setTopology(engine, topology) {
  if (!engine.flags.nativeRtc || !hasNativeCapability(engine.flags)) return;
  await handleNativeTopology(engine, topology);
  const provider = String(
    topology.provider ||
      topology.targetProvider ||
      topology.route?.provider ||
      engine.nativeSession?.selectedProvider ||
      "mediasoup",
  );
  if (engine.nativeTopologyKey !== nativeTopologyKey(topology, provider))
    return;
  await engine._invoke("media_set_topology", { topology }).catch(() => {});
}

export async function setIceServers(engine, iceServers) {
  if (!engine.flags.nativeRtc || !hasNativeCapability(engine.flags)) return;
  await engine._invoke("media_set_ice_servers", { iceServers }).catch(() => {});
}

export async function shutdown(engine) {
  engine._stopNativeActionPump();
  engine.nativeTopologyGeneration =
    (Number(engine.nativeTopologyGeneration) || 0) + 1;
  engine.nativeTopologyKey = null;
  await engine.nativeTopologyOperation?.catch(() => {});
  engine.nativeTopologyOperation = null;
  if (engine.flags.nativeRtc && hasNativeCapability(engine.flags)) {
    await engine.nativeSession?.disconnect().catch(() => undefined);
    await engine.nativeP2pSession?.shutdown().catch(() => undefined);
    await engine._invoke("media_shutdown").catch(() => undefined);
  }
  if (!engine.nativeOnly) await engine.browserEngine.shutdown();
  await Promise.allSettled(
    engine.unlisten.splice(0).map((unlisten) => unlisten()),
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

export function mergeNativeCapabilities(engine, capabilities = {}) {
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
  const hasSources = (name) =>
    Array.isArray(capture[name]?.sources) && capture[name].sources.length > 0;
  if (Object.prototype.hasOwnProperty.call(capture, "microphone"))
    engine.flags.nativeMicrophone = hasSources("microphone");
  if (Object.prototype.hasOwnProperty.call(capture, "camera"))
    engine.flags.nativeCamera = hasSources("camera");
  if (Object.prototype.hasOwnProperty.call(capture, "screenCaptureKit"))
    engine.flags.nativeScreenShare = hasSources("screenCaptureKit");
  if (Object.prototype.hasOwnProperty.call(capture, "screenAudio"))
    engine.flags.nativeScreenAudio = hasSources("screenAudio");
  engine.flags.nativeBackendReady =
    capabilities.nativeRtc === true && capabilities.nativeBackendReady === true;
  if (!engine.flags.nativeBackendReady) {
    for (const flagName of Object.values(mapping))
      engine.flags[flagName] = false;
  }
}

export async function invoke(engine, command, payload = {}) {
  const tauri = await getTauri(engine);
  return tauri.invoke(command, payload);
}

export async function configureNativeIceServers(engine) {
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
    ? `${configuredPath}/config?connectionMode=${encodeURIComponent(connectionMode)}`
    : `${serverUrl}${configuredPath}/config?connectionMode=${encodeURIComponent(connectionMode)}` ||
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

export async function configureNativeControl(engine, channelId, roomId) {
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

export async function loadSignalingToken() {
  try {
    const { getSupabaseClient } = await import("../../utils/supabase-client");
    const sessionResult = await getSupabaseClient()?.auth.getSession();
    return sessionResult?.data?.session?.access_token || "";
  } catch {
    return "";
  }
}

export function syncNativeFeeds(engine) {
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
  const mergeFeeds = (nativeFeeds, p2pFeeds) => {
    const merged = new Map();
    for (const [key, entry] of nativeFeeds)
      merged.set(`${String(entry.userId)}:${String(entry.source)}`, [
        key,
        entry,
      ]);
    for (const entry of p2pFeeds) {
      const logicalKey = `${String(entry.userId)}:${String(entry.source)}`;
      const current = merged.get(logicalKey)?.[1];
      if (current?.kind === "video" && current.frame && !entry.frame) continue;
      merged.set(logicalKey, [entry.key, entry]);
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

export function syncLocalFeeds(engine) {
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
      frame: null,
    });
  }
  engine.localVideoFeedsRef.value = feeds;
  triggerRef(engine.localVideoFeedsRef);
}

export function startNativeActionPump(engine) {
  if (engine.nativeActionPump || !engine.flags.nativeRtc) return;
  let stopped = false;
  let timer = null;
  const schedule = (delay) => {
    timer = setTimeout(pump, delay);
    timer?.unref?.();
  };
  const pump = async () => {
    if (stopped || !engine.initialized) return;
    let active = false;
    let action = null;
    try {
      action = await engine._invoke("media_poll_action");
      active = Boolean(action?.kind || action?.state);
      if (action?.kind || action?.state) {
        let params = null;
        if (typeof action.paramsJson === "string") {
          try {
            params = JSON.parse(action.paramsJson);
          } catch (error) {
            engine._emit("error", {
              source: "native",
              operation: "action-pump",
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
        const nativeAction = {
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
        engine._emit("native-action", nativeAction);
        await engine.nativeActionHandler?.(nativeAction);
        if (state)
          engine._emit("ice-state", {
            transportPtr: action.transportPtr,
            state,
          });
      }
      const receiveEvent = await engine._invoke("media_poll_receive_event");
      active = active || Boolean(receiveEvent?.kind);
      if (receiveEvent?.kind) {
        engine.nativeReceiveEventHandler?.(receiveEvent);
        syncLocalFeeds(engine);
        syncNativeFeeds(engine);
        engine._emit("native-receive-event", receiveEvent);
      }
    } catch (error) {
      if (!stopped) {
        engine._emit("error", {
          source: "native",
          operation: "action-pump",
          error,
        });
        if (action?.kind === 1) {
          await engine
            ._invoke("media_fail_connect", {
              transportPtr: action.transportPtr,
              error: error?.message || "Native transport connection failed",
            })
            .catch(() => {});
        } else if (action?.kind === 2) {
          await engine
            ._invoke("media_fail_produce", {
              actionId: action.actionId,
              error: error?.message || "Native producer creation failed",
            })
            .catch(() => {});
        }
      }
    }
    if (!stopped)
      schedule(
        active ? NATIVE_ACTION_POLL_ACTIVE_MS : NATIVE_ACTION_POLL_IDLE_MS,
      );
  };
  schedule(0);
  engine.nativeActionPump = {
    stop: () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      engine.nativeActionPump = null;
    },
  };
}

export function stopNativeActionPump(engine) {
  engine.nativeActionPump?.stop?.();
  engine.nativeActionPump = null;
}

export async function bindNativeEvents(engine) {
  const tauri = await getTauri(engine);
  if (!tauri.listen || engine.unlisten.length > 0) return;
  for (const eventName of NATIVE_EVENT_NAMES) {
    const unlisten = await tauri.listen(eventName, ({ payload }) => {
      const event = EVENT_ALIASES[eventName];
      engine._emit(event, payload);
    });
    engine.unlisten.push(unlisten);
  }
}

export async function getTauri(engine) {
  if (engine.tauri) return engine.tauri;
  const [{ invoke }, { listen }] = await Promise.all([
    import("@tauri-apps/api/core"),
    import("@tauri-apps/api/event"),
  ]);
  engine.tauri = { invoke, listen };
  return engine.tauri;
}
