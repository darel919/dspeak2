import { mediaDebug } from "./media-debug.js";
import { waitForInitialMediaTopology } from "./media-handoff-readiness.js";

export function createHybridMediaSessionLifecycle({
  authStore,
  buildMediaControlSocketUrl,
  channelsStore,
  connected,
  error,
  getIntentionalClose,
  getMediaControlUrl,
  getRoomId,
  getSfu,
  getSupabaseClient,
  handleMediaSignalingClose,
  handoff,
  iceConnectedBoth,
  lastInRoom,
  mediaConnectionState,
  mediaControlApiPath,
  mediaControlTicketState,
  mediaControlSocketUrlState,
  mediaSessionSetup,
  messageHandlers,
  participantSfuRoundTripTimes,
  protocolState,
  protocolUpdateRequired,
  providerRecovery,
  queueTopology,
  remoteProducersCount,
  resetMediaTelemetryState,
  resetTopologySequencing,
  runtimeConnectionTimeoutMs,
  setChannelId,
  setConnectionPhase,
  setIceServers,
  setIntentionalClose,
  setLocalPeerId,
  setMediaControlSocketUrl,
  setMediaControlTicket,
  setP2pMesh,
  setSfu,
  setActiveProvider,
  signaling,
  syncConnectedUsers,
  topologyState,
  transportReady,
  voiceStore,
}) {
  let activeBootstrapContext = null;
  let refreshTicketPromise = null;

  async function loadIceServers(connectionMode, accessToken) {
    const nextIceServers = await $fetch(
      `${mediaControlApiPath}/config?connectionMode=${encodeURIComponent(connectionMode)}`,
      accessToken
        ? { headers: { Authorization: `Bearer ${accessToken}` } }
        : undefined,
    );
    if (!Array.isArray(nextIceServers))
      throw new Error("The ICE server configuration is invalid");
    setIceServers(nextIceServers);
    return nextIceServers;
  }

  async function refreshControlTicket() {
    if (!activeBootstrapContext || !getMediaControlUrl()) return null;
    if (refreshTicketPromise) return refreshTicketPromise;
    const refresh = (async () => {
      const supabaseClient = getSupabaseClient();
      const sessionResult = await supabaseClient?.auth.getSession();
      const accessToken = sessionResult?.data?.session?.access_token;
      await loadIceServers(activeBootstrapContext.connectionMode, accessToken);
      const bootstrap = await mediaSessionSetup.getBootstrap({
        accessToken,
        baseApiPath: activeBootstrapContext.baseApiPath,
        channelId: activeBootstrapContext.channelId,
        connectionMode: activeBootstrapContext.connectionMode,
        deviceId: activeBootstrapContext.deviceId,
        roomId: activeBootstrapContext.roomId,
      });
      const controlUrl = getMediaControlUrl();
      setMediaControlSocketUrl(
        buildMediaControlSocketUrl({
          mediaControlUrl: bootstrap.mediaControlUrl || controlUrl,
          channelId: activeBootstrapContext.channelId,
          ticket: bootstrap.ticket,
        }),
      );
      setMediaControlTicket(bootstrap.ticket);
      mediaDebug("session.control-ticket-refreshed", {
        channelId: activeBootstrapContext.channelId,
        connectionMode: activeBootstrapContext.connectionMode,
      });
      return bootstrap;
    })();
    const tracked = refresh.finally(() => {
      if (refreshTicketPromise === tracked) refreshTicketPromise = null;
    });
    refreshTicketPromise = tracked;
    tracked.catch(() => {});
    return tracked;
  }

  function openSocket(channelId) {
    const userId = authStore.getUserData()?.id;
    if (!userId) return Promise.reject(new Error("User not authenticated"));
    if (!channelId) return Promise.reject(new Error("Channel ID is required"));
    return signaling.open();
  }

  async function connect(nextChannelId, options = {}) {
    if (connected.value && mediaSessionSetup.getChannelId() === nextChannelId)
      return;
    mediaDebug("session.connect-start", {
      channelId: nextChannelId,
      roomId: options.roomId || getRoomId(),
    });
    setIntentionalClose(false);
    protocolUpdateRequired.value = false;
    setChannelId(nextChannelId);
    mediaControlSocketUrlState.value = null;
    mediaControlTicketState.value = null;
    error.value = null;
    mediaSessionSetup.resetLifecycle();
    setConnectionPhase("socket-connecting");
    const channel = channelsStore.getChannelById(nextChannelId);
    const channelPolicy = channel?.mediaPolicy;
    const connectionMode = channelPolicy?.connectionMode || "auto";
    const roomId = options.roomId || getRoomId() || channel?.room?.id || null;
    const supabaseClient = getSupabaseClient();
    const sessionResult = await supabaseClient?.auth.getSession();
    const accessToken = sessionResult?.data?.session?.access_token;
    await loadIceServers(connectionMode, accessToken);
    const controlUrl = getMediaControlUrl();
    if (controlUrl) {
      const deviceId = mediaSessionSetup.getDeviceId();
      const bootstrapContext = {
        baseApiPath: mediaControlApiPath,
        channelId: nextChannelId,
        connectionMode,
        deviceId,
        roomId,
      };
      const bootstrap = await mediaSessionSetup.getBootstrap({
        accessToken,
        baseApiPath: mediaControlApiPath,
        channelId: nextChannelId,
        connectionMode,
        deviceId,
        roomId,
      });
      activeBootstrapContext = bootstrapContext;
      setMediaControlSocketUrl(
        buildMediaControlSocketUrl({
          mediaControlUrl: bootstrap.mediaControlUrl || controlUrl,
          channelId: nextChannelId,
          ticket: bootstrap.ticket,
        }),
      );
      setMediaControlTicket(bootstrap.ticket);
    }
    setupHandlers();
    await openSocket(nextChannelId);
    await waitForInitialMediaTopology({
      isReady: () => topologyState.value.epoch > 0,
      setWaiter: mediaSessionSetup.setTopologyWaiter,
      timeoutMs: runtimeConnectionTimeoutMs,
    });
    mediaDebug("session.lifecycle-ready", {
      channelId: nextChannelId,
      topologyEpoch: topologyState.value.epoch,
      topologyMode: topologyState.value.mode,
    });
  }

  function handleSignalingClose(event, protocolRejected) {
    connected.value = false;
    protocolState.value = null;
    mediaDebug("session.signaling-close", {
      code: event?.code,
      reason: event?.reason,
      protocolRejected,
      intentional: getIntentionalClose(),
    });
    if (getIntentionalClose()) return;
    if (protocolRejected)
      mediaSessionSetup.resolveTopologyWaiter?.(
        new Error(event.reason || "Media signaling protocol was rejected"),
      );
    handleMediaSignalingClose({
      closeProviders: () =>
        mediaSessionSetup.closeProviders({
          getP2pMesh: mediaSessionSetup.getP2pMesh,
          getSfu: mediaSessionSetup.getSfu,
          handoff,
        }),
      mediaConnectionState,
      protocolRejected,
      resetTelemetry: () =>
        resetMediaTelemetryState({
          mediaPathMetrics: mediaSessionSetup.mediaPathMetrics,
          peerRoundTripTimes: mediaSessionSetup.peerRoundTripTimes,
          peerConnectionMetrics: mediaSessionSetup.peerConnectionMetrics,
          sfuRoundTripTime: mediaSessionSetup.sfuRoundTripTime,
          participantSfuRoundTripTimes,
          remoteProducersCount,
          iceConnectedBoth,
        }),
      resetMediaState: () => {
        setP2pMesh(null);
        setSfu(null);
        setActiveProvider(null);
        mediaConnectionState.value = "failed";
        transportReady.value = false;
        iceConnectedBoth.value = false;
        resetTopologySequencing();
        setConnectionPhase("failed", {
          code: event.code,
          reason: event.reason || "protocol-rejected",
        });
      },
      onRecovering: () =>
        setConnectionPhase("reconnecting", {
          code: event.code,
          reason: event.reason || "signaling-closed",
        }),
    });
  }

  function setupHandlers() {
    if (messageHandlers.size) return;
    const { ensureP2p, ensureSfu, sendParticipantVoiceState } =
      mediaSessionSetup;
    mediaSessionSetup.setupMessageHandlers({
      ensureP2p,
      getHeartbeatSequence: signaling.getHeartbeatSequence,
      getLastHeartbeatAckSequence: signaling.getLastHeartbeatAckSequence,
      getSfu: ensureSfu,
      getSocket: signaling.getSocket,
      lastInRoom,
      participantSfuRoundTripTimes,
      queueTopology,
      registerHandler: (type, handler) => messageHandlers.set(type, handler),
      remoteProducersCount,
      onServerConnected: () => {
        if (signaling.markReady()) {
          connected.value = true;
          setConnectionPhase("signaling-ready", {
            mediaSessionId: protocolState.value?.mediaSessionId,
            protocolVersion: protocolState.value?.protocolVersion,
          });
        }
        mediaSessionSetup.sendSourceState();
        sendParticipantVoiceState();
      },
      onServerHello: (data) => {
        if (signaling.acceptServerHello(data))
          protocolState.value = signaling.getProtocolState();
      },
      onAttenuationState: mediaSessionSetup.receiveAttenuation,
      onProviderFailure: mediaSessionSetup.handleProviderFailure,
      onProviderRecovering: providerRecovery.receive,
      onP2pQualification: mediaSessionSetup.handleP2pQualification,
      onProviderTicket: (data) => mediaSessionSetup.handleProviderTicket(data),
      setHeartbeatAck: signaling.acknowledgeHeartbeat,
      setLocalPeerId,
      sfuProducerIds: mediaSessionSetup.sfuProducerIds,
      syncConnectedUsers,
      voiceStore,
    });
    messageHandlers.set("cloudflare-response", (data) =>
      getSfu()?.handle("cloudflare-response", data),
    );
    messageHandlers.set("cloudflare-publication-available", (data) =>
      getSfu()
        ? getSfu().handle("cloudflare-publication-available", data)
        : mediaSessionSetup.queueCloudflarePublication(data),
    );
  }

  return { connect, handleSignalingClose, refreshControlTicket };
}
