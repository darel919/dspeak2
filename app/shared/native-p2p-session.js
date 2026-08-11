import {
  P2P_DISCONNECT_GRACE_MS,
  P2P_ICE_RESTART_TIMEOUT_MS,
} from "./native-p2p-common.js";
import { NativeP2pSessionSourcesMethods } from "./native-p2p-session/sources.js";
import { NativeP2pSessionDiagnosticsMethods } from "./native-p2p-session/diagnostics.js";
import { NativeP2pSessionLifecycleMethods } from "./native-p2p-session/lifecycle.js";

export class NativeP2pSession {
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
    disconnectGraceMs = P2P_DISCONNECT_GRACE_MS,
    iceRestartTimeoutMs = P2P_ICE_RESTART_TIMEOUT_MS,
  } = {}) {
    if (typeof invoke !== "function")
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
    this.disconnectGraceMs = disconnectGraceMs;
    this.iceRestartTimeoutMs = iceRestartTimeoutMs;
    this.peers = new Map();
    this.sources = new Map();
    this.sourceTransmission = new Map();
    this.remoteReceiving = new Map();
    this.trackEntries = new Map();
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
  NativeP2pSessionSourcesMethods,
  NativeP2pSessionDiagnosticsMethods,
  NativeP2pSessionLifecycleMethods,
];

for (const methodGroup of nativeP2pSessionMethodGroups)
  Object.defineProperties(
    NativeP2pSession.prototype,
    Object.getOwnPropertyDescriptors(methodGroup.prototype),
  );

export default NativeP2pSession;
