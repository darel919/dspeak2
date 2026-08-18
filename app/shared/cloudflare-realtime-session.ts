import { CloudflareNegotiationMethods } from "./cloudflare-realtime-session/negotiation.ts";
import { CloudflareSourcesMethods } from "./cloudflare-realtime-session/sources.ts";
import { CloudflareLifecycleMethods } from "./cloudflare-realtime-session/lifecycle.ts";
import type {
  CloudflareSessionLike,
  CloudflareSessionOptions,
} from "./types/cloudflare-media.ts";
export class CloudflareRealtimeSession {
  declare peerConnection: RTCPeerConnection | null;
  declare sessionId: string | null;
  declare initializing: Promise<void> | null;
  declare pending: CloudflareSessionLike["pending"];
  declare producers: CloudflareSessionLike["producers"];
  declare consumers: CloudflareSessionLike["consumers"];
  declare sourceTransmission: CloudflareSessionLike["sourceTransmission"];
  declare remoteReceiving: CloudflareSessionLike["remoteReceiving"];
  declare publications: CloudflareSessionLike["publications"];
  declare remoteByMid: CloudflareSessionLike["remoteByMid"];
  declare pendingRemoteTracks: CloudflareSessionLike["pendingRemoteTracks"];
  declare rtpSamples: CloudflareSessionLike["rtpSamples"];
  declare subscriptionTasks: CloudflareSessionLike["subscriptionTasks"];
  declare subscribedTrackNames: Set<string>;
  declare subscriptionsStarted: boolean;
  declare negotiationQueue: Promise<unknown>;
  declare sourceOperations: CloudflareSessionLike["sourceOperations"];
  declare sessionGeneration: number;
  declare connectionEpoch: number;
  declare lastSentClientRtpCapabilities: unknown;
  declare lastReceivedConsumerParams: CloudflareSessionLike["lastReceivedConsumerParams"];
  constructor({
    send,
    iceServers,
    onRemoteTrack,
    onRemoteTrackEnded,
    onStateChange,
    getVideoSettings,
    getControlConnectionEpoch,
    localPeerId,
  }: CloudflareSessionOptions & { localPeerId?: string }) {
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
    this.connectionEpoch = 0;
    this.controlConnectionEpoch = 0;
    this.localPeerId = localPeerId || null;
    this.lastSentClientRtpCapabilities = null;
    this.lastReceivedConsumerParams = null;
    if (getControlConnectionEpoch)
      this.getControlConnectionEpoch = getControlConnectionEpoch;
  }

  getControlConnectionEpoch = () => this.controlConnectionEpoch;
}

export interface CloudflareRealtimeSession extends CloudflareSessionLike {}

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
