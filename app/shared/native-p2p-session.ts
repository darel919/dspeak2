import {
  P2P_DISCONNECT_GRACE_MS,
  P2P_ICE_RESTART_TIMEOUT_MS,
} from "./native-p2p-common.ts";
import { nativeP2pSessionSourcesMethods } from "./native-p2p-session/sources.ts";
import { nativeP2pSessionDiagnosticsMethods } from "./native-p2p-session/diagnostics.ts";
import { nativeP2pSessionLifecycleMethods } from "./native-p2p-session/lifecycle.ts";
import type {
  NativeP2pSessionOptions,
  NativeP2pSessionSurface,
} from "./types/native-p2p-session.ts";
export class NativeP2pSession {
  declare invoke: NativeP2pSessionSurface["invoke"];
  declare sendSignal: NativeP2pSessionSurface["sendSignal"];
  declare sendMessage: NativeP2pSessionSurface["sendMessage"];
  declare onRemoteTrack: NativeP2pSessionSurface["onRemoteTrack"];
  declare onRemoteTrackEnded: NativeP2pSessionSurface["onRemoteTrackEnded"];
  declare onStateChange: NativeP2pSessionSurface["onStateChange"];
  declare onError: NativeP2pSessionSurface["onError"];
  declare getAudioBitrate: NativeP2pSessionSurface["getAudioBitrate"];
  declare getAudioStereo: NativeP2pSessionSurface["getAudioStereo"];
  declare getVideoSettings: NativeP2pSessionSurface["getVideoSettings"];
  declare mediaCapabilities: NativeP2pSessionSurface["mediaCapabilities"];
  declare disconnectGraceMs: number;
  declare iceRestartTimeoutMs: number;
  declare peers: NativeP2pSessionSurface["peers"];
  declare sources: NativeP2pSessionSurface["sources"];
  declare sourceTransmission: NativeP2pSessionSurface["sourceTransmission"];
  declare remoteReceiving: NativeP2pSessionSurface["remoteReceiving"];
  declare trackEntries: NativeP2pSessionSurface["trackEntries"];
  declare retiredTrackEntries: NativeP2pSessionSurface["retiredTrackEntries"];
  declare codecMigrationTelemetry: NativeP2pSessionSurface["codecMigrationTelemetry"];
  declare videoDecodeOverloadTelemetry: NativeP2pSessionSurface["videoDecodeOverloadTelemetry"];
  declare codecRuntimeTelemetry: NativeP2pSessionSurface["codecRuntimeTelemetry"];
  declare jitterBufferMinimumDelay: number;
  declare jitterBufferTargetDelay: number;
  declare mode: string;
  declare epoch: number;
  declare localPeerId: string;
  declare closed: boolean;
  declare operation: NativeP2pSessionSurface["operation"];
  declare pendingSignals: NativeP2pSessionSurface["pendingSignals"];
  declare pendingSignalLimit: number;
  declare _enqueue: NativeP2pSessionSurface["_enqueue"];
  declare closeAll: NativeP2pSessionSurface["closeAll"];
  declare shutdown: NativeP2pSessionSurface["shutdown"];
  declare addSourceInternal: NativeP2pSessionSurface["addSourceInternal"];
  declare removeSourceInternal: NativeP2pSessionSurface["removeSourceInternal"];
  declare handleSignalInternal: NativeP2pSessionSurface["handleSignalInternal"];
  declare queuePendingSignal: NativeP2pSessionSurface["queuePendingSignal"];
  declare _flushPendingSignals: NativeP2pSessionSurface["_flushPendingSignals"];
  declare _ensurePeer: NativeP2pSessionSurface["_ensurePeer"];
  declare _selectPeerCodec: NativeP2pSessionSurface["_selectPeerCodec"];
  declare _reconcilePendingVideoSources: NativeP2pSessionSurface["_reconcilePendingVideoSources"];
  declare _applyJitterBufferConfig: NativeP2pSessionSurface["_applyJitterBufferConfig"];
  declare _updateSourceParameters: NativeP2pSessionSurface["_updateSourceParameters"];
  declare setRemoteReceiving: NativeP2pSessionSurface["setRemoteReceiving"];
  declare applyTopology: NativeP2pSessionSurface["applyTopology"];
  declare addSource: NativeP2pSessionSurface["addSource"];
  declare removeSource: NativeP2pSessionSurface["removeSource"];
  declare handleSignal: NativeP2pSessionSurface["handleSignal"];
  declare handleReceiveEvent: NativeP2pSessionSurface["handleReceiveEvent"];
  declare setSourceTransmission: NativeP2pSessionSurface["setSourceTransmission"];
  declare updateAudioBitrate: NativeP2pSessionSurface["updateAudioBitrate"];
  declare updateVideoBitrate: NativeP2pSessionSurface["updateVideoBitrate"];
  declare updateVideoParameters: NativeP2pSessionSurface["updateVideoParameters"];
  declare adaptVideoReceiver: NativeP2pSessionSurface["adaptVideoReceiver"];
  declare setConsumerVolume: NativeP2pSessionSurface["setConsumerVolume"];
  declare stats: NativeP2pSessionSurface["stats"];
  declare diagnosticStats: NativeP2pSessionSurface["diagnosticStats"];
  declare getOutboundRtpStats: NativeP2pSessionSurface["getOutboundRtpStats"];
  declare getInboundRtpStats: NativeP2pSessionSurface["getInboundRtpStats"];
  declare mediaReadiness: NativeP2pSessionSurface["mediaReadiness"];
  declare iceConnectedBoth: boolean;
  declare setJitterBufferConfig: NativeP2pSessionSurface["setJitterBufferConfig"];
  declare _closePeer: NativeP2pSessionSurface["_closePeer"];
  declare _acceptOffer: NativeP2pSessionSurface["_acceptOffer"];
  declare _attachSource: NativeP2pSessionSurface["_attachSource"];
  declare _detachSource: NativeP2pSessionSurface["_detachSource"];
  declare _replaceSource: NativeP2pSessionSurface["_replaceSource"];
  declare _syncAudioProfile: NativeP2pSessionSurface["_syncAudioProfile"];
  declare _setSourceParameters: NativeP2pSessionSurface["_setSourceParameters"];
  declare _sourceParameters: NativeP2pSessionSurface["_sourceParameters"];
  declare _sendSignal: NativeP2pSessionSurface["_sendSignal"];
  declare _checkPeerQualification: NativeP2pSessionSurface["_checkPeerQualification"];
  declare _handleP2pEvent: NativeP2pSessionSurface["_handleP2pEvent"];
  declare _addCandidate: NativeP2pSessionSurface["_addCandidate"];
  declare _flushCandidates: NativeP2pSessionSurface["_flushCandidates"];
  declare _createOffer: NativeP2pSessionSurface["_createOffer"];
  declare retryP2pOfferWithSoftwareFallback: NativeP2pSessionSurface["retryP2pOfferWithSoftwareFallback"];
  declare _requestOffer: NativeP2pSessionSurface["_requestOffer"];
  declare _handleIceState: NativeP2pSessionSurface["_handleIceState"];
  declare _restartIce: NativeP2pSessionSurface["_restartIce"];
  declare _failPeer: NativeP2pSessionSurface["_failPeer"];
  declare _startHealthPump: NativeP2pSessionSurface["_startHealthPump"];
  declare _stopHealthPump: NativeP2pSessionSurface["_stopHealthPump"];
  declare _hasExpectedMedia: NativeP2pSessionSurface["_hasExpectedMedia"];
  declare _emitState: NativeP2pSessionSurface["_emitState"];
  constructor({
    invoke,
    sendSignal,
    sendMessage,
    onRemoteTrack,
    onRemoteTrackEnded,
    onStateChange,
    onError,
    getAudioBitrate,
    getAudioStereo,
    getVideoSettings,
    mediaCapabilities = null,
    disconnectGraceMs = P2P_DISCONNECT_GRACE_MS,
    iceRestartTimeoutMs = P2P_ICE_RESTART_TIMEOUT_MS,
  }: NativeP2pSessionOptions) {
    if (!(invoke instanceof Function))
      throw new TypeError("NativeP2pSession requires invoke");
    this.invoke = invoke;
    this.sendSignal = sendSignal;
    this.sendMessage = sendMessage;
    this.onRemoteTrack = onRemoteTrack;
    this.onRemoteTrackEnded = onRemoteTrackEnded;
    this.onStateChange = onStateChange;
    this.onError = onError;
    this.getAudioBitrate = getAudioBitrate;
    this.getAudioStereo = getAudioStereo;
    this.getVideoSettings = getVideoSettings;
    this.mediaCapabilities = mediaCapabilities;
    this.disconnectGraceMs = disconnectGraceMs;
    this.iceRestartTimeoutMs = iceRestartTimeoutMs;
    this.peers = new Map();
    this.sources = new Map();
    this.sourceTransmission = new Map();
    this.remoteReceiving = new Map();
    this.trackEntries = new Map();
    this.retiredTrackEntries = new Map();
    this.codecMigrationTelemetry = [];
    this.videoDecodeOverloadTelemetry = [];
    this.codecRuntimeTelemetry = [];
    this.jitterBufferMinimumDelay = 0;
    this.jitterBufferTargetDelay = 20;
    this.mode = "idle";
    this.epoch = 0;
    this.localPeerId = "";
    this.closed = false;
    this.operation = Promise.resolve();
    this.pendingSignals = new Map();
    this.pendingSignalLimit = 256;
  }
}

const nativeP2pSessionMethodGroups = [
  nativeP2pSessionSourcesMethods,
  nativeP2pSessionDiagnosticsMethods,
  nativeP2pSessionLifecycleMethods,
];

for (const methodGroup of nativeP2pSessionMethodGroups)
  Object.defineProperties(
    NativeP2pSession.prototype,
    Object.getOwnPropertyDescriptors(methodGroup),
  );

export default NativeP2pSession;
