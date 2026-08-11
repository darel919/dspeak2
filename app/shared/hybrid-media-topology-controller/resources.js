import { mediaDebug } from "../media-debug.js";
import { closeMediaProviderSafely } from "../media-session-cleanup.js";

export function createTopologyResourceHelpers({
  NativeP2pMesh,
  buildP2pVideoSenderOptions,
  buildVoiceProducerOptions,
  closeSocket,
  getActiveProvider,
  getAudioStereo,
  getEffectiveAudioBitrate,
  getIceServers,
  getP2pMesh,
  getRequestedVideoSettings,
  getSelectedSfuProvider,
  getSfu,
  handoff,
  iceConnectedBoth,
  mediaConnectionState,
  onP2pQualification,
  send,
  setActiveProvider,
  setP2pMesh,
  setProviderSocket,
  setSfu,
  setConnectionPhase,
  topologyState,
  transportReady,
  updateP2pStats,
}) {
  function ensureP2p() {
    const existing = getP2pMesh();
    if (existing || typeof RTCPeerConnection === "undefined") return existing;
    const mesh = new NativeP2pMesh({
      iceServers: getIceServers(),
      sendSignal: (payload) =>
        payload.type === "ready"
          ? send({ type: "p2p-qualified", data: payload })
          : send({ type: "p2p-signal", data: payload }),
      onRemoteTrack: (entry) =>
        handoff.stage({ ...entry, provider: "p2p" }, getActiveProvider()),
      onRemoteTrackEnded: (entry) =>
        handoff.remove({ ...entry, provider: "p2p" }),
      onFailure: (failure) => send({ type: "p2p-failed", data: failure }),
      onSnapshot: updateP2pStats,
      getAudioStereo,
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
    setP2pMesh(null);
    await closeMediaProviderSafely(provider, "P2P");
  }

  async function closeSfuSafely() {
    const provider = getSfu();
    setSfu(null);
    await closeMediaProviderSafely(provider, "SFU");
  }

  function handleProviderFailure(data = {}) {
    const activeSfu = getSfu();
    const activeProvider =
      activeSfu?.provider || getSelectedSfuProvider() || null;
    const epoch = Number(data.epoch);
    const sourceRevision = Number(data.sourceRevision);
    if (
      !data.provider ||
      getActiveProvider() !== "sfu" ||
      data.provider !== activeProvider ||
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
      epoch: data.epoch,
      reason: data.reason,
    });
  }

  function handleP2pQualification(data = {}) {
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
  };
}
