import { CloudflareNegotiationMethods } from "./cloudflare-realtime-session/negotiation.ts";
import { CloudflareSourcesMethods } from "./cloudflare-realtime-session/sources.ts";
import { CloudflareLifecycleMethods } from "./cloudflare-realtime-session/lifecycle.ts";
export class CloudflareRealtimeSession {
  [key: string]: any;
  constructor({
    send,
    iceServers,
    onRemoteTrack,
    onRemoteTrackEnded,
    onStateChange,
    getVideoSettings,
  }) {
    this.send = send;
    this.iceServers = iceServers;
    this.onRemoteTrack = onRemoteTrack;
    this.onRemoteTrackEnded = onRemoteTrackEnded;
    this.onStateChange = onStateChange;
    this.getVideoSettings = getVideoSettings;
    this.peerConnection = null;
    this.sessionId = null;
    this.initializing = null;
    this.pending = new Map();
    this.producers = new Map();
    this.consumers = new Map();
    this.sourceTransmission = new Map();
    this.remoteReceiving = new Map();
    this.publications = new Map();
    this.remoteByMid = new Map();
    this.pendingRemoteTracks = new Map();
    this.rtpSamples = new Map();
    this.subscriptionTasks = new Map();
    this.subscribedTrackNames = new Set();
    this.subscriptionsStarted = false;
    this.negotiationQueue = Promise.resolve();
    this.sourceOperations = new Map();
    this.sessionGeneration = 0;
    this.lastSentClientRtpCapabilities = null;
    this.lastReceivedConsumerParams = null;
  }
}

const cloudflareMethodGroups = [
  CloudflareNegotiationMethods,
  CloudflareSourcesMethods,
  CloudflareLifecycleMethods,
];

for (const methodGroup of cloudflareMethodGroups)
  Object.defineProperties(
    CloudflareRealtimeSession.prototype,
    Object.getOwnPropertyDescriptors(methodGroup.prototype),
  );
