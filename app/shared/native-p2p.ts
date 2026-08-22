import {
  P2P_ACTIVE_HEALTH_TIMEOUT_MS,
  P2P_ICE_RESTART_TIMEOUT_MS,
  P2P_DISCONNECT_GRACE_MS,
  P2P_STABILITY_LIVENESS_TIMEOUT_MS,
  applyOpusAudioProfile,
  applyP2pVideoCodecPreferences,
  countEnabledP2pSources,
  directIceServers,
  hasRequiredMediaFlow,
  isP2pLivenessExpired,
  isViableP2pPair,
  mediaFlowSnapshot,
  normalizeIceServers,
  normalizeP2pIcePolicy,
  p2pActiveLivenessTimeoutMs,
  p2pIcePolicyAllowsRelay,
  p2pRemoteFeedKey,
  requiresP2pLiveness,
  selectedPairSnapshot,
} from "./native-p2p-common.ts";
import { NativeP2pTopologyMethods } from "./native-p2p/topology.ts";
import { NativeP2pSourcesMethods } from "./native-p2p/sources.ts";
import { NativeP2pLifecycleMethods } from "./native-p2p/lifecycle.ts";
import type {
  NativeP2pMeshOptions,
  NativeP2pMeshSurface,
  P2pIcePolicy,
} from "./types/native-p2p.ts";
export class NativeP2pMesh {
  declare configuration: NativeP2pMeshSurface["configuration"];
  declare connections: NativeP2pMeshSurface["connections"];
  declare sendSignal: NativeP2pMeshSurface["sendSignal"];
  declare onRemoteTrack: NativeP2pMeshSurface["onRemoteTrack"];
  declare onRemoteTrackEnded: NativeP2pMeshSurface["onRemoteTrackEnded"];
  declare onFailure: NativeP2pMeshSurface["onFailure"];
  declare onSnapshot: NativeP2pMeshSurface["onSnapshot"];
  declare getSenderOptions: NativeP2pMeshSurface["getSenderOptions"];
  declare getAudioStereo: NativeP2pMeshSurface["getAudioStereo"];
  declare getControlConnectionEpoch: NativeP2pMeshSurface["getControlConnectionEpoch"];
  declare mediaCapabilities: NativeP2pMeshSurface["mediaCapabilities"];
  declare localSources: NativeP2pMeshSurface["localSources"];
  declare sourceTransmission: NativeP2pMeshSurface["sourceTransmission"];
  declare remoteSources: NativeP2pMeshSurface["remoteSources"];
  declare remoteSourceOwners: NativeP2pMeshSurface["remoteSourceOwners"];
  declare remoteSourceGenerations: NativeP2pMeshSurface["remoteSourceGenerations"];
  declare remoteSourceConnectionEpochs: NativeP2pMeshSurface["remoteSourceConnectionEpochs"];
  declare localPeerId: NativeP2pMeshSurface["localPeerId"];
  declare epoch: number;
  declare mode: string;
  declare healthInterval: NativeP2pMeshSurface["healthInterval"];
  declare qualificationTimeout: NativeP2pMeshSurface["qualificationTimeout"];
  declare readyReported: boolean;
  declare failureReportedKey: string | null;
  declare healthCheckRunning: boolean;
  declare healthRunToken: number;
  declare senderOperations: NativeP2pMeshSurface["senderOperations"];
  declare trackOperations: NativeP2pMeshSurface["trackOperations"];
  declare sourceOperations: NativeP2pMeshSurface["sourceOperations"];
  declare pendingSignals: NativeP2pMeshSurface["pendingSignals"];
  declare pendingSignalLimit: number;
  declare jitterBufferMinimumDelay: number;
  declare jitterBufferTargetDelay: number;
  declare p2pIcePolicy: P2pIcePolicy;
  declare fail: NativeP2pMeshSurface["fail"];
  declare emitSnapshot: NativeP2pMeshSurface["emitSnapshot"];
  declare sendControl: NativeP2pMeshSurface["sendControl"];
  declare queuePendingSignal: NativeP2pMeshSurface["queuePendingSignal"];
  declare usesStereoAudio: NativeP2pMeshSurface["usesStereoAudio"];
  declare configureStateSenders: NativeP2pMeshSurface["configureStateSenders"];
  declare setSenderReceiving: NativeP2pMeshSurface["setSenderReceiving"];
  declare closeConnection: NativeP2pMeshSurface["closeConnection"];
  declare closeAll: NativeP2pMeshSurface["closeAll"];
  declare startQualificationTimeout: NativeP2pMeshSurface["startQualificationTimeout"];
  declare startHealthChecks: NativeP2pMeshSurface["startHealthChecks"];
  declare stopHealthChecks: NativeP2pMeshSurface["stopHealthChecks"];
  declare checkQualification: NativeP2pMeshSurface["checkQualification"];
  declare flushPendingSignals: NativeP2pMeshSurface["flushPendingSignals"];
  declare ensureConnection: NativeP2pMeshSurface["ensureConnection"];
  declare resynchronizeEpoch: NativeP2pMeshSurface["resynchronizeEpoch"];
  declare attachSource: NativeP2pMeshSurface["attachSource"];
  declare signal: NativeP2pMeshSurface["signal"];
  declare enqueuePeerSignaling: NativeP2pMeshSurface["enqueuePeerSignaling"];
  declare schedulePeerNegotiation: NativeP2pMeshSurface["schedulePeerNegotiation"];
  declare retryPeerNegotiation: NativeP2pMeshSurface["retryPeerNegotiation"];
  declare receiveSignal: NativeP2pMeshSurface["receiveSignal"];
  declare applyPeerSignal: NativeP2pMeshSurface["applyPeerSignal"];
  declare bindHealthChannel: NativeP2pMeshSurface["bindHealthChannel"];
  declare handleConnectionState: NativeP2pMeshSurface["handleConnectionState"];
  declare handleIceState: NativeP2pMeshSurface["handleIceState"];
  declare handleTrack: NativeP2pMeshSurface["handleTrack"];
  declare updateSender: NativeP2pMeshSurface["updateSender"];
  declare updateTrack: NativeP2pMeshSurface["updateTrack"];
  declare setSenderActive: NativeP2pMeshSurface["setSenderActive"];
  declare configureSender: NativeP2pMeshSurface["configureSender"];
  declare getSnapshot: NativeP2pMeshSurface["getSnapshot"];
  declare applyTopology: NativeP2pMeshSurface["applyTopology"];
  declare publishSource: NativeP2pMeshSurface["publishSource"];
  declare enqueueSourceOperation: NativeP2pMeshSurface["enqueueSourceOperation"];
  declare publishSourceInternal: NativeP2pMeshSurface["publishSourceInternal"];
  declare unpublishSource: NativeP2pMeshSurface["unpublishSource"];
  declare unpublishSourceInternal: NativeP2pMeshSurface["unpublishSourceInternal"];
  declare setSourceTransmission: NativeP2pMeshSurface["setSourceTransmission"];
  declare setRemoteReceiving: NativeP2pMeshSurface["setRemoteReceiving"];
  declare isMediaReady: NativeP2pMeshSurface["isMediaReady"];
  declare stats: NativeP2pMeshSurface["stats"];
  declare diagnosticStats: NativeP2pMeshSurface["diagnosticStats"];
  declare getInboundTrackStats: NativeP2pMeshSurface["getInboundTrackStats"];
  declare getOutboundTrackStats: NativeP2pMeshSurface["getOutboundTrackStats"];
  declare getOutboundTrackParameters: NativeP2pMeshSurface["getOutboundTrackParameters"];
  declare setJitterBufferConfig: NativeP2pMeshSurface["setJitterBufferConfig"];
  declare reconfigureSource: NativeP2pMeshSurface["reconfigureSource"];
  constructor({
    iceServers,
    sendSignal,
    onRemoteTrack,
    onRemoteTrackEnded,
    onFailure,
    onSnapshot,
    getSenderOptions,
    getAudioStereo,
    mediaCapabilities,
    getControlConnectionEpoch,
    p2pIcePolicy,
  }: NativeP2pMeshOptions) {
    const icePolicy = normalizeP2pIcePolicy(p2pIcePolicy);
    this.configuration = {
      iceServers: p2pIcePolicyAllowsRelay(icePolicy)
        ? normalizeIceServers(iceServers)
        : directIceServers(iceServers),
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
      iceCandidatePoolSize: 2,
    };
    this.sendSignal = sendSignal;
    this.onRemoteTrack = onRemoteTrack;
    this.onRemoteTrackEnded = onRemoteTrackEnded;
    this.onFailure = onFailure;
    this.onSnapshot = onSnapshot;
    this.getSenderOptions = getSenderOptions;
    this.getAudioStereo = getAudioStereo;
    this.getControlConnectionEpoch = getControlConnectionEpoch;
    this.mediaCapabilities = mediaCapabilities || null;
    this.connections = new Map();
    this.localSources = new Map();
    this.sourceTransmission = new Map();
    this.remoteSources = new Map();
    this.remoteSourceOwners = new Map();
    this.remoteSourceGenerations = new Map();
    this.remoteSourceConnectionEpochs = new Map();
    this.localPeerId = null;
    this.epoch = 0;
    this.mode = "idle";
    this.healthInterval = null;
    this.qualificationTimeout = null;
    this.readyReported = false;
    this.failureReportedKey = null;
    this.healthCheckRunning = false;
    this.healthRunToken = 0;
    this.senderOperations = new WeakMap();
    this.trackOperations = new WeakMap();
    this.sourceOperations = new Map();
    this.pendingSignals = new Map();
    this.pendingSignalLimit = 256;
    this.jitterBufferMinimumDelay = 0;
    this.jitterBufferTargetDelay = 20;
    this.p2pIcePolicy = icePolicy;
  }
}

export type NativeP2pMeshContract = NativeP2pMeshSurface & NativeP2pMesh;

const nativeP2pMethodGroups = [
  NativeP2pTopologyMethods,
  NativeP2pSourcesMethods,
  NativeP2pLifecycleMethods,
];

for (const methodGroup of nativeP2pMethodGroups)
  Object.defineProperties(
    NativeP2pMesh.prototype,
    Object.getOwnPropertyDescriptors(methodGroup.prototype),
  );

export {
  P2P_ACTIVE_HEALTH_TIMEOUT_MS,
  P2P_DISCONNECT_GRACE_MS,
  P2P_ICE_RESTART_TIMEOUT_MS,
  P2P_STABILITY_LIVENESS_TIMEOUT_MS,
  applyOpusAudioProfile,
  applyP2pVideoCodecPreferences,
  countEnabledP2pSources,
  directIceServers,
  hasRequiredMediaFlow,
  isP2pLivenessExpired,
  isViableP2pPair,
  mediaFlowSnapshot,
  p2pActiveLivenessTimeoutMs,
  p2pRemoteFeedKey,
  requiresP2pLiveness,
  selectedPairSnapshot,
};
