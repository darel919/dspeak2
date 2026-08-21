import { mediaSignalingUrl } from "./media-signaling-socket.ts";
import { NativeMediasoupSignalingMethods } from "./native-mediasoup-session/signaling.ts";
import { NativeMediasoupSourcesMethods } from "./native-mediasoup-session/sources.ts";
import { NativeMediasoupConsumersMethods } from "./native-mediasoup-session/consumers.ts";
import { NativeMediasoupDiagnosticsMethods } from "./native-mediasoup-session/diagnostics.ts";
import { NativeMediasoupLifecycleMethods } from "./native-mediasoup-session/lifecycle.ts";
import type {
  NativeMediasoupConstructorOptions,
  NativeMediasoupSfuSessionSurface,
  NativeDirection,
  NativeMediaProfile,
  NativeSourceEntry,
  NativeProducerEntry,
  NativeCloudflareSessionLike,
} from "./types/native-mediasoup-session.ts";
import type {
  NativeAction,
  NativeConsumerEntry,
  NativeReceiveEvent,
} from "./types/native-mediasoup.ts";
import type { CodecRoutingPlan } from "./video-codec-routing.ts";
import type { MediaCommandResult } from "./types/boundary.ts";
import type { OwnedErrorValue } from "./types/shared-utilities.ts";
import type { SignalingMessage } from "./types/media-signaling.ts";
export class NativeMediasoupSfuSession {
  declare mediaProfile: NativeMediaProfile;
  declare connected: boolean;
  declare getState: NativeMediasoupSfuSessionSurface["getState"];
  declare connectionState: NativeMediasoupSfuSessionSurface["connectionState"];
  declare stats: NativeMediasoupSfuSessionSurface["stats"];
  declare diagnosticStats: NativeMediasoupSfuSessionSurface["diagnosticStats"];
  declare getOutboundRtpStats: NativeMediasoupSfuSessionSurface["getOutboundRtpStats"];
  declare getInboundRtpStats: NativeMediasoupSfuSessionSurface["getInboundRtpStats"];
  declare mediaReadiness: NativeMediasoupSfuSessionSurface["mediaReadiness"];
  declare expectedInboundFlowCount: NativeMediasoupSfuSessionSurface["expectedInboundFlowCount"];
  declare connect: NativeMediasoupSfuSessionSurface["connect"];
  declare handle: NativeMediasoupSfuSessionSurface["handle"];
  declare reconcilePublications: NativeMediasoupSfuSessionSurface["reconcilePublications"];
  declare configureControl: NativeMediasoupSfuSessionSurface["configureControl"];
  declare addSource: NativeMediasoupSfuSessionSurface["addSource"];
  declare removeSource: NativeMediasoupSfuSessionSurface["removeSource"];
  declare setSourceTransmission: NativeMediasoupSfuSessionSurface["setSourceTransmission"];
  declare updateAudioBitrate: NativeMediasoupSfuSessionSurface["updateAudioBitrate"];
  declare updateVideoBitrate: NativeMediasoupSfuSessionSurface["updateVideoBitrate"];
  declare updateVideoParameters: NativeMediasoupSfuSessionSurface["updateVideoParameters"];
  declare codecMigrationAcks: Map<
    string,
    Map<
      string,
      {
        variantId: string;
        state: "stable" | "abort";
        generation: number;
        updatedAt: number;
      }
    >
  >;
  declare codecRoutingEvaluationTimer: ReturnType<typeof setTimeout> | null;
  declare codecRoutingEvaluationOperation: Promise<MediaCommandResult> | null;
  declare setJitterBufferConfig: NativeMediasoupSfuSessionSurface["setJitterBufferConfig"];
  declare invoke: NativeMediasoupSfuSessionSurface["invoke"];
  declare buildUrl: NativeMediasoupSfuSessionSurface["buildUrl"];
  declare signalingPath?: string;
  declare signalingToken?: string;
  declare controlTicket: string;
  declare refreshControl: NativeMediasoupSfuSessionSurface["refreshControl"];
  declare mediaSessionId: string;
  declare requestTimeoutMs: number;
  declare consumerControlTimeoutMs: number;
  declare recoveryTimeoutMs: number;
  declare consumerRetryDelayMs: number;
  declare initializationTimeoutMs: number;
  declare signaling: NativeMediasoupSfuSessionSurface["signaling"];
  declare providerSignaling: NativeMediasoupSfuSessionSurface["providerSignaling"];
  declare messageHandlers: NativeMediasoupSfuSessionSurface["messageHandlers"];
  declare pending: NativeMediasoupSfuSessionSurface["pending"];
  declare pendingProduce: NativeMediasoupSfuSessionSurface["pendingProduce"];
  declare pendingConsumers: NativeMediasoupSfuSessionSurface["pendingConsumers"];
  declare requestedConsumers: NativeMediasoupSfuSessionSurface["requestedConsumers"];
  declare consumerRetryAttempts: NativeMediasoupSfuSessionSurface["consumerRetryAttempts"];
  declare consumerRetryTimers: NativeMediasoupSfuSessionSurface["consumerRetryTimers"];
  declare transportPointers: NativeMediasoupSfuSessionSurface["transportPointers"];
  declare sources: NativeMediasoupSfuSessionSurface["sources"];
  declare producers: NativeMediasoupSfuSessionSurface["producers"];
  declare producerVariants: NativeMediasoupSfuSessionSurface["producerVariants"];
  declare pendingLocalVideoFrames: NativeMediasoupSfuSessionSurface["pendingLocalVideoFrames"];
  declare remoteProducerMetadata: NativeMediasoupSfuSessionSurface["remoteProducerMetadata"];
  declare sourcePublications: NativeMediasoupSfuSessionSurface["sourcePublications"];
  declare sourceOperations: NativeMediasoupSfuSessionSurface["sourceOperations"];
  declare pendingCloudflarePublications: NativeMediasoupSfuSessionSurface["pendingCloudflarePublications"];
  declare sourceTransmission: NativeMediasoupSfuSessionSurface["sourceTransmission"];
  declare producerRemovals: NativeMediasoupSfuSessionSurface["producerRemovals"];
  declare consumers: NativeMediasoupSfuSessionSurface["consumers"];
  declare transportStates: NativeMediasoupSfuSessionSurface["transportStates"];
  declare lastSentClientRtpCapabilities: NativeMediasoupSfuSessionSurface["lastSentClientRtpCapabilities"];
  declare lastReceivedConsumerParams: NativeMediasoupSfuSessionSurface["lastReceivedConsumerParams"];
  declare protocolState: NativeMediasoupSfuSessionSurface["protocolState"];
  declare protocolUpdateRequired: boolean;
  declare lifecycle: unknown;
  declare activeProvider: string | null;
  declare activeSfuProvider: string | null;
  declare activeSfuProviderId: string | null;
  declare selectedProvider: string;
  declare selectedProviderId: string | null;
  declare playbackState: string;
  declare localVideoFeeds: NativeMediasoupSfuSessionSurface["localVideoFeeds"];
  declare remoteVideoFeeds: NativeMediasoupSfuSessionSurface["remoteVideoFeeds"];
  declare remoteAudioFeeds: NativeMediasoupSfuSessionSurface["remoteAudioFeeds"];
  declare topologyState: NativeMediasoupSfuSessionSurface["topologyState"];
  declare localPeerId: string;
  declare lastInRoom: NativeMediasoupSfuSessionSurface["lastInRoom"];
  declare device: NativeMediasoupSfuSessionSurface["device"];
  declare sendTransport: NativeMediasoupSfuSessionSurface["sendTransport"];
  declare recvTransport: NativeMediasoupSfuSessionSurface["recvTransport"];
  declare channelId: string | null;
  declare closed: boolean;
  declare intentionalClose: boolean;
  declare initialized: boolean;
  declare connectPromise: NativeMediasoupSfuSessionSurface["connectPromise"];
  declare connectResolve: NativeMediasoupSfuSessionSurface["connectResolve"];
  declare connectReject: NativeMediasoupSfuSessionSurface["connectReject"];
  declare nativeTeardownPromise: NativeMediasoupSfuSessionSurface["nativeTeardownPromise"];
  declare readyPromise: NativeMediasoupSfuSessionSurface["readyPromise"];
  declare readyResolve: NativeMediasoupSfuSessionSurface["readyResolve"];
  declare readyReject: NativeMediasoupSfuSessionSurface["readyReject"];
  declare initializationRequestId: string | null;
  declare nextRequestSequence: number;
  declare pendingNativeDirection: NativeDirection | null;
  declare mediaConnectionState: string;
  declare connectionPhase: string;
  declare error: Error | null;
  declare microphoneDeviceState: string;
  declare sharedAudioStats: Record<string, number>;
  declare echoDetected: boolean;
  declare peerRoundTripTimes: Record<string, number>;
  declare peerConnectionMetrics: Record<string, unknown>;
  declare sfuRoundTripTime: number | null;
  declare participantSfuRoundTripTimes: Record<string, number>;
  declare remoteReceiving: NativeMediasoupSfuSessionSurface["remoteReceiving"];
  declare jitterBufferMinimumDelay: number;
  declare jitterBufferTargetDelay: number;
  declare rtpSamples: NativeMediasoupSfuSessionSurface["rtpSamples"];
  declare recoveryAttempts: NativeMediasoupSfuSessionSurface["recoveryAttempts"];
  declare recoveryOperations: NativeMediasoupSfuSessionSurface["recoveryOperations"];
  declare recoveryTimers: NativeMediasoupSfuSessionSurface["recoveryTimers"];
  declare mediaRevision: number;
  declare initializationTimer: ReturnType<typeof setTimeout> | null;
  declare transportRequestIds: Map<NativeDirection, string>;
  declare cloudflareSession: NativeMediasoupSfuSessionSurface["cloudflareSession"];
  declare providerActivationPromise: NativeMediasoupSfuSessionSurface["providerActivationPromise"];
  declare lastProviderFailureKey: string | null;
  declare onRemoteTrack: NativeMediasoupSfuSessionSurface["onRemoteTrack"];
  declare onRemoteTrackEnded: NativeMediasoupSfuSessionSurface["onRemoteTrackEnded"];
  declare onP2pSignal: NativeMediasoupSfuSessionSurface["onP2pSignal"];
  declare onCurrentlyInChannel: NativeMediasoupSfuSessionSurface["onCurrentlyInChannel"];
  declare onBeforeNativeTeardown: NativeMediasoupSfuSessionSurface["onBeforeNativeTeardown"];
  declare onNativeMediaClose: NativeMediasoupSfuSessionSurface["onNativeMediaClose"];
  declare onStateChange: NativeMediasoupSfuSessionSurface["onStateChange"];
  declare onError: NativeMediasoupSfuSessionSurface["onError"];
  declare getAudioBitrate: NativeMediasoupSfuSessionSurface["getAudioBitrate"];
  declare getAudioStereo: NativeMediasoupSfuSessionSurface["getAudioStereo"];
  declare getVideoSettings: NativeMediasoupSfuSessionSurface["getVideoSettings"];
  declare getControlConnectionEpoch: NativeMediasoupSfuSessionSurface["getControlConnectionEpoch"];
  declare controlConnectionEpoch: number;
  declare mediaCapabilities: NativeMediasoupSfuSessionSurface["mediaCapabilities"];
  declare remoteParticipantCapabilities: NativeMediasoupSfuSessionSurface["remoteParticipantCapabilities"];
  declare logicalVideoStreams: NativeMediasoupSfuSessionSurface["logicalVideoStreams"];
  declare codecMigrationTelemetry: NativeMediasoupSfuSessionSurface["codecMigrationTelemetry"];
  declare videoDecodeOverloadTelemetry: NativeMediasoupSfuSessionSurface["videoDecodeOverloadTelemetry"];
  declare codecRuntimeTelemetry: NativeMediasoupSfuSessionSurface["codecRuntimeTelemetry"];
  declare codecRoutingPlans: NativeMediasoupSfuSessionSurface["codecRoutingPlans"];
  declare codecRoutingCandidatePlans: NativeMediasoupSfuSessionSurface["codecRoutingCandidatePlans"];
  declare requestId: (operation: string) => string;
  declare sendOrThrow: (message: SignalingMessage, label: string) => void;
  declare _installHandlers: () => MediaCommandResult;
  declare _emitState: () => MediaCommandResult;
  declare _fail: (error: OwnedErrorValue) => MediaCommandResult;
  declare _beginNativeTeardown: (
    preTeardown: MediaCommandResult,
  ) => Promise<MediaCommandResult>;
  declare _closeMedia: (clearSources: boolean) => Promise<MediaCommandResult>;
  declare _republishSources: () => Promise<MediaCommandResult>;
  declare _startNegotiation: () => Promise<MediaCommandResult>;
  declare _createCloudflareSession: () => NativeCloudflareSessionLike;
  declare _resolveConsumerControl: (
    data: Record<string, unknown>,
    receiving: boolean,
  ) => MediaCommandResult;
  declare applyJitterBufferConfig: (
    entry: NativeConsumerEntry,
  ) => MediaCommandResult;
  declare shouldReceive: (
    userId: string | number | null | undefined,
    source: string,
    ownerSource?: string | null,
  ) => boolean;
  declare _sendSourceState: () => MediaCommandResult;
  declare addSourceInternal: (
    entry: NativeSourceEntry,
  ) => Promise<MediaCommandResult>;
  declare publish: (
    entry: NativeSourceEntry,
  ) => Promise<NativeProducerEntry | null>;
  declare removeSourceInternal: (source: string) => Promise<MediaCommandResult>;
  declare enqueueSourceOperation: (
    source: string,
    operation: () => Promise<MediaCommandResult>,
  ) => Promise<MediaCommandResult>;
  declare resetReadiness: () => MediaCommandResult;
  declare rejectReadiness: (error: OwnedErrorValue) => MediaCommandResult;
  declare _handleSignalingClose: (event: CloseEvent) => MediaCommandResult;
  declare _acknowledgeHeartbeat: (
    data: Record<string, unknown>,
  ) => MediaCommandResult;
  declare _handleServerError: (
    data: Record<string, unknown>,
  ) => MediaCommandResult;
  declare _resolveConnect: () => MediaCommandResult;
  declare _handleProviderTicket: (
    data: Record<string, unknown>,
  ) => Promise<MediaCommandResult>;
  declare _handleRtpCapabilities: (
    data: Record<string, unknown>,
  ) => Promise<MediaCommandResult>;
  declare _handleTransportParams: (
    data: Record<string, unknown>,
  ) => Promise<MediaCommandResult>;
  declare _createConsumer: (
    data: Record<string, unknown>,
  ) => Promise<MediaCommandResult>;
  declare _handleTransportState: (
    data: Record<string, unknown>,
  ) => MediaCommandResult;
  declare activateProvider: (
    provider: string,
    options?: { ensureMedia?: boolean; closeMedia?: boolean },
  ) => Promise<MediaCommandResult>;
  declare disconnect: () => Promise<MediaCommandResult>;
  declare waitForPending: (
    requestId: string,
    label: string,
    timeoutMs?: number,
  ) => Promise<MediaCommandResult>;
  declare reportProviderFailure: (
    reason: string,
    provider?: string | null,
    providerId?: string | null,
  ) => boolean;
  declare restartTransportIce: (
    direction: NativeDirection,
  ) => Promise<MediaCommandResult>;
  declare handleTransportRecovery: (
    direction: NativeDirection,
    state: string,
  ) => MediaCommandResult;
  declare setRemoteReceiving: (
    userIdOrKey: string,
    sourceOrReceiving: string | boolean,
    receivingValue?: boolean,
  ) => MediaCommandResult;
  declare setConsumerVolume: (
    userId: string | number,
    source: string,
    volume: number,
  ) => MediaCommandResult;
  declare sendParticipantVoiceState: (state?: {
    muted?: boolean;
    deafened?: boolean;
  }) => MediaCommandResult;
  declare handleNativeAction: (action: NativeAction) => MediaCommandResult;
  declare handleReceiveEvent: (event: NativeReceiveEvent) => MediaCommandResult;
  declare closeConsumer: (
    entry: NativeConsumerEntry,
    options?: { releaseNative?: boolean },
  ) => MediaCommandResult;
  declare requestConsumer: (
    producerId: string,
    metadata?: Record<string, unknown>,
  ) => MediaCommandResult;
  declare adaptVideoReceiver: (
    logicalStreamId: string,
    preferredLayers: { spatialLayer?: number; temporalLayer?: number },
  ) => Promise<MediaCommandResult>;
  declare closeConsumerByProducer: (producerId: string) => MediaCommandResult;
  declare _publishSource: (
    entry: NativeSourceEntry,
  ) => Promise<NativeProducerEntry | null>;
  declare publishVariant: (
    source: string,
    variant: {
      codec: string;
      variantId?: string;
      generation?: number;
      receivers?: string[];
      emergency?: boolean;
      score?: number;
      target?: import("./video-codec-routing.ts").CodecRoutingTarget;
      targetAdjusted?: boolean;
    },
  ) => Promise<NativeProducerEntry | null>;
  declare removeVariant: (
    variantId: string,
    force?: boolean,
  ) => Promise<MediaCommandResult>;
  declare applyCodecRoutingPlan: (
    plan: CodecRoutingPlan,
  ) => Promise<MediaCommandResult>;
  declare handleCodecMigrationState: (
    data: Record<string, unknown>,
  ) => MediaCommandResult;
  declare scheduleCodecRoutingEvaluation: () => MediaCommandResult;
  declare evaluateCodecRoutingPlans: () => Promise<MediaCommandResult>;
  constructor({
    invoke,
    buildUrl,
    signalingPath,
    signalingToken,
    location,
    onP2pSignal,
    onCurrentlyInChannel,
    onBeforeNativeTeardown,
    onNativeMediaClose,
    requestTimeoutMs = 8000,
    consumerControlTimeoutMs = 4000,
    recoveryTimeoutMs = 5000,
    consumerRetryDelayMs = 250,
    initializationTimeoutMs = 10000,
    onRemoteTrack,
    onRemoteTrackEnded,
    onStateChange,
    onError,
    getAudioBitrate,
    getAudioStereo,
    getVideoSettings,
    mediaCapabilities = null,
    mediaProfile = "audio",
    getControlConnectionEpoch,
  }: NativeMediasoupConstructorOptions) {
    if (!(invoke instanceof Function))
      throw new TypeError("NativeMediasoupSfuSession requires invoke");
    this.invoke = invoke;
    this.buildUrl =
      buildUrl ||
      ((channelId: string | null) =>
        mediaSignalingUrl(
          signalingPath,
          String(channelId || ""),
          location ||
            globalThis.window?.location || {
              protocol: "http:",
              host: "localhost",
            },
          signalingToken,
        ));
    this.requestTimeoutMs = requestTimeoutMs;
    this.consumerControlTimeoutMs = consumerControlTimeoutMs;
    this.recoveryTimeoutMs = recoveryTimeoutMs;
    this.consumerRetryDelayMs = consumerRetryDelayMs;
    this.initializationTimeoutMs = initializationTimeoutMs;
    this.onRemoteTrack = onRemoteTrack;
    this.onRemoteTrackEnded = onRemoteTrackEnded;
    this.onP2pSignal = onP2pSignal;
    this.onCurrentlyInChannel = onCurrentlyInChannel;
    this.onBeforeNativeTeardown = onBeforeNativeTeardown;
    this.onNativeMediaClose = onNativeMediaClose;
    this.onStateChange = onStateChange;
    this.onError = onError;
    this.getAudioBitrate = getAudioBitrate;
    this.getAudioStereo = getAudioStereo;
    this.getVideoSettings = getVideoSettings;
    this.getControlConnectionEpoch =
      getControlConnectionEpoch || (() => this.controlConnectionEpoch ?? 0);
    this.mediaProfile = mediaProfile;
    this.mediaCapabilities = mediaCapabilities;
    this.signaling = null;
    this.providerSignaling = null;
    this.controlTicket = "";
    this.refreshControl = null;
    this.mediaSessionId = "";
    this.messageHandlers = new Map();
    this.pending = new Map();
    this.pendingProduce = new Map();
    this.pendingConsumers = new Set();
    this.requestedConsumers = new Set();
    this.consumerRetryAttempts = new Map();
    this.consumerRetryTimers = new Map();
    this.transportPointers = new Map();
    this.sources = new Map();
    this.producers = new Map();
    this.producerVariants = new Map();
    this.pendingLocalVideoFrames = new Map();
    this.remoteProducerMetadata = new Map();
    this.sourcePublications = new Map();
    this.sourceOperations = new Map();
    this.pendingCloudflarePublications = new Map();
    this.sourceTransmission = new Map();
    this.producerRemovals = new Map();
    this.consumers = new Map();
    this.remoteParticipantCapabilities = new Map();
    this.logicalVideoStreams = new Map();
    this.codecMigrationTelemetry = [];
    this.videoDecodeOverloadTelemetry = [];
    this.codecRuntimeTelemetry = [];
    this.codecRoutingPlans = new Map();
    this.codecRoutingCandidatePlans = new Map();
    this.codecMigrationAcks = new Map();
    this.codecRoutingEvaluationTimer = null;
    this.codecRoutingEvaluationOperation = null;
    this.transportStates = new Map([
      ["send", "new"],
      ["recv", "new"],
    ]);
    this.lastSentClientRtpCapabilities = null;
    this.lastReceivedConsumerParams = null;
    this.protocolState = null;
    this.protocolUpdateRequired = false;
    this.lifecycle = null;
    this.activeProvider = null;
    this.activeSfuProvider = null;
    this.activeSfuProviderId = null;
    this.selectedProvider = "mediasoup";
    this.selectedProviderId = null;
    this.playbackState = "native";
    this.localVideoFeeds = new Map();
    this.remoteVideoFeeds = new Map();
    this.remoteAudioFeeds = new Map();
    this.topologyState = null;
    this.localPeerId = "";
    this.lastInRoom = [];
    this.device = null;
    this.sendTransport = null;
    this.recvTransport = null;
    this.channelId = null;
    this.connected = false;
    this.closed = true;
    this.intentionalClose = false;
    this.initialized = false;
    this.connectPromise = null;
    this.connectResolve = null;
    this.connectReject = null;
    this.nativeTeardownPromise = null;
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
    this.initializationRequestId = null;
    this.nextRequestSequence = 0;
    this.pendingNativeDirection = null;
    this.mediaConnectionState = "disconnected";
    this.connectionPhase = "idle";
    this.error = null;
    this.activeProvider = "sfu";
    this.playbackState = "native";
    this.microphoneDeviceState = "preferred";
    this.localVideoFeeds = new Map();
    this.remoteVideoFeeds = new Map();
    this.remoteAudioFeeds = new Map();
    this.sharedAudioStats = { kbps: 0, level: 0, dbfs: -60 };
    this.echoDetected = false;
    this.peerRoundTripTimes = {};
    this.peerConnectionMetrics = {};
    this.sfuRoundTripTime = null;
    this.participantSfuRoundTripTimes = {};
    this.remoteReceiving = new Map();
    this.jitterBufferMinimumDelay = 0;
    this.jitterBufferTargetDelay = 20;
    this.rtpSamples = new Map();
    this.recoveryAttempts = new Map();
    this.recoveryOperations = new Map();
    this.recoveryTimers = new Map();
    this.mediaRevision = 0;
    this.initializationTimer = null;
    this.transportRequestIds = new Map();
    this.cloudflareSession = null;
    this.providerActivationPromise = null;
    this.lastProviderFailureKey = null;
    this._installHandlers();
  }

