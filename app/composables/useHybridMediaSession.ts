import { computed, getCurrentScope, onScopeDispose, ref, watch } from "vue";
import { useRuntimeConfig } from "#app";
import { MediaCaptureManager } from "~/shared/media-capture.ts";
import { MediasoupClientSession } from "~/shared/mediasoup-client-session.ts";
import { CloudflareRealtimeSession } from "~/shared/cloudflare-realtime-session.ts";
import { createCloudflarePublicationRegistry } from "~/shared/cloudflare-publication-registry.ts";
import type { CloudflarePublication } from "~/shared/types/cloudflare-media.ts";
import { NativeP2pMesh } from "~/shared/native-p2p.ts";
import { createHybridMediaRegistry } from "~/shared/hybrid-media-registry.ts";
import { createHybridMediaAudioState } from "~/shared/hybrid-media-audio-state.ts";
import { RemoteMediaHandoff } from "~/shared/remote-media-handoff.ts";
import { createHybridMediaTopologyController } from "~/shared/hybrid-media-topology-controller.ts";
import { createHybridMediaSessionTermination } from "~/shared/hybrid-media-session-termination.ts";
import { mediaDebug } from "~/shared/media-debug.ts";
import {
  createHybridMediaDiagnostics,
  mediaReadinessSnapshot,
} from "~/shared/hybrid-media-diagnostics.ts";
import { createLocalAudioEngine } from "~/shared/local-audio-engine.ts";
import { registerEchoWarning } from "~/shared/echo-warning.ts";
import {
  buildMediaControlSocketUrl,
  getMediaControlBootstrap,
  getOrCreateDeviceId,
} from "~/shared/media-control-client.ts";
import {
  closeMediaProviders,
  closeMediaSessionTransports,
  handleMediaSignalingClose,
  resetMediaTelemetryState,
} from "~/shared/media-session-cleanup.ts";
import {
  createMediaGeneration,
  initialMediaTopologyState,
} from "~/shared/media-session-state.ts";
import { createMediaTopologyView } from "~/shared/media-topology-view.ts";
import { createMediaLifecycleState } from "~/shared/media-lifecycle-trace.ts";
import { createMediaAudioPolicy } from "~/shared/media-audio-policy.ts";
import { setupMediaMessageHandlers } from "~/shared/media-message-handlers.ts";
import { createHybridMediaSignaling } from "~/shared/hybrid-media-signaling.ts";
import { createMediaSourceController } from "~/shared/media-source-controller.ts";
import { createHybridMediaSessionApi } from "~/shared/hybrid-media-session-api.ts";
import { createHybridMediaSessionRuntime } from "~/shared/hybrid-media-session-runtime.ts";
import { createHybridMediaSessionOperations } from "~/shared/hybrid-media-session-operations.ts";
import { bindMediaVisibility } from "~/shared/media-visibility.ts";
import {
  buildMediaAttenuationWatchKey,
  createMediaAttenuationReporter,
  resolveMediaAttenuation,
} from "~/shared/media-attenuation-reporter.ts";
import { addressFamily, buildTopologyGraph } from "~/shared/rtc-topology.ts";
import {
  collectOutboundAudioStats,
  collectRtpStats,
} from "~/shared/rtc-media-stats.ts";
import type { RtpStatsSample } from "~/shared/rtc-media-stats.ts";
import { hasUsableVoiceRoute } from "~/shared/voice-join-readiness.ts";
import { createProviderRecoveryState } from "~/shared/media-provider-recovery.ts";
import {
  buildP2pVideoSenderOptions,
  resolveRequestedVideoSettings,
} from "~/shared/video-settings.ts";
import { MEDIA_TIMING } from "~/const/media.ts";
import {
  buildVoiceProducerOptions,
  mapPeerConnectionMetrics,
  mapPeerRoundTripTimes,
} from "~/shared/voice-transport.ts";
import {
  shouldAcceptTopologyEvent,
  topologyEventKey,
} from "~~/server/utils/media-transition.ts";
import { MEDIA_SIGNALING_CLIENT_PROTOCOL } from "~~/shared/media-signaling-protocol.ts";
import { useAuthStore } from "~/stores/auth";
import { getSupabaseClient } from "~/utils/supabase-client";
import { useChannelsStore } from "~/stores/channels";
import { useSettingsStore } from "~/stores/settings";
import { useRoomsStore } from "~/stores/rooms";
import { useVoiceStore } from "~/stores/voice";
import {
  automaticGateThreshold,
  createNoiseFloorEstimator,
  microphoneLevelDb,
  updateNoiseFloor,
} from "~/shared/microphone-gate.ts";
import type { MediaVideoFeed } from "~/shared/types/media-source-controller.ts";
import type { RemoteMediaEntry } from "~/shared/types/hybrid-media-registry.ts";
import type {
  RemotePresentationObservationMode,
  RemoteReceiverStats,
} from "~/shared/remote-source-convergence.ts";
import type {
  HybridP2pMesh,
  HybridProviderSocket,
  HybridSessionLifecycle,
  HybridSessionTermination,
  HybridSourceController,
  HybridSfuSession,
  HybridTopologyController,
  HybridTopologyState,
  HybridTopologyWaiter,
} from "~/shared/types/hybrid-media-session.ts";
import type { RuntimeDependencyContext } from "~/shared/types/hybrid-media-session-lifecycle.ts";
import type { HybridMediaSessionApiContext } from "~/shared/types/hybrid-media-session.ts";
import type {
  TopologyData,
  TopologyP2pMesh,
  TopologySourceEntry,
  TopologyState,
} from "~/shared/types/topology-controller.ts";
import type { VideoSettings } from "~/shared/types/video-settings.ts";
import type { WebRtcLatencyProfile } from "~/shared/types/web-rtc-latency.ts";
import type { ParticipantMediaCapabilities } from "~/shared/types/video-codec-capabilities.ts";
import {
  normalizeReceiverStats,
  normalizeVideoStatsReport,
  ownedErrorValue,
  parseCloudflarePublication,
  roomAttenuation,
  TopologyMediasoupProviderSocket,
  videoPolicy,
  audioLatencyPolicy,
  deriveWebMediaLatencyTier,
  type MediaMessageHandler,
} from "~/shared/hybrid-media-session-boundaries.ts";
import { isExternalRecord, isExternalString } from "~/shared/types/boundary.ts";
import {
  parseExternalNumber,
  parseExternalRecord,
  parseExternalValue,
  parseThrownError,
} from "~/utils/external-values.ts";
import type { ExternalValue } from "~/shared/types/boundary.ts";
import type { MediaCommandResult } from "~/shared/types/boundary.ts";
import type { OwnedErrorValue } from "~/shared/types/shared-utilities.ts";

