import { nativeCloudflareInitializationMethods } from "./native-cloudflare-realtime-session/initialization.ts";
import { nativeCloudflareSourcesMethods } from "./native-cloudflare-realtime-session/sources.ts";
import { nativeCloudflareRemoteMethods } from "./native-cloudflare-realtime-session/remote.ts";
import { nativeCloudflareLifecycleMethods } from "./native-cloudflare-realtime-session/lifecycle.ts";
import type {
  NativeCloudflareSessionOptions,
  NativeCloudflareSessionSurface,
} from "./types/native-cloudflare-session.ts";
export class NativeCloudflareRealtimeSession {
  declare invoke: NativeCloudflareSessionSurface["invoke"];
  declare send: NativeCloudflareSessionSurface["send"];
  declare ensureControlReady: NativeCloudflareSessionSurface["ensureControlReady"];
  declare onRemoteTrack: NativeCloudflareSessionSurface["onRemoteTrack"];
  declare onRemoteTrackEnded: NativeCloudflareSessionSurface["onRemoteTrackEnded"];
  declare onStateChange: NativeCloudflareSessionSurface["onStateChange"];
  declare onError: NativeCloudflareSessionSurface["onError"];
  declare getAudioBitrate: NativeCloudflareSessionSurface["getAudioBitrate"];
  declare getAudioStereo: NativeCloudflareSessionSurface["getAudioStereo"];
  declare getVideoSettings: NativeCloudflareSessionSurface["getVideoSettings"];
  declare requestTimeoutMs: number;
  declare localPeerId: string;
  declare sources: NativeCloudflareSessionSurface["sources"];
  declare producers: NativeCloudflareSessionSurface["producers"];
  declare producerVariants: NativeCloudflareSessionSurface["producerVariants"];
  declare consumers: NativeCloudflareSessionSurface["consumers"];
  declare sourceTransmission: NativeCloudflareSessionSurface["sourceTransmission"];
  declare remoteReceiving: NativeCloudflareSessionSurface["remoteReceiving"];
  declare localVideoFeeds: NativeCloudflareSessionSurface["localVideoFeeds"];
  declare pendingLocalVideoFrames: NativeCloudflareSessionSurface["pendingLocalVideoFrames"];
  declare remoteVideoFeeds: NativeCloudflareSessionSurface["remoteVideoFeeds"];
  declare remoteAudioFeeds: NativeCloudflareSessionSurface["remoteAudioFeeds"];
  declare mediaCapabilities: NativeCloudflareSessionSurface["mediaCapabilities"];
  declare logicalVideoStreams: NativeCloudflareSessionSurface["logicalVideoStreams"];
  declare codecMigrationTelemetry: NativeCloudflareSessionSurface["codecMigrationTelemetry"];
  declare videoDecodeOverloadTelemetry: NativeCloudflareSessionSurface["videoDecodeOverloadTelemetry"];
  declare codecRuntimeTelemetry: NativeCloudflareSessionSurface["codecRuntimeTelemetry"];
  declare publications: NativeCloudflareSessionSurface["publications"];
  declare remoteByMid: NativeCloudflareSessionSurface["remoteByMid"];
  declare pendingRemoteTrackEvents: NativeCloudflareSessionSurface["pendingRemoteTrackEvents"];
  declare pending: NativeCloudflareSessionSurface["pending"];
  declare subscriptionTasks: NativeCloudflareSessionSurface["subscriptionTasks"];
  declare subscribedTrackNames: NativeCloudflareSessionSurface["subscribedTrackNames"];
  declare subscriptionsStarted: boolean;
  declare negotiationQueue: NativeCloudflareSessionSurface["negotiationQueue"];
  declare sourceOperations: NativeCloudflareSessionSurface["sourceOperations"];
  declare rtpSamples: NativeCloudflareSessionSurface["rtpSamples"];
  declare handle: NativeCloudflareSessionSurface["handle"];
  declare sessionId: NativeCloudflareSessionSurface["sessionId"];
  declare initializing: NativeCloudflareSessionSurface["initializing"];
  declare sessionGeneration: number;
  declare closed: boolean;
  declare iceState: number;
  declare jitterBufferMinimumDelay: number;
  declare jitterBufferTargetDelay: number;
  declare lastReceivedConsumerParams: unknown;
  declare controlConnectionEpoch: number;
  constructor({
    invoke,
    send,
    ensureControlReady,
    onRemoteTrack,
    onRemoteTrackEnded,
    onStateChange,
    onError,
    getAudioBitrate,
    getAudioStereo,
    getVideoSettings,
    requestTimeoutMs = 15000,
    localPeerId = "",
    sources = new Map(),
    producers = new Map(),
    producerVariants = new Map(),
    consumers = new Map(),
    sourceTransmission = new Map(),
    remoteReceiving = new Map(),
    localVideoFeeds = new Map(),
    pendingLocalVideoFrames = new Map(),
    remoteVideoFeeds = new Map(),
    remoteAudioFeeds = new Map(),
    mediaCapabilities = null,
    getControlConnectionEpoch,
  }: NativeCloudflareSessionOptions) {
    if (!(invoke instanceof Function))
      throw new TypeError("NativeCloudflareRealtimeSession requires invoke");
    this.invoke = invoke;
    this.send = send;
    this.ensureControlReady = ensureControlReady;
    this.onRemoteTrack = onRemoteTrack;
    this.onRemoteTrackEnded = onRemoteTrackEnded;
    this.onStateChange = onStateChange;
    this.onError = onError;
    this.getAudioBitrate = getAudioBitrate;
    this.getAudioStereo = getAudioStereo;
    this.getVideoSettings = getVideoSettings;
    this.requestTimeoutMs = requestTimeoutMs;
    this.localPeerId = String(localPeerId || "");
    this.sources = sources;
    this.producers = producers;
    this.producerVariants = producerVariants;
    this.consumers = consumers;
    this.sourceTransmission = sourceTransmission;
    this.remoteReceiving = remoteReceiving;
    this.localVideoFeeds = localVideoFeeds;
    this.pendingLocalVideoFrames = pendingLocalVideoFrames;
    this.remoteVideoFeeds = remoteVideoFeeds;
    this.remoteAudioFeeds = remoteAudioFeeds;
    this.mediaCapabilities = mediaCapabilities;
    this.logicalVideoStreams = new Map();
    this.codecMigrationTelemetry = [];
    this.videoDecodeOverloadTelemetry = [];
    this.codecRuntimeTelemetry = [];
    this.publications = new Map();
    this.remoteByMid = new Map();
    this.pendingRemoteTrackEvents = new Map();
    this.pending = new Map();
    this.subscriptionTasks = new Map();
    this.subscribedTrackNames = new Set();
    this.subscriptionsStarted = false;
    this.negotiationQueue = Promise.resolve();
    this.sourceOperations = new Map();
    this.rtpSamples = new Map();
    this.handle = null;
    this.sessionId = null;
    this.initializing = null;
    this.sessionGeneration = 0;
    this.closed = true;
    this.iceState = 0;
    this.jitterBufferMinimumDelay = 0;
    this.jitterBufferTargetDelay = 20;
    this.lastReceivedConsumerParams = null;
    this.controlConnectionEpoch = 0;
    if (getControlConnectionEpoch)
      this.getControlConnectionEpoch = getControlConnectionEpoch;
  }