  get errorMessage() {
    return this.error?.message || this.error || null;
  }

  get joinReady() {
    return this.connectionState().ready === true;
  }

  get transportReady() {
    if (this.selectedProvider === "cloudflare-realtime")
      return Boolean(
        this.cloudflareSession?.handle && this.cloudflareSession?.sessionId,
      );
    return Boolean(this.sendTransport && this.recvTransport);
  }

  get iceConnectedBoth() {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.connectionState?.().ready === true;
    return (
      this.transportStates.get("send") === "connected" &&
      this.transportStates.get("recv") === "connected"
    );
  }

  get isProducing() {
    return this.producers.size > 0 || this.producerVariants.size > 0;
  }

  get remoteProducersCount() {
    return this.consumers.size;
  }
}

export interface NativeMediasoupSfuSessionContract extends NativeMediasoupSfuSessionSurface {
  requestId: (operation: string) => string;
  sendOrThrow: (message: SignalingMessage, label: string) => void;
  _installHandlers: () => MediaCommandResult;
  _emitState: () => MediaCommandResult;
  _fail: (error: OwnedErrorValue) => MediaCommandResult;
  _beginNativeTeardown: (
    preTeardown: MediaCommandResult,
  ) => Promise<MediaCommandResult>;
  _closeMedia: (clearSources: boolean) => Promise<MediaCommandResult>;
  _republishSources: () => Promise<MediaCommandResult>;
  _startNegotiation: () => Promise<MediaCommandResult>;
  _createCloudflareSession: () => NativeCloudflareSessionLike;
  _resolveConsumerControl: (
    data: Record<string, unknown>,
    receiving: boolean,
  ) => MediaCommandResult;
  applyJitterBufferConfig: (entry: NativeConsumerEntry) => MediaCommandResult;
  shouldReceive: (
    userId: string | number | null | undefined,
    source: string,
    ownerSource?: string | null,
  ) => boolean;
  _sendSourceState: () => MediaCommandResult;
  addSourceInternal: (entry: NativeSourceEntry) => Promise<MediaCommandResult>;
  publish: (entry: NativeSourceEntry) => Promise<NativeProducerEntry | null>;
  removeSourceInternal: (source: string) => Promise<MediaCommandResult>;
  enqueueSourceOperation: (
    source: string,
    operation: () => Promise<MediaCommandResult>,
  ) => Promise<MediaCommandResult>;
  resetReadiness: () => MediaCommandResult;
  rejectReadiness: (error: OwnedErrorValue) => MediaCommandResult;
  _handleSignalingClose: (event: CloseEvent) => MediaCommandResult;
  _acknowledgeHeartbeat: (data: Record<string, unknown>) => MediaCommandResult;
  _handleServerError: (data: Record<string, unknown>) => MediaCommandResult;
  _resolveConnect: () => MediaCommandResult;
  _handleProviderTicket: (
    data: Record<string, unknown>,
  ) => Promise<MediaCommandResult>;
  _handleRtpCapabilities: (
    data: Record<string, unknown>,
  ) => Promise<MediaCommandResult>;
  _handleTransportParams: (
    data: Record<string, unknown>,
  ) => Promise<MediaCommandResult>;
  _createConsumer: (
    data: Record<string, unknown>,
  ) => Promise<MediaCommandResult>;
  _handleTransportState: (data: Record<string, unknown>) => MediaCommandResult;
  activateProvider: (
    provider: string,
    options?: { ensureMedia?: boolean; closeMedia?: boolean },
  ) => Promise<MediaCommandResult>;
  disconnect: () => Promise<MediaCommandResult>;
  connectionState: () => Record<string, unknown>;
  stats: () => Promise<MediaCommandResult>;
  waitForPending: (
    requestId: string,
    label: string,
    timeoutMs?: number,
  ) => Promise<MediaCommandResult>;
  reportProviderFailure: (
    reason: string,
    provider?: string | null,
    providerId?: string | null,
  ) => boolean;
  restartTransportIce: (
    direction: NativeDirection,
  ) => Promise<MediaCommandResult>;
  handleTransportRecovery: (
    direction: NativeDirection,
    state: string,
  ) => MediaCommandResult;
  setRemoteReceiving: (
    userIdOrKey: string,
    sourceOrReceiving: string | boolean,
    receivingValue?: boolean,
  ) => MediaCommandResult;
  setConsumerVolume: (
    userId: string | number,
    source: string,
    volume: number,
  ) => MediaCommandResult;
  sendParticipantVoiceState: (state?: {
    muted?: boolean;
    deafened?: boolean;
  }) => MediaCommandResult;
  handleNativeAction: (action: NativeAction) => MediaCommandResult;
  handleReceiveEvent: (event: NativeReceiveEvent) => MediaCommandResult;
  closeConsumer: (
    entry: NativeConsumerEntry,
    options?: { releaseNative?: boolean },
  ) => MediaCommandResult;
  requestConsumer: (
    producerId: string,
    metadata?: Record<string, unknown>,
  ) => MediaCommandResult;
  adaptVideoReceiver: (
    logicalStreamId: string,
    preferredLayers: { spatialLayer?: number; temporalLayer?: number },
  ) => Promise<MediaCommandResult>;
  closeConsumerByProducer: (producerId: string) => MediaCommandResult;
  setJitterBufferConfig: (config?: {
    minDelayMs?: number;
    targetDelayMs?: number;
  }) => MediaCommandResult;
  _publishSource: (
    entry: NativeSourceEntry,
  ) => Promise<NativeProducerEntry | null>;
  publishVariant: (
    source: string,
    variant: {
      codec: string;
      variantId?: string;
      generation?: number;
      receivers?: string[];
      emergency?: boolean;
      score?: number;
      target?: import("./video-codec-routing.ts").CodecRoutingTarget;
      targetAdjusted?: boolean;
    },
  ) => Promise<NativeProducerEntry | null>;
  removeVariant: (
    variantId: string,
    force?: boolean,
  ) => Promise<MediaCommandResult>;
  applyCodecRoutingPlan: (
    plan: CodecRoutingPlan,
  ) => Promise<MediaCommandResult>;
  codecRoutingEvaluationTimer: ReturnType<typeof setTimeout> | null;
  codecRoutingEvaluationOperation: Promise<MediaCommandResult> | null;
  codecMigrationAcks: Map<
    string,
    Map<
      string,
      {
        variantId: string;
        state: "stable" | "abort";
        generation: number;
        updatedAt: number;
      }
    >
  >;
  handleCodecMigrationState: (
    data: Record<string, unknown>,
  ) => MediaCommandResult;
  scheduleCodecRoutingEvaluation: () => MediaCommandResult;
  evaluateCodecRoutingPlans: () => Promise<MediaCommandResult>;
}

const nativeMediasoupMethodGroups = [
  NativeMediasoupSignalingMethods,
  NativeMediasoupSourcesMethods,
  NativeMediasoupConsumersMethods,
  NativeMediasoupDiagnosticsMethods,
  NativeMediasoupLifecycleMethods,
];

for (const methodGroup of nativeMediasoupMethodGroups)
  Object.defineProperties(
    NativeMediasoupSfuSession.prototype,
    Object.getOwnPropertyDescriptors(methodGroup.prototype),
  );

export default NativeMediasoupSfuSession;
