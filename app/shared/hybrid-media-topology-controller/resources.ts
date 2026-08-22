import { mediaDebug } from "../media-debug.ts";
import { closeMediaProviderSafely } from "../media-session-cleanup.ts";
import { remoteMediaFeedKey } from "../remote-media-handoff.ts";
import type {
  TopologyResourceHelpersContext,
  TopologySourceEntry,
} from "../types/topology-controller.ts";
import type { P2pIcePolicy } from "../types/native-p2p.ts";
import { isExternalString } from "../types/boundary.ts";
import { normalizeP2pIcePolicy } from "../native-p2p-common.ts";

function isTopologySourceEntry(
  value: Record<string, unknown>,
): value is TopologySourceEntry {
  return (
    isExternalString(value.source) &&
    globalThis.MediaStreamTrack instanceof Function &&
    value.track instanceof globalThis.MediaStreamTrack
  );
}

export function createTopologyResourceHelpers({
  NativeP2pMesh,
  buildP2pVideoSenderOptions,
  buildVoiceProducerOptions,
  closeSocket,
  getActiveProvider,
  getAudioStereo,
  getEffectiveAudioBitrate,
  getIceServers,
  getMediaCapabilities = () => null,
  getP2pMesh,
  getRequestedVideoSettings,
  getSelectedSfuProvider,
  getSfu,
  handoff,
  iceConnectedBoth,
  mediaConnectionState,
  onP2pQualification,
  requestedP2pPolicy,
  send,
  setActiveProvider,
  setP2pMesh,
  setProviderSocket,
  setSfu,
  setConnectionPhase,
  topologyState,
  transportReady,
  updateP2pStats,
  getConnectionEpoch,
}: TopologyResourceHelpersContext) {
  function ensureP2p(policy?: P2pIcePolicy) {
    const requested = normalizeP2pIcePolicy(policy ?? requestedP2pPolicy());
    const existing = getP2pMesh();
    if (
      (existing && existing.p2pIcePolicy === requested) ||
      !(globalThis.RTCPeerConnection instanceof Function)
    )
      return existing;
    if (existing) void closeP2pSafely();
    const mesh = new NativeP2pMesh({
      iceServers: getIceServers(),
      p2pIcePolicy: requested,
      sendSignal: (payload) =>
        payload.type === "ready"
          ? send({ type: "p2p-qualified", data: payload })
          : send({ type: "p2p-signal", data: payload }),
      onRemoteTrack: (entry) => {
        if (!isTopologySourceEntry(entry)) return;
        handoff.stage(
          {
            ...entry,
            key: entry.key || remoteMediaFeedKey(entry),
            provider: "p2p",
          },
          getActiveProvider(),
        );
      },
      onRemoteTrackEnded: (entry) => {
        if (!isTopologySourceEntry(entry)) return;
        handoff.remove({
          ...entry,
          key: entry.key || remoteMediaFeedKey(entry),
          provider: "p2p",
        });
      },
      onFailure: (reason: string, error: Error | string | null = null) =>
        send({ type: "p2p-failed", data: { reason, error } }),
      onSnapshot: (snapshot: Record<string, unknown>[]) =>
        updateP2pStats(Array.isArray(snapshot) ? snapshot : []),
      getAudioStereo,
      mediaCapabilities: getMediaCapabilities(),
      getControlConnectionEpoch: getConnectionEpoch,
      getSenderOptions: (source, track) => {
        if (track.kind === "audio") {
          const options = buildVoiceProducerOptions(
            track,
            getEffectiveAudioBitrate(source),
            getAudioStereo(source),
          );
          return { encodings: options.encodings };
        }
        const settings = track.getSettings?.() || {};
        const requested = getRequestedVideoSettings(source);
        const options = buildP2pVideoSenderOptions({
          width: settings.width,
          height: settings.height,
          frameRate: requested.frameRate,
          qualityPriority: requested.qualityPriority,
          screen: source === "screen",
          maxBitrate: requested.maxBitrate,
        });
        const ceiling = requested.maxBitrate;
        if (ceiling && options.encodings?.[0])
          options.encodings[0].maxBitrate = Math.min(
            options.encodings[0].maxBitrate || ceiling,
            ceiling,
          );
        return options;
      },
    });
    setP2pMesh(mesh);
    mediaDebug("topology.p2p-created", { iceServers: getIceServers().length });
    return mesh;
  }

  async function closeP2pSafely() {
    const provider = getP2pMesh();
    const wasActive = getActiveProvider() === "p2p";

    setP2pMesh(null);

    if (wasActive) {
      setActiveProvider(null);
    }

    await closeMediaProviderSafely(provider, "P2P");
  }

  async function closeSfuSafely() {
    const provider = getSfu();
    const wasActive = getActiveProvider() === "sfu";

    setSfu(null);

    if (wasActive) {
      setActiveProvider?.(null);
    }

    await closeMediaProviderSafely(provider, "SFU");
  }

  function handleProviderFailure(data: Record<string, unknown> = {}) {
    const activeSfu = getSfu();
    const activeProvider =
      activeSfu?.provider || getSelectedSfuProvider() || null;
    const activeProviderId =
      activeSfu?.providerId || topologyState.value.providerId;
    const epoch = Number(data.epoch);
    const sourceRevision = Number(data.sourceRevision);
    if (
      !data.provider ||
      getActiveProvider() !== "sfu" ||
      data.provider !== activeProvider ||
      (data.providerId &&
        activeProviderId &&
        data.providerId !== activeProviderId) ||
      (Number.isSafeInteger(epoch) && epoch < topologyState.value.epoch) ||
      !Number.isSafeInteger(sourceRevision) ||
      sourceRevision !== Number(topologyState.value.sourceRevision || 0)
    )
      return;
    mediaConnectionState.value = "recovering";
    transportReady.value = false;
    iceConnectedBoth.value = false;
    handoff.retire("sfu");
    closeSocket();
    setProviderSocket(null);
    setActiveProvider(null);
    void closeSfuSafely();
    setConnectionPhase("reconnecting", {
      topologyEpoch: Number(data.epoch) || topologyState.value.epoch,
      reason: data.reason || "provider-failure",
    });
    mediaDebug("topology.provider-failure", {
      provider: data.provider,
      providerId: data.providerId,
      epoch: data.epoch,
      reason: data.reason,
    });
  }

  function handleProviderRecovering(data: Record<string, unknown> = {}) {
    const retryAt = Number(data.retryAt);
    const reason = data.reason || "provider-recovering";
    if (!Number.isSafeInteger(retryAt) || retryAt <= Date.now()) return;
    mediaConnectionState.value = "recovering";
    setConnectionPhase("reconnecting", {
      topologyEpoch: topologyState.value.epoch,
      reason,
      retryAt,
    });
    mediaDebug("topology.provider-recovering", {
      retryAt,
      retryAfterMs: data.retryAfterMs,
      reason,
    });
  }

  function handleP2pQualification(data: Record<string, unknown> = {}) {
    const epoch = Number(data.epoch);
    if (!Number.isSafeInteger(epoch) || epoch < topologyState.value.epoch)
      return;
    topologyState.value = {
      ...topologyState.value,
      qualification: {
        acknowledged: data.acknowledged === true,
        failed: data.type === "p2p-failed" || data.failed === true,
        reason: data.reason || null,
        epoch,
      },
    };
    onP2pQualification?.(data);
    if (data.failed === true || data.type === "p2p-failed")
      mediaConnectionState.value = "recovering";
  }

  return {
    closeP2pSafely,
    closeSfuSafely,
    ensureP2p,
    handleP2pQualification,
    handleProviderFailure,
    handleProviderRecovering,
  };
}
