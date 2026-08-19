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
  p2pActiveLivenessTimeoutMs,
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
} from "./types/native-p2p.ts";
export class NativeP2pMesh {
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
  }: NativeP2pMeshOptions) {
    this.configuration = {
      iceServers: directIceServers(iceServers),
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
  }
}

export interface NativeP2pMesh extends NativeP2pMeshSurface {}

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
