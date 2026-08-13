import { NativeCloudflareInitializationMethods } from "./native-cloudflare-realtime-session/initialization.ts";
import { NativeCloudflareSourcesMethods } from "./native-cloudflare-realtime-session/sources.ts";
import { NativeCloudflareRemoteMethods } from "./native-cloudflare-realtime-session/remote.ts";
import { NativeCloudflareLifecycleMethods } from "./native-cloudflare-realtime-session/lifecycle.ts";
import type {
  NativeCloudflareSessionOptions,
  NativeCloudflareSessionSurface,
} from "./types/native-cloudflare-session.ts";
export class NativeCloudflareRealtimeSession {
  constructor({
    invoke,
    send,
    onRemoteTrack,
    onRemoteTrackEnded,
    onStateChange,
    onError,
    getAudioBitrate,
    getAudioStereo,
    getVideoSettings,
    requestTimeoutMs = 15000,
    sources = new Map(),
    producers = new Map(),
    consumers = new Map(),
    sourceTransmission = new Map(),
    remoteReceiving = new Map(),
    localVideoFeeds = new Map(),
    remoteVideoFeeds = new Map(),
    remoteAudioFeeds = new Map(),
  }: NativeCloudflareSessionOptions) {
    if (typeof invoke !== "function")
      throw new TypeError("NativeCloudflareRealtimeSession requires invoke");
    this.invoke = invoke;
    this.send = send;
    this.onRemoteTrack = onRemoteTrack;
    this.onRemoteTrackEnded = onRemoteTrackEnded;
    this.onStateChange = onStateChange;
    this.onError = onError;
    this.getAudioBitrate = getAudioBitrate;
    this.getAudioStereo = getAudioStereo;
    this.getVideoSettings = getVideoSettings;
    this.requestTimeoutMs = requestTimeoutMs;
    this.sources = sources;
    this.producers = producers;
    this.consumers = consumers;
    this.sourceTransmission = sourceTransmission;
    this.remoteReceiving = remoteReceiving;
    this.localVideoFeeds = localVideoFeeds;
    this.remoteVideoFeeds = remoteVideoFeeds;
    this.remoteAudioFeeds = remoteAudioFeeds;
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
  }
}

export interface NativeCloudflareRealtimeSession extends NativeCloudflareSessionSurface {}

const nativeCloudflareMethodGroups = [
  NativeCloudflareInitializationMethods,
  NativeCloudflareSourcesMethods,
  NativeCloudflareRemoteMethods,
  NativeCloudflareLifecycleMethods,
];

for (const methodGroup of nativeCloudflareMethodGroups)
  Object.defineProperties(
    NativeCloudflareRealtimeSession.prototype,
    Object.getOwnPropertyDescriptors(methodGroup.prototype),
  );

export default NativeCloudflareRealtimeSession;
