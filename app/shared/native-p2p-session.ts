import {
  P2P_DISCONNECT_GRACE_MS,
  P2P_ICE_RESTART_TIMEOUT_MS,
} from "./native-p2p-common.ts";
import { NativeP2pSessionSourcesMethods } from "./native-p2p-session/sources.ts";
import { NativeP2pSessionDiagnosticsMethods } from "./native-p2p-session/diagnostics.ts";
import { NativeP2pSessionLifecycleMethods } from "./native-p2p-session/lifecycle.ts";
import type {
  NativeP2pSessionOptions,
  NativeP2pSessionSurface,
} from "./types/native-p2p-session.ts";
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
  }: NativeP2pSessionOptions) {
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
    this.retiredTrackEntries = new Map();
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

export interface NativeP2pSession extends NativeP2pSessionSurface {}

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