  getControlConnectionEpoch = () => this.controlConnectionEpoch;

  declare _assertCurrent: NativeCloudflareSessionSurface["_assertCurrent"];
  declare _emitState: NativeCloudflareSessionSurface["_emitState"];
  declare closeMedia: NativeCloudflareSessionSurface["closeMedia"];
  declare removeSource: NativeCloudflareSessionSurface["removeSource"];
  declare removeVariant: NativeCloudflareSessionSurface["removeVariant"];
  declare retireVariants: NativeCloudflareSessionSurface["retireVariants"];
  declare hasVariant: NativeCloudflareSessionSurface["hasVariant"];
  declare updateVariantMetadata: NativeCloudflareSessionSurface["updateVariantMetadata"];
  declare setSourceTransmission: NativeCloudflareSessionSurface["setSourceTransmission"];
  declare updateAudioBitrate: NativeCloudflareSessionSurface["updateAudioBitrate"];
  declare updateVideoBitrate: NativeCloudflareSessionSurface["updateVideoBitrate"];
  declare updateVideoParameters: NativeCloudflareSessionSurface["updateVideoParameters"];
  declare updateVariantVideoParameters: NativeCloudflareSessionSurface["updateVariantVideoParameters"];
  declare setRemoteReceiving: NativeCloudflareSessionSurface["setRemoteReceiving"];
  declare setConsumerVolume: NativeCloudflareSessionSurface["setConsumerVolume"];
  declare sendParticipantVoiceState: NativeCloudflareSessionSurface["sendParticipantVoiceState"];
  declare setJitterBufferConfig: NativeCloudflareSessionSurface["setJitterBufferConfig"];
  declare handleReceiveEvent: NativeCloudflareSessionSurface["handleReceiveEvent"];
  declare startSubscriptions: NativeCloudflareSessionSurface["startSubscriptions"];
  declare addSource: NativeCloudflareSessionSurface["addSource"];
  declare handleMessage: NativeCloudflareSessionSurface["handleMessage"];
  declare reconcilePublications: NativeCloudflareSessionSurface["reconcilePublications"];
  declare reconcilePublicationsOnce: NativeCloudflareSessionSurface["reconcilePublicationsOnce"];
  declare subscribe: NativeCloudflareSessionSurface["subscribe"];
  declare _closeConsumer: NativeCloudflareSessionSurface["_closeConsumer"];
  declare request: NativeCloudflareSessionSurface["request"];
  declare enqueueNegotiation: NativeCloudflareSessionSurface["enqueueNegotiation"];
  declare applyJitterBufferConfig: NativeCloudflareSessionSurface["applyJitterBufferConfig"];
  declare takePendingLocalVideoFrame: NativeCloudflareSessionSurface["takePendingLocalVideoFrame"];
  declare initialize: NativeCloudflareSessionSurface["initialize"];
  declare _handleTrackAdded: NativeCloudflareSessionSurface["_handleTrackAdded"];
}

const nativeCloudflareMethodGroups = [
  nativeCloudflareInitializationMethods,
  nativeCloudflareSourcesMethods,
  nativeCloudflareRemoteMethods,
  nativeCloudflareLifecycleMethods,
];

for (const methodGroup of nativeCloudflareMethodGroups)
  Object.defineProperties(
    NativeCloudflareRealtimeSession.prototype,
    Object.getOwnPropertyDescriptors(methodGroup),
  );

export default NativeCloudflareRealtimeSession;
