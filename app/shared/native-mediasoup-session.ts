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
export class NativeMediasoupSfuSession {
  mediaProfile: NativeMediaProfile;
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
    if (typeof invoke !== "function")
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

export interface NativeMediasoupSfuSession extends NativeMediasoupSfuSessionSurface {
  requestId: (operation: string) => string;
  sendOrThrow: (message: unknown, label: string) => void;
  _installHandlers: () => unknown;
  _emitState: () => unknown;
  _fail: (error: unknown) => unknown;
  _beginNativeTeardown: (preTeardown: unknown) => Promise<unknown>;
  _closeMedia: (clearSources: boolean) => Promise<unknown>;
  _republishSources: () => Promise<unknown>;
  _startNegotiation: () => Promise<unknown>;
  _createCloudflareSession: () => NativeCloudflareSessionLike;
  _resolveConsumerControl: (
    data: Record<string, unknown>,
    receiving: boolean,
  ) => unknown;
  applyJitterBufferConfig: (entry: NativeConsumerEntry) => unknown;
  shouldReceive: (
    userId: string | number | null | undefined,
    source: string,
    ownerSource?: string | null,
  ) => boolean;
  _sendSourceState: () => unknown;
  addSourceInternal: (entry: NativeSourceEntry) => Promise<unknown>;
  publish: (entry: NativeSourceEntry) => Promise<NativeProducerEntry | null>;
  removeSourceInternal: (source: string) => Promise<unknown>;
  enqueueSourceOperation: (
    source: string,
    operation: () => Promise<unknown>,
  ) => Promise<unknown>;
  resetReadiness: () => unknown;
  rejectReadiness: (error: unknown) => unknown;
  _handleSignalingClose: (event: CloseEvent) => unknown;
  _acknowledgeHeartbeat: (data: Record<string, unknown>) => unknown;
  _handleServerError: (data: Record<string, unknown>) => unknown;
  _resolveConnect: () => unknown;
  _handleProviderTicket: (data: Record<string, unknown>) => Promise<unknown>;
  _handleRtpCapabilities: (data: Record<string, unknown>) => Promise<unknown>;
  _handleTransportParams: (data: Record<string, unknown>) => Promise<unknown>;
  _createConsumer: (data: Record<string, unknown>) => Promise<unknown>;
  _handleTransportState: (data: Record<string, unknown>) => unknown;
  activateProvider: (
    provider: string,
    options?: { ensureMedia?: boolean; closeMedia?: boolean },
  ) => Promise<unknown>;
  disconnect: () => Promise<unknown>;
  connectionState: () => Record<string, unknown>;
  stats: () => Promise<unknown>;
  waitForPending: (
    requestId: string,
    label: string,
    timeoutMs?: number,
  ) => Promise<unknown>;
  reportProviderFailure: (
    reason: string,
    provider?: string | null,
    providerId?: string | null,
  ) => boolean;
  restartTransportIce: (direction: NativeDirection) => Promise<unknown>;
  handleTransportRecovery: (
    direction: NativeDirection,
    state: string,
  ) => unknown;
  setRemoteReceiving: (
    userIdOrKey: string,
    sourceOrReceiving: string | boolean,
    receivingValue?: boolean,
  ) => unknown;
  setConsumerVolume: (
    userId: string | number,
    source: string,
    volume: number,
  ) => unknown;
  sendParticipantVoiceState: (state?: {
    muted?: boolean;
    deafened?: boolean;
  }) => unknown;
  handleNativeAction: (action: NativeAction) => unknown;
  handleReceiveEvent: (event: NativeReceiveEvent) => unknown;
  closeConsumer: (
    entry: NativeConsumerEntry,
    options?: { releaseNative?: boolean },
  ) => unknown;
  requestConsumer: (
    producerId: string,
    metadata?: Record<string, unknown>,
  ) => unknown;
  adaptVideoReceiver: (
    logicalStreamId: string,
    preferredLayers: { spatialLayer?: number; temporalLayer?: number },
  ) => Promise<unknown>;
  closeConsumerByProducer: (producerId: string) => unknown;
  setJitterBufferConfig: (config?: {
    minDelayMs?: number;
    targetDelayMs?: number;
  }) => unknown;
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
  removeVariant: (variantId: string, force?: boolean) => Promise<unknown>;
  applyCodecRoutingPlan: (plan: CodecRoutingPlan) => Promise<unknown>;
  codecRoutingEvaluationTimer: ReturnType<typeof setTimeout> | null;
  codecRoutingEvaluationOperation: Promise<unknown> | null;
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
  handleCodecMigrationState: (data: Record<string, unknown>) => unknown;
  scheduleCodecRoutingEvaluation: () => unknown;
  evaluateCodecRoutingPlans: () => Promise<unknown>;
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