export function useHybridMediaSession() {
  const runtimeConfig = useRuntimeConfig();
  const authStore = useAuthStore();
  const channelsStore = useChannelsStore();
  const settingsStore = useSettingsStore();
  const roomsStore = useRoomsStore();
  const voiceStore = useVoiceStore();
  const connected = ref(false);
  const error = ref<string | null>(null);
  const transportReady = ref(false);
  const iceConnectedBoth = ref(false);
  const mediaConnectionState = ref<string>("disconnected");
  const mediaCapabilities = ref<ParticipantMediaCapabilities | null>(null);
  const protocolUpdateRequired = ref(false);
  const protocolState = ref<Record<string, unknown> | null>(null);
  const playbackState = ref("idle");
  const microphoneDeviceState = ref("preferred");
  const localVideoFeeds = ref<Map<string, MediaVideoFeed>>(new Map());
  const remoteVideoFeeds = ref<Map<string, RemoteMediaEntry>>(new Map());
  const remoteAudioFeeds = ref<Map<string, RemoteMediaEntry>>(new Map());
  const lastInRoom = ref<string[]>([]);
  const remoteProducersCount = ref(0);
  const sharedAudioStats = ref({ kbps: 0, level: 0, dbfs: -60 });
  const echoDetected = ref(false);
  const attenuationReports = ref<Map<string, unknown>>(new Map());
  const peerRoundTripTimes = ref<Record<string, unknown>>({});
  const peerConnectionMetrics = ref<Record<string, unknown>>({});
  const mediaPathMetrics = ref<unknown[]>([]);
  const sfuRoundTripTime = ref<number | null>(null);
  const currentJitterBufferConfig = ref({ minDelayMs: 0, targetDelayMs: 20 });
  const participantSfuRoundTripTimes = ref<Record<string, unknown>>({});
  const activeProviderState = ref<string | null>(null);
  const topologyState = ref<HybridTopologyState>(initialMediaTopologyState());
  const lastAppliedRoomRevision = ref("0");
  const lastAppliedPublicationRevision = ref("0");
  let sessionConnectionEpoch = 1;
  const topologyGraph = ref(
    buildTopologyGraph({ mode: "idle", participantIds: [] }),
  );
  const producers = ref<Map<string, unknown>>(new Map());
  const consumers = ref<Map<string, unknown>>(new Map());
  const messageHandlers = new Map<string, MediaMessageHandler>();
  const localSources = new Map<string, TopologySourceEntry>();
  let channelId: string | null = null;
  const mediaControlSocketUrlState = ref<string | null>(null);
  const mediaControlTicketState = ref<string | null>(null);
  let localPeerId: string | null = null;
  let iceServers: MediaCommandResult[] = [];
  let p2pMesh: HybridP2pMesh | null = null;
  let sfu: HybridSfuSession | null = null;
  let providerSocket: HybridProviderSocket | null = null;
  let selectedSfuProvider = "mediasoup";
  const cloudflarePublications = createCloudflarePublicationRegistry();
  let activeProvider: "sfu" | "p2p" | null = null;
  let intentionalClose = false;
  let topologyWaiter: HybridTopologyWaiter | null = null;
  let lastP2pEdges: MediaCommandResult[] = [];
  const rtpStatsSamples = new Map<string, RtpStatsSample>();
  const reportedSfuFailureState = ref<string | null>(null);
  let nativeSfuStatsCache: {
    promise: Promise<ExternalValue>;
    consumers: number;
  } | null = null;
  async function getReceiverStats(
    entry: RemoteMediaEntry,
  ): Promise<RemoteReceiverStats | null> {
    let directStats: ExternalValue = null;
    try {
      if (entry.consumer?.getStats)
        directStats = parseExternalValue(await entry.consumer.getStats());
      else if (entry.receiver?.getStats)
        directStats = parseExternalValue(await entry.receiver.getStats());
    } catch {
      directStats = null;
    }
    if (directStats) return normalizeReceiverStats(directStats);
    if (entry.provider === "p2p" && entry.track) {
      let report: ExternalValue = null;
      try {
        report = parseExternalValue(
          await p2pMesh?.getInboundTrackStats?.(
            entry.peerId ?? "",
            entry.track,
          ),
        );
      } catch {
        report = null;
      }
      return normalizeReceiverStats(report);
    }
    let reports: ExternalValue = null;
    let statsCache: {
      promise: Promise<ExternalValue>;
      consumers: number;
    } | null = null;
    try {
      if (!sfu?.stats) return null;
      if (!nativeSfuStatsCache) {
        let value: ExternalValue;
        try {
          value = parseExternalValue(sfu.stats());
        } catch {
          return null;
        }
        nativeSfuStatsCache = {
          promise: Promise.resolve(value),
          consumers: 0,
        };
      }
      statsCache = nativeSfuStatsCache;
      statsCache.consumers += 1;
      reports = await statsCache.promise;
    } catch {
      reports = null;
    } finally {
      if (statsCache) {
        statsCache.consumers -= 1;
        if (statsCache.consumers === 0) nativeSfuStatsCache = null;
      }
    }
    if (!Array.isArray(reports)) return null;
    const matching = reports.find((report) => {
      if (!isExternalRecord(report)) return false;
      return (
        String(report.consumerId || report.key || "") ===
          String(entry.consumerId || entry.key || "") ||
        (String(report.trackName || "") ===
          String(entry.cloudflareTrackName || entry.trackName || "") &&
          String(entry.cloudflareTrackName || entry.trackName || "").length >
            0) ||
        (String(report.mid || "") === String(entry.mid || "") &&
          String(entry.mid || "").length > 0) ||
        (String(report.userId || "") === String(entry.userId || "") &&
          String(report.source || "") === String(entry.source || ""))
      );
    });
    return normalizeReceiverStats(matching);
  }

  async function recoverReceiver(
    entry: RemoteMediaEntry,
    _attempt: number,
    signal: AbortSignal,
  ) {
    if (signal.aborted) return false;
    if (entry.provider === "p2p") {
      const peer = p2pMesh?.connections.get(String(entry.peerId || ""));
      if (!peer?.pc) return false;
      peer.pc.restartIce();
      return false;
    }
    const provider = sfu;
    if (!provider) return false;
    if (
      entry.provider === "sfu" &&
      !entry.producerId &&
      entry.cloudflareTrackName &&
      (("recoverRemotePublication" in provider &&
        provider.recoverRemotePublication instanceof Function) ||
        ("subscribe" in provider && provider.subscribe instanceof Function))
    ) {
      if (
        "recoverRemotePublication" in provider &&
        provider.recoverRemotePublication instanceof Function
      )
        await provider.recoverRemotePublication(
          String(entry.cloudflareTrackName),
          entry.receiverIncarnationId,
        );
      else {
        const publication = cloudflarePublications
          .values()
          .find(
            (candidate) =>
              String(candidate.trackName || "") ===
              String(entry.cloudflareTrackName),
          );
        if (
          publication &&
          "subscribe" in provider &&
          provider.subscribe instanceof Function
        )
          await provider.subscribe(publication);
      }
      return false;
    }
    if (entry.provider !== "sfu" || !entry.producerId) return false;
    if (
      !("closeConsumerByProducer" in provider) ||
      !(provider.closeConsumerByProducer instanceof Function) ||
      !("requestConsumer" in provider) ||
      !(provider.requestConsumer instanceof Function)
    )
      return false;
    await provider.closeConsumerByProducer(String(entry.producerId));
    if (signal.aborted) return false;
    provider.requestConsumer(String(entry.producerId));
    return false;
  }

  function failStalledReceiver(entry: RemoteMediaEntry) {
    if (entry.provider === "sfu") reportSfuFailure("remote-receiver-stalled");
  }
  let topologyController: HybridTopologyController | null = null;
  let sessionLifecycle: HybridSessionLifecycle | null = null;
  let sessionTermination: HybridSessionTermination | null = null;
  const lifecycleState = createMediaLifecycleState();
  const mediaGeneration = createMediaGeneration();
  let mediaDeviceId: string | null = null;
  function getMediaDeviceId() {
    mediaDeviceId ??= getOrCreateDeviceId();
    return mediaDeviceId;
  }
  const setConnectionPhase = lifecycleState.record;
  const providerRecovery = createProviderRecoveryState({
    error,
    transportReady,
    mediaConnectionState,
    setConnectionPhase,
  });
  const { getAudioStereo, getEffectiveAudioBitrate } = createMediaAudioPolicy({
    channelsStore,
    settingsStore,
    voiceStore,
  });
  function activeLatencyProfile(): WebRtcLatencyProfile {
    return (
      audioLatencyPolicy(
        parseExternalValue(
          channelsStore.getChannelById(voiceStore.currentChannelId)
            ?.mediaPolicy,
        ),
      ) ?? "standard"
    );
  }
  const sessionOperations = createHybridMediaSessionOperations({
    getSignaling: () => signaling,
    getTopologyController: () => topologyController,
    getSessionTermination: () => sessionTermination,
    getSessionLifecycle: () => sessionLifecycle,
  });
  const {
    connect,
    disconnect,
    ensureP2p,
    ensureSfu,
    failSession,
    handleP2pQualification,
    handleProviderFailure,
    handleSignalingClose,
    queueTopology,
    reportSfuFailure,
    send,
  } = sessionOperations;
  const signaling = createHybridMediaSignaling({
    buildClientHelloData: ({ mediaSessionId }: { mediaSessionId: string }) => {
      const hello = {
        mediaSessionId,
        connectionEpoch: sessionConnectionEpoch,
        lastAppliedRoomRevision: lastAppliedRoomRevision.value,
        providerCapabilities: ["cloudflare-realtime", "mediasoup"],
      };
      if (mediaCapabilities.value)
        Object.assign(hello, {
          mediaCapabilities: mediaCapabilities.value,
          capabilityProtocol: "video-codec-matrix-v1",
        });
      if (mediaControlTicketState.value)
        Object.assign(hello, { ticket: mediaControlTicketState.value });
      return hello;
    },
    buildHeartbeatData: (sequence: number) => ({
      sequence,
      connectionEpoch: sessionConnectionEpoch,
      topologyEpoch: topologyState.value.epoch,
      sourceRevision: topologyState.value.sourceRevision || 0,
      publicationRevision: lastAppliedPublicationRevision.value,
      lastAppliedRoomRevision: lastAppliedRoomRevision.value,
      localSourceDigest: sourceController.getSourceFsmDigest(),
    }),
    buildUrl: () => {
      if (!mediaControlSocketUrlState.value)
        throw new Error("Media control bootstrap is required");
      return mediaControlSocketUrlState.value;
    },
    connectionTimeoutMs: MEDIA_TIMING.connectionTimeoutMs,
    defaultHeartbeatIntervalMs: MEDIA_TIMING.heartbeatIntervalMs,
    defaultHeartbeatTimeoutMs: MEDIA_TIMING.heartbeatTimeoutMs,
    getHandler: (type: string) => {
      const handler = messageHandlers.get(type);
      if (!handler) return undefined;
      return (data: ExternalValue): void => {
        const message = parseExternalRecord(data);
        if (message) void handler(message);
      };
    },
    isIntentionalClose: () => intentionalClose,
    onClose: handleSignalingClose,
    onError: (signalingError: ExternalValue) => {
      error.value = parseThrownError(signalingError).message;
    },
    onOpen: () => setConnectionPhase("protocol-negotiating"),
    onProtocolRejected: (event: CloseEvent) => {
      protocolUpdateRequired.value = true;
      error.value = event.reason || "Media client update required";
      setConnectionPhase("failed", {
        code: String(event.code),
        reason: error.value,
      });
    },
    onReconnect: async () => {
      setConnectionPhase("reconnecting");
      if (mediaConnectionState.value === "recovering") {
        const live = activeProvider === "sfu" ? sfu : p2pMesh;
        mediaConnectionState.value = live
          ? "media-flowing"
          : "ready-no-active-media";
      }
      await sessionLifecycle?.refreshControlTicket?.();
    },
    onFailure: (message) =>
      sessionOperations.failSession(
        ownedErrorValue(parseExternalValue(message)),
      ),
    protocol: MEDIA_SIGNALING_CLIENT_PROTOCOL,
  });
  const joinReady = computed(() =>
    hasUsableVoiceRoute({
      activeProvider,
      p2pReady: p2pMesh?.isMediaReady() === true,
      sfuReady:
        sfu?.connectionState instanceof Function &&
        sfu.connectionState().ready === true,
      signalingConnected: connected.value,
      topologyMode: topologyState.value.mode,
      transportReady: transportReady.value,
    }),
  );
  const {
    getAttenuation,
    setRouteConnectionState,
    sharedAudioAttenuation,
    sharedAudioDucking,
  } = createHybridMediaAudioState({
    attenuationReports,
    getRoomAttenuation: () =>
      voiceStore.currentRoomId
        ? roomAttenuation(roomsStore.getRoomById(voiceStore.currentRoomId))
        : undefined,
    getStreamAttenuation: () => settingsStore.streamAttenuation,
    getPeers: () => topologyState.value.peers,
    getLocalPeerId: () => localPeerId,
    mediaConnectionState,
    playbackState,
  });
  const registry = createHybridMediaRegistry({
    audioFeeds: remoteAudioFeeds,
    videoFeeds: remoteVideoFeeds,
    getAttenuation,
    voiceStore,
    settingsStore,
    getActiveProvider: () => activeProvider,
    getSfu: () => sfu,
    getP2pMesh: () => p2pMesh,
    error,
    playbackState,
    mediaConnectionState,
    iceConnectedBoth,
    setConnectionPhase,
    getAttenuationReporter: () => attenuationReporter,
    getReceiverStats,
    onReceiverRecovery: recoverReceiver,
    onReceiverFailed: failStalledReceiver,
  });
  let disposeVisibility: (() => void) | null = null;
  if (import.meta.client) {
    disposeVisibility = bindMediaVisibility(registry);
    if (getCurrentScope()) onScopeDispose(disposeVisibility);
  }
  const attenuationReporter = createMediaAttenuationReporter({
    getLocalPeerId: () => localPeerId,
    getPeers: () => topologyState.value.peers,
    onReportsChange: (reports: Map<string, unknown>) =>
      (attenuationReports.value = reports),
    send,
  });
  let sourceController: HybridSourceController;
  const capture = new MediaCaptureManager({
    getSettings: () => settingsStore,
    getAudioStereo,
    onMicrophoneFallback: () => {
      microphoneDeviceState.value = "fallback";
    },
    onMicrophoneRestored: () => {
      microphoneDeviceState.value = "preferred";
      if (error.value === "Unable to restore microphone capture")
        error.value = null;
    },
    onSource: (entry: TopologySourceEntry) =>
      sourceController.publishSource(entry),
    onSourceEnded: (
      entry: TopologySourceEntry,
      options: Record<string, unknown> = {},
    ) => sourceController.removeSource(entry, options),
  });
  const handoff = new RemoteMediaHandoff(registry);
  function setActiveProvider(provider: "sfu" | "p2p" | null) {
    if (provider !== activeProvider) {
      const profile = activeLatencyProfile();
      const resetConfig =
        profile === "ultra-low"
          ? { minDelayMs: 0, targetDelayMs: 10 }
          : { minDelayMs: 0, targetDelayMs: 20 };
      if (activeProvider === "sfu" && sfu) {
        sfu.setJitterBufferConfig(resetConfig);
      } else if (activeProvider === "p2p" && p2pMesh) {
        p2pMesh.setJitterBufferConfig(resetConfig);
      }
      currentJitterBufferConfig.value = resetConfig;
    }
    activeProvider = provider;
    activeProviderState.value = provider;
    if (provider) topologyController?.applyAdaptiveJitterBuffer();
  }
  function resetTopologySequencing(reason = "reconnecting") {
    topologyController?.reset();
    localPeerId = null;
    lastP2pEdges = [];
    rtpStatsSamples.clear();
    providerRecovery.reset();
    topologyState.value = initialMediaTopologyState(reason);
    attenuationReporter.clear();
  }
  function getRequestedVideoSettings(source: string) {
    const policy = voiceStore.currentChannelId
      ? videoPolicy(
          parseExternalValue(
            channelsStore.getChannelById(voiceStore.currentChannelId)
              ?.mediaPolicy,
          ),
        )
      : null;
    return resolveRequestedVideoSettings({
      policy,
      settings: settingsStore,
      source,
    });
  }
  const {
    createSharedAudioSource,
    producerFacade,
    refreshMediaPolicy,
    setSharedAudioVolume,
    setSharedAudioAttenuation,
    setSystemAudioBitrate,
    startLocalVoiceDetection,
    startSharedAudioMeter,
    stopLocalVoiceDetection,
    stopSharedAudioMeter,
  } = createLocalAudioEngine({
    authStore,
    automaticGateThreshold,
    capture,
    collectOutboundAudioStats,
    createNoiseFloorEstimator,
    getActiveProvider: () => activeProvider,
    getAttenuation,
    getAudioStereo,
    getEffectiveAudioBitrate,
    getP2pMesh: () => p2pMesh,
    getRequestedVideoSettings: (source: string): VideoSettings =>
      getRequestedVideoSettings(source),
    getSfu: () => sfu,
    localSources,
    echoDetected,
    microphoneLevelDb,
    onSpeakingChange: (userId: string, speaking: boolean) =>
      registry.setExternalSpeaking(userId, speaking),
    settingsStore,
    sharedAudioDucking,
    sharedAudioStats,
    updateNoiseFloor,
    voiceStore,
  });
  watch(
    () =>
      buildMediaAttenuationWatchKey({
        roomAttenuation: voiceStore.currentRoomId
          ? roomAttenuation(roomsStore.getRoomById(voiceStore.currentRoomId))
          : undefined,
        streamAttenuation: settingsStore.streamAttenuation,
        speaking: [...voiceStore.connectedUsers.values()].some(
          (participant) => participant.speaking === true,
        ),
      }),
    () => {
      const speaking = [...voiceStore.connectedUsers.values()].some(
        (participant) => participant.speaking === true,
      );
      registry.applyAttenuation();
      setSharedAudioAttenuation(
        speaking,
        resolveMediaAttenuation(
          voiceStore.currentRoomId
            ? roomAttenuation(roomsStore.getRoomById(voiceStore.currentRoomId))
            : undefined,
          settingsStore.streamAttenuation,
        ),
      );
    },
    { immediate: true },
  );
  registerEchoWarning(echoDetected);
  watch(
    () => activeLatencyProfile(),
    () => {
      if (!connected.value) return;
      const profile = activeLatencyProfile();
      const resetConfig =
        profile === "ultra-low"
          ? { minDelayMs: 0, targetDelayMs: 10 }
          : { minDelayMs: 0, targetDelayMs: 20 };
      currentJitterBufferConfig.value = resetConfig;
      sfu?.setJitterBufferConfig(resetConfig);
      p2pMesh?.setJitterBufferConfig(resetConfig);
      topologyController?.applyAdaptiveJitterBuffer();
    },
  );
  watch(
    () =>
      isExternalRecord(
        channelsStore.getChannelById(voiceStore.currentChannelId)?.mediaPolicy,
      )
        ? channelsStore.getChannelById(voiceStore.currentChannelId)?.mediaPolicy
            ?.revision
        : null,
    () => {
      if (connected.value)
        refreshMediaPolicy().catch((policyError: ExternalValue) => {
          error.value = `Media policy could not be fully applied: ${parseThrownError(policyError).message}`;
        });
    },
  );
  const {
    refreshPublicMaps,
    refreshTopologyGraph,
    syncConnectedUsers,
    updateP2pStats,
  } = createMediaTopologyView({
    activeProvider: () => activeProvider,
    addressFamily,
    buildTopologyGraph,
    consumers,
    getParticipantProfile: (userId: string) =>
      channelsStore.getVoiceProfile(userId),
    getLocalPeerId: () => localPeerId,
    getP2pEdges: () => lastP2pEdges,
    getP2pMesh: () => p2pMesh,
    getSfu: () => sfu,
    mapPeerConnectionMetrics,
    mapPeerRoundTripTimes,
    mediaPathMetrics,
    participantSfuRoundTripTimes,
    peerConnectionMetrics,
    peerRoundTripTimes,
    producers,
    setP2pEdges: (edges: unknown[]) => {
      lastP2pEdges = edges.map((entry) => parseExternalValue(entry));
    },
    topologyGraph,
    topologyState,
    voiceStore,
  });
  sourceController = createMediaSourceController({
    capture,
    connected,
    createSharedAudioSource,
    error,
    getActiveProvider: () => activeProvider,
    getConnectionEpoch: () => sessionConnectionEpoch,
    getIntentionalClose: () => intentionalClose,
    getLastAppliedRoomRevision: () => lastAppliedRoomRevision.value,
    getLastAppliedPublicationRevision: () =>
      lastAppliedPublicationRevision.value,
    setLastAppliedPublicationRevision: (value: string) => {
      lastAppliedPublicationRevision.value = value;
    },
    getP2pMesh: () => p2pMesh,
    getSfu: () => sfu,
    getVideoReport: (source: string) => {
      if (activeProvider === "sfu") {
        const report = sfu?.producers?.get(source)?.producer?.getStats();
        return report
          ? Promise.resolve(parseExternalValue(report)).then(
              normalizeVideoStatsReport,
            )
          : Promise.resolve(null);
      }
      if (activeProvider === "p2p")
        return p2pMesh
          ? p2pMesh
              .getOutboundTrackStats(source)
              .then((value) =>
                normalizeVideoStatsReport(parseExternalValue(value)),
              )
          : Promise.resolve(null);
      return Promise.resolve(null);
    },
    getVideoSettings: (source: string) => getRequestedVideoSettings(source),
    localSources,
    localVideoFeeds,
    onSharedAudioStopped: attenuationReporter.clear,
    producerFacade,
    refreshMediaPolicy: async () => {
      await refreshMediaPolicy();
    },
    refreshPublicMaps,
    reportSfuFailure,
    send,
    sendParticipantVoiceState: async (state: {
      muted?: boolean;
      deafened?: boolean;
    }) => {
      if (voiceStore.sfuComposable?.sendParticipantVoiceState) {
        await voiceStore.sfuComposable.sendParticipantVoiceState({
          muted: state.muted ?? false,
          deafened: state.deafened ?? false,
        });
      }
    },
    startLocalVoiceDetection,
    startSharedAudioMeter,
    stopLocalVoiceDetection,
    stopSharedAudioMeter,
    topologyState,
    voiceStore,
    getLocalPeerId: () => localPeerId,
    getLocalParticipantKey: () => {
      const userId = authStore.getUserData()?.id;
      if (!userId) return null;
      return `${userId}:${getMediaDeviceId()}`;
    },
  });
  const {
    restartAudioProduction,
    sendParticipantVoiceState,
    resolveOperationAck,
    rejectOperationAck,
    startAudioProduction,
    startSystemAudioProduction,
    startVideoProduction,
    stopAudioProduction,
    stopSystemAudioProduction,
    stopVideoProduction,
  } = sourceController;
  function applyRoomRevision(roomRevision: string) {
    if (BigInt(roomRevision) > BigInt(lastAppliedRoomRevision.value))
      lastAppliedRoomRevision.value = roomRevision;
  }
  function requestSnapshot() {
    send({
      type: "request-snapshot",
      data: { connectionEpoch: sessionConnectionEpoch },
    });
  }
  const {
    getInboundRtpStats,
    getOutboundRtpStats,
    getWebRTCDiagnosticStats,
    getWebRTCStatsSnapshot,
    sfuProducerIds,
  } = createHybridMediaDiagnostics({
    collectRtpStats,
    getActiveProvider: () => activeProvider,
    getActiveRouteProvider: () => selectedSfuProvider,
    getAudioLatencySnapshot: () => registry.getAudioLatencySnapshot(),
    getP2pMesh: () => p2pMesh,
    getRequestedVideoSettings,
    getSfu: () => sfu,
    localSources,
    playbackState,
    peerRoundTripTimes,
    refreshTopologyGraph,
    remoteAudioFeeds,
    remoteVideoFeeds,
    send,
    sfuRoundTripTime,
    topologyGraph,
    topologyState,
    updateP2pStats,
    rtpStatsSamples,
    getLifecycle: lifecycleState.snapshot,
    getProtocolState: () => protocolState.value,
    getReadiness: () =>
      mediaReadinessSnapshot({
        connected: connected.value,
        mediaConnectionState: mediaConnectionState.value,
        playbackState: playbackState.value,
        topologyState: topologyState.value,
        transportReady: transportReady.value,
      }),
  });
  sessionTermination = createHybridMediaSessionTermination({
    capture,
    clearAttenuation: attenuationReporter.clear,
    closeMediaSessionTransports,
    connected,
    cancelConnect: () => sessionLifecycle?.cancel?.(),
    disposeVisibility: () => {
      disposeVisibility?.();
      disposeVisibility = null;
    },
    error,
    getP2pMesh: () => p2pMesh,
    getProviderSocket: () => providerSocket,
    getSfu: () => sfu,
    handoff,
    iceConnectedBoth,
    lifecycleState,
    mediaConnectionState,
    mediaPathMetrics,
    participantSfuRoundTripTimes,
    peerConnectionMetrics,
    peerRoundTripTimes,
    playbackState,
    protocolState,
    protocolUpdateRequired,
    refreshPublicMaps,
    refreshTopologyGraph,
    resetTopologySequencing,
    rtpStatsSamples,
    sfuRoundTripTime,
    setActiveProvider: (provider: "p2p" | "sfu" | null) =>
      setActiveProvider(provider),
    setChannelId: (value: string | null) => {
      channelId = value;
    },
    setIntentionalClose: (value: boolean) => {
      intentionalClose = value;
    },
    setLastP2pEdges: (value: unknown[]) => {
      lastP2pEdges = value.map((entry) => parseExternalValue(entry));
    },
    setP2pMesh: (value: HybridP2pMesh | null) => {
      p2pMesh = value;
    },
    setProviderSocket: (value: HybridProviderSocket | null) => {
      providerSocket = value;
    },
    sendLeave: () => sourceController.leave(),
    setSfu: (value: HybridSfuSession | null) => {
      sfu = value;
    },
    signaling,
    stopLocalVoiceDetection,
    stopSharedAudioMeter,
    resolveTopologyWaiter: (reason: ExternalValue) => {
      topologyWaiter?.(ownedErrorValue(reason));
      topologyWaiter = null;
    },
    transportReady,
  });
  topologyController = createHybridMediaTopologyController({
    CloudflareRealtimeSession,
    MediasoupClientSession,
    MediasoupProviderSocket: TopologyMediasoupProviderSocket,
    NativeP2pMesh,
    buildP2pVideoSenderOptions,
    buildVoiceProducerOptions,
    closeSocket: () => providerSocket?.close(),
    currentJitterBufferConfig,
    error,
    failSession,
    getActiveProvider: () => activeProvider,
    getAudioStereo,
    getEffectiveAudioBitrate,
    getIceServers: () => iceServers,
    getMediaCapabilities: () => mediaCapabilities.value,
    getConnectionEpoch: () => sessionConnectionEpoch,
    getLocalPeerId: () => localPeerId,
    getMessageHandler: (type: string) => messageHandlers.get(type),
    getProviderSocket: () => providerSocket,
    getRequestedVideoSettings,
    getSelectedSfuProvider: () => selectedSfuProvider,
    getSfu: () => sfu,
    getP2pMesh: () => p2pMesh,
    handoff,
    iceConnectedBoth,
    isDeafened: () => voiceStore.deafened,
    localSources,
    mediaConnectionState,
    mediaGeneration,
    mediaReadinessPollMs: MEDIA_TIMING.readinessPollMs,
    mediaHandoffTimeoutMs: MEDIA_TIMING.handoffTimeoutMs,
    onP2pQualification: (data: Record<string, unknown>) =>
      voiceStore.setP2pQualification?.(data),
    onRemotePublication: () => cloudflarePublications.values(),
    onTopologyStateUpdated: (
      data: TopologyData,
      nextTopologyState: TopologyState,
    ) => {
      for (const peer of nextTopologyState.peers) {
        const profileId = peer.profile?.id;
        if (peer.profile && profileId != null)
          voiceStore.upsertUserProfile({
            ...peer.profile,
            id: String(profileId),
          });
      }
      attenuationReporter.prune();
      topologyWaiter?.();
      topologyWaiter = null;
      if (data.mode === "idle") {
        remoteProducersCount.value = 0;
        peerRoundTripTimes.value = {};
        peerConnectionMetrics.value = {};
        mediaPathMetrics.value = [];
        sfuRoundTripTime.value = null;
        currentJitterBufferConfig.value = { minDelayMs: 0, targetDelayMs: 20 };
        participantSfuRoundTripTimes.value = {};
      }
    },
    peerConnectionMetrics,
    publishLocalSources: async (provider) => {
      if (provider === p2pMesh && p2pMesh) {
        for (const entry of localSources.values()) {
          await p2pMesh.publishSource(
            entry.source,
            entry.track,
            entry.stream,
            entry,
          );
        }
      } else if (provider === sfu && sfu) {
        for (const entry of localSources.values()) {
          await sfu.addSource(entry);
        }
        if (sfu.startSubscriptions instanceof Function) {
          await sfu.startSubscriptions();
        }
      }
    },
    refreshPublicMaps,
    refreshTopologyGraph,
    reportedSfuFailureState,
    replayCloudflarePublications: async (session) => {
      if (!session) return;
      for (const publication of cloudflarePublications.values()) {
        const trackName = publication.trackName;
        const peerId = publication.peerId;
        const source = publication.source;
        if (!trackName || !peerId || !source) continue;
        if ("handle" in session && session.handle instanceof Function) {
          try {
            await session.handle(
              "cloudflare-publication-available",
              publication,
            );
          } catch (err) {
            mediaDebug("cloudflare-replay-failed", {
              trackName,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    },
    send,
    sfuRoundTripTime,
    setActiveProvider,
    setP2pMesh: (mesh: TopologyP2pMesh | null) => {
      p2pMesh = mesh;
    },
    setProviderSocket: (socket) => {
      providerSocket = socket;
    },
    setSelectedSfuProvider: (provider: string) => {
      selectedSfuProvider = provider;
    },
    setSfu: (session) => {
      sfu = session;
    },
    setConnectionPhase,
    setRouteConnectionState,
    shouldAcceptTopologyEvent,
    topologyEventKey,
    topologyState,
    transportReady,
    updateP2pStats,
    waitForMediaTimeoutMs: providerRecovery.timeout,
  });
  sessionLifecycle = createHybridMediaSessionRuntime({
    authStore,
    buildMediaControlSocketUrl,
    channelsStore,
    connected,
    error,
    getIntentionalClose: () => intentionalClose,
    getMediaControlUrl: () => runtimeConfig.public.mediaControlUrl,
    getRoomId: () => voiceStore.currentRoomId,
    getSfu: () => sfu,
    getSupabaseClient,
    handleMediaSignalingClose,
    handoff,
    iceConnectedBoth,
    lastInRoom,
    mediaConnectionState,
    mediaControlApiPath: runtimeConfig.public.apiPath,
    mediaControlTicketState,
    mediaControlSocketUrlState,
    messageHandlers,
    participantSfuRoundTripTimes,
    protocolState,
    protocolUpdateRequired,
    providerRecovery,
    queueTopology,
    remoteProducersCount,
    resetMediaTelemetryState,
    resetTopologySequencing,
    runtimeConnectionTimeoutMs: MEDIA_TIMING.connectionTimeoutMs,
    setActiveProvider,
    setChannelId: (value: string | null) => {
      channelId = value;
    },
    setConnectionPhase,
    setIceServers: (value: unknown[]) => {
      iceServers = value.map((entry) => parseExternalValue(entry));
    },
    setIntentionalClose: (value: boolean) => {
      intentionalClose = value;
    },
    setLocalPeerId: (value: string | null) => {
      localPeerId = value;
    },
    setMediaControlSocketUrl: (value: string | null) => {
      mediaControlSocketUrlState.value = value;
    },
    setMediaControlTicket: (value: string | null) => {
      mediaControlTicketState.value = value;
    },
    setP2pMesh: (value: HybridP2pMesh | null) => {
      p2pMesh = value;
    },
    setSfu: (value: HybridSfuSession | null) => {
      sfu = value;
    },
    signaling,
    syncConnectedUsers,
    topologyState,
    transportReady,
    voiceStore,
    closeProviders: closeMediaProviders,
    ensureP2p,
    ensureSfu,
    getChannelId: () => channelId,
    getDeviceId: getMediaDeviceId,
    getP2pMesh: () => p2pMesh,
    getBootstrap: getMediaControlBootstrap,
    handleP2pQualification,
    handleProviderFailure,
    handleProviderRecovering: (data: Record<string, unknown> = {}) => {
      return topologyController?.handleProviderRecovering(data);
    },
    handleProviderTicket: (data: TopologyData) =>
      topologyController?.handleProviderTicket(data),
    mediaPathMetrics,
    peerConnectionMetrics,
    peerRoundTripTimes,
    sfuRoundTripTime,
    receiveAttenuation: attenuationReporter.receive,
    resetLifecycle: lifecycleState.reset,
    resolveTopologyWaiter: (reason: ExternalValue) => {
      topologyWaiter?.(ownedErrorValue(reason));
      topologyWaiter = null;
    },
    sfuProducerIds,
    sendParticipantVoiceState,
    sendSourceState: () => sourceController.sendSourceState(),
    resolveOperationAck,
    rejectOperationAck,
    getConnectionEpoch: () => sessionConnectionEpoch,
    setConnectionEpoch: (epoch: number) => {
      sessionConnectionEpoch = epoch;
      if (sfu) sfu.controlConnectionEpoch = epoch;
    },
    getLastAppliedRoomRevision: () => lastAppliedRoomRevision.value,
    applyRoomRevision,
    requestSnapshot,
    setTopologyWaiter: (waiter: ((error?: OwnedErrorValue) => void) | null) => {
      topologyWaiter = waiter ? (error) => waiter(error) : null;
    },
    setupMessageHandlers: setupMediaMessageHandlers,
    queueCloudflarePublication: (data: Record<string, unknown>) =>
      cloudflarePublications.update(data),
    queueTargetedReconciliation: (
      operationId: string,
      data: Record<string, unknown>,
    ) => sourceController.queueTargetedReconciliation(operationId, data),
    handlePublicationsDigest,
    sourceController,
    getLastAppliedPublicationRevision: () =>
      lastAppliedPublicationRevision.value,
    setLastAppliedPublicationRevision: (value: string) => {
      lastAppliedPublicationRevision.value = value;
    },
  } satisfies RuntimeDependencyContext);

  function normalizeServerRevision(value: ExternalValue): string {
    if (isExternalString(value) && value !== "" && /^\d+$/.test(value)) {
      return value;
    }
    const numeric = parseExternalNumber(value);
    if (numeric !== null && Number.isSafeInteger(numeric) && numeric >= 0) {
      return String(numeric);
    }
    return lastAppliedPublicationRevision.value;
  }

  async function handlePublicationsDigest<T>(
    digest: T[],
    publicationRevision?: string | number | null,
  ): Promise<void> {
    if (!Array.isArray(digest)) return;

    const serverPublications: CloudflarePublication[] = [];
    const envelopeRevision = normalizeServerRevision(publicationRevision);
    let maxPublicationRevision = envelopeRevision;
    for (const rawEntry of digest) {
      const entry = parseCloudflarePublication(parseExternalValue(rawEntry));
      if (!entry) continue;
      serverPublications.push(entry);
      if (
        !publicationRevision &&
        "publicationRevision" in entry &&
        (isExternalString(entry.publicationRevision) ||
          parseExternalNumber(parseExternalValue(entry.publicationRevision)) !==
            null)
      ) {
        const entryRevision = normalizeServerRevision(
          parseExternalValue(entry.publicationRevision),
        );
        if (BigInt(entryRevision) > BigInt(maxPublicationRevision)) {
          maxPublicationRevision = entryRevision;
        }
      }
    }

    if (
      BigInt(maxPublicationRevision) <
      BigInt(lastAppliedPublicationRevision.value)
    ) {
      mediaDebug("publications-digest-stale", {
        digestRevision: maxPublicationRevision,
        appliedRevision: lastAppliedPublicationRevision.value,
      });
      return;
    }

    const { canonicalSnapshot, removed } =
      cloudflarePublications.reconcileExact(serverPublications);

    if (
      BigInt(maxPublicationRevision) >
      BigInt(lastAppliedPublicationRevision.value)
    ) {
      lastAppliedPublicationRevision.value = maxPublicationRevision;
    }

    if (removed.length > 0) {
      mediaDebug("publications-digest-removed", {
        count: removed.length,
        tracks: removed.map((p) => p.trackName),
      });
    }

    const session = sfu;
    if (!session) return;
    if (
      "reconcilePublications" in session &&
      session.reconcilePublications instanceof Function
    ) {
      try {
        const isStale = () =>
          BigInt(maxPublicationRevision) <
          BigInt(lastAppliedPublicationRevision.value);
        await session.reconcilePublications(
          canonicalSnapshot,
          removed,
          isStale,
          () => cloudflarePublications.values(),
          () => lastAppliedPublicationRevision.value,
        );
      } catch (err) {
        mediaDebug("publications-digest-reconcile-failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  watch(
    () => [peerConnectionMetrics.value, sfuRoundTripTime.value],
    () => {
      topologyController?.applyAdaptiveJitterBuffer();
    },
    { deep: true, immediate: false },
  );
  const requestedLatencyProfile = ref<WebRtcLatencyProfile>("standard");
  watch(
    () => activeLatencyProfile(),
    (profile) => {
      requestedLatencyProfile.value = profile;
    },
    { immediate: true },
  );
  const webMediaLatencyTier = computed(() =>
    deriveWebMediaLatencyTier({
      receiverTuningApplied: requestedLatencyProfile.value === "ultra-low",
      receiverTargetObserved:
        currentJitterBufferConfig.value.targetDelayMs <= 10 ? 10 : null,
      senderPolicyVerified: false,
      observedTargetDelayLowered:
        currentJitterBufferConfig.value.minDelayMs > 0 &&
        currentJitterBufferConfig.value.targetDelayMs <
          currentJitterBufferConfig.value.minDelayMs + 40,
    }),
  );
  return createHybridMediaSessionApi({
    activeProviderState,
    requestedLatencyProfile,
    webMediaLatencyTier,
    areTransportsIceConnected: () => Promise.resolve(iceConnectedBoth.value),
    connect,
    connected,
    connectionPhase: lifecycleState.phase,
    consumers,
    disconnect,
    echoDetected,
    error,
    getInboundRtpStats,
    getOutboundRtpStats,
    getVoiceTransportTimeout: providerRecovery.timeout,
    getWebRTCDiagnosticStats: async () => {
      const value = await getWebRTCDiagnosticStats();
      return Array.isArray(value)
        ? value
            .map((entry) => parseExternalValue(entry))
            .filter(isExternalRecord)
        : [];
    },
    getWebRTCStatsSnapshot,
    iceConnectedBoth,
    isProducing: computed(() => localSources.size > 0),
    joinReady,
    lastInRoom,
    lastReceivedConsumerParams: () => sfu?.lastReceivedConsumerParams || null,
    lastSentClientRtpCapabilities: () =>
      sfu?.lastSentClientRtpCapabilities || null,
    lifecycle: lifecycleState.lifecycle,
    localVideoFeeds,
    mediaConnectionState,
    mediaCapabilities,
    mediaPathMetrics,
    microphoneDeviceState,
    participantSfuRoundTripTimes,
    peerConnectionMetrics,
    peerRoundTripTimes,
    playbackState,
    prepareAudioPlayback: () => registry.preparePlayback(),
    producers,
    protocolState,
    protocolUpdateRequired,
    remoteAudioFeeds,
    remoteProducersCount,
    remoteVideoFeeds,
    restartAudioProduction,
    sharedAudioAttenuation,
    sharedAudioDucking,
    sharedAudioStats,
    sfuRoundTripTime,
    sendParticipantVoiceState,
    setMediaCapabilities: (value: ParticipantMediaCapabilities | null) => {
      mediaCapabilities.value = value;
    },
    setRemoteScreenReceiving: (feedKey: string, receiving: boolean) =>
      registry.setVideoReceiving(feedKey, receiving),
    markRemoteFirstFrame: (
      key: string,
      receiverIncarnationId?: string | null,
      fallback = false,
      observationMode?: Exclude<
        RemotePresentationObservationMode,
        "unavailable"
      >,
    ) =>
      registry.markFirstFrame(
        key,
        receiverIncarnationId || null,
        Date.now(),
        fallback,
        observationMode,
      ),
    markRemoteFramePresented: (
      key: string,
      receiverIncarnationId?: string | null,
      observationMode?: Exclude<
        RemotePresentationObservationMode,
        "unavailable"
      >,
    ) =>
      registry.markFramePresented(
        key,
        receiverIncarnationId || null,
        Date.now(),
        observationMode,
      ),
    setRemoteSystemAudioReceiving: (key: string, on: boolean) =>
      registry.setAudioReceiving(key, on),
    setSharedAudioAttenuation,
    setSharedAudioVolume,
    setSystemAudioBitrate,
    startAudioProduction,
    startSystemAudioProduction,
    startVideoProduction: (source, options) =>
      Promise.resolve(startVideoProduction(source, options)).then((value) =>
        parseExternalValue(value),
      ),
    stopAudioProduction: () =>
      Promise.resolve(stopAudioProduction()).then((value) =>
        parseExternalValue(value),
      ),
    stopSystemAudioProduction,
    stopVideoProduction: (source) =>
      Promise.resolve(stopVideoProduction(source)).then((value) =>
        parseExternalValue(value),
      ),
    topologyGraph,
    topologyState,
    transportReady,
    applyOutputDeviceToAll: () => registry.applyOutputDevice(),
    applyVolumeForUser: (userId: string, volume: number) =>
      registry.applyVolume(userId, "", volume),
    applyVolumeForTrack: (userId: string, source: string, volume: number) =>
      registry.applyVolume(userId, source, volume),
    ensureAudioElements: () => registry.ensurePlayback(),
  } satisfies HybridMediaSessionApiContext);
}
