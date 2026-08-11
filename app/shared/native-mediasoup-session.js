import { mediaSignalingUrl } from "./media-signaling-socket.js";
import { NativeMediasoupSignalingMethods } from "./native-mediasoup-session/signaling.js";
import { NativeMediasoupSourcesMethods } from "./native-mediasoup-session/sources.js";
import { NativeMediasoupConsumersMethods } from "./native-mediasoup-session/consumers.js";
import { NativeMediasoupDiagnosticsMethods } from "./native-mediasoup-session/diagnostics.js";
import { NativeMediasoupLifecycleMethods } from "./native-mediasoup-session/lifecycle.js";

export class NativeMediasoupSfuSession {
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
  } = {}) {
    if (typeof invoke !== "function")
      throw new TypeError("NativeMediasoupSfuSession requires invoke");
    this.invoke = invoke;
    this.buildUrl =
      buildUrl ||
      ((channelId) =>
        mediaSignalingUrl(
          signalingPath,
          channelId,
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
    this.signaling = null;
    this.providerSignaling = null;
    this.controlTicket = "";
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
    this.sourcePublications = new Map();
    this.sourceOperations = new Map();
    this.pendingCloudflarePublications = new Map();
    this.sourceTransmission = new Map();
    this.producerRemovals = new Map();
    this.consumers = new Map();
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
    this.selectedProvider = "mediasoup";
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
    this.lastProviderFailureKey = null;
    this._installHandlers();
  }

  get errorMessage() {
    return this.error?.message || this.error || null;
  }
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
