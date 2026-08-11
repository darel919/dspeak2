import { unref } from "vue";
import { MediaEngine } from "../../shared/media/contracts.js";
import {
  createMediaQoeReport,
  mediaQoePathsFromStats,
} from "../../shared/media-qoe.js";

const BROWSER_CAPABILITIES = Object.freeze({
  microphone: "browser",
  camera: "browser",
  screenVideo: "browser",
  screenAudio: "browser",
  p2p: "browser",
  sfu: "browser",
  receiveVideo: "browser",
  receiveAudio: "browser",
});

export class BrowserMediaEngine extends MediaEngine {
  constructor(session, { onQoe } = {}) {
    super();
    if (!session)
      throw new TypeError("BrowserMediaEngine requires a media session");
    this.session = session;
    this.listeners = new Map();
    this.initialized = false;
    this.microphoneEnabled = false;
    this.cameraEnabled = false;
    this.screenSharing = false;
    this.onQoe = onQoe;
    this.qoeTimer = null;
  }

  async initialize() {
    if (this.initialized) return;
    this.initialized = true;
    this.qoeTimer = setInterval(() => {
      this.getStats().catch(() => {});
    }, 5000);
    this.qoeTimer?.unref?.();
  }

  async joinSession(input) {
    await this.initialize();
    await this.session.connect(input.channelId || input);
  }

  async leaveSession() {
    if (this.qoeTimer) clearInterval(this.qoeTimer);
    this.qoeTimer = null;
    await this.session.disconnect();
    this.microphoneEnabled = false;
    this.cameraEnabled = false;
    this.screenSharing = false;
  }

  async setMicrophoneEnabled(enabled) {
    if (enabled) await this.session.startAudioProduction();
    else await this.session.stopAudioProduction();
    this.microphoneEnabled = enabled;
  }

  async setCameraEnabled(enabled) {
    if (enabled) await this.session.startVideoProduction("camera");
    else await this.session.stopVideoProduction("camera");
    this.cameraEnabled = enabled;
  }

  async startScreenShare(options = {}) {
    await this.session.startVideoProduction("screen", options);
    this.screenSharing = true;
  }

  async stopScreenShare() {
    await this.session.stopVideoProduction("screen");
    this.screenSharing = false;
  }

  async handleSignal(message) {
    if (typeof this.session.handleSignal === "function") {
      return this.session.handleSignal(message);
    }
    // Browser signaling is normally owned by the hybrid session.
  }

  async getDevices() {
    if (!globalThis.navigator?.mediaDevices?.enumerateDevices) return [];
    const devices = await globalThis.navigator.mediaDevices.enumerateDevices();
    return devices.map(({ deviceId, groupId, kind, label }) => ({
      deviceId,
      groupId,
      kind,
      label,
    }));
  }

  async getStats() {
    const snapshot = await this.session.getWebRTCStatsSnapshot();
    const report = createMediaQoeReport({
      provider: unref(this.session.activeProvider) || "sfu",
      epoch: unref(this.session.topologyState)?.epoch || 0,
      paths: mediaQoePathsFromStats(snapshot),
      sampledAt: snapshot.timestamp,
    });
    if (report.paths.length) this.onQoe?.(report);
    this.listeners.get("qoe")?.forEach((callback) => callback(report));
    return {
      ...snapshot,
      engine: "browser",
      topology: unref(this.session.activeProvider) || undefined,
    };
  }

  on(event, callback) {
    const callbacks = this.listeners.get(event) || new Set();
    callbacks.add(callback);
    this.listeners.set(event, callbacks);
    return () => {
      callbacks.delete(callback);
      if (callbacks.size === 0) this.listeners.delete(event);
    };
  }

  getCapabilities() {
    return BROWSER_CAPABILITIES;
  }

  async shutdown() {
    await this.leaveSession();
    this.listeners.clear();
    this.initialized = false;
    if (this.qoeTimer) clearInterval(this.qoeTimer);
    this.qoeTimer = null;
  }

  getState() {
    return unref(this.session.mediaConnectionState) || "disconnected";
  }

  isScreenSharing() {
    return this.screenSharing;
  }

  isMicrophoneEnabled() {
    return this.microphoneEnabled;
  }

  isCameraEnabled() {
    return this.cameraEnabled;
  }

  get connected() {
    return this.session.connected;
  }

  get joinReady() {
    return this.session.joinReady;
  }

  get error() {
    return this.session.error?.value ?? null;
  }

  get transportReady() {
    return this.session.transportReady;
  }

  get iceConnectedBoth() {
    return this.session.iceConnectedBoth;
  }

  get mediaConnectionState() {
    return this.session.mediaConnectionState;
  }

  get connectionPhase() {
    return this.session.connectionPhase;
  }

  get lifecycle() {
    return this.session.lifecycle;
  }

  get protocolState() {
    return this.session.protocolState;
  }

  get protocolUpdateRequired() {
    return this.session.protocolUpdateRequired;
  }

  get playbackState() {
    return this.session.playbackState;
  }

  get microphoneDeviceState() {
    return this.session.microphoneDeviceState;
  }

  get isProducing() {
    return this.session.isProducing;
  }

  get producers() {
    return this.session.producers;
  }

  get consumers() {
    return this.session.consumers;
  }

  get localVideoFeeds() {
    return this.session.localVideoFeeds;
  }

  get remoteVideoFeeds() {
    return this.session.remoteVideoFeeds;
  }

  get remoteAudioFeeds() {
    return this.session.remoteAudioFeeds;
  }

  get sharedAudioStats() {
    return this.session.sharedAudioStats;
  }

  get echoDetected() {
    return this.session.echoDetected;
  }

  get sharedAudioAttenuation() {
    return this.session.sharedAudioAttenuation;
  }

  get sharedAudioDucking() {
    return this.session.sharedAudioDucking;
  }

  get peerRoundTripTimes() {
    return this.session.peerRoundTripTimes;
  }

  get peerConnectionMetrics() {
    return this.session.peerConnectionMetrics;
  }

  get sfuRoundTripTime() {
    return this.session.sfuRoundTripTime;
  }

  get participantSfuRoundTripTimes() {
    return this.session.participantSfuRoundTripTimes;
  }

  get remoteProducersCount() {
    return this.session.remoteProducersCount;
  }

  get lastInRoom() {
    return this.session.lastInRoom;
  }

  get topologyState() {
    return this.session.topologyState;
  }

  get topologyGraph() {
    return this.session.topologyGraph;
  }

  get activeProvider() {
    return this.session.activeProvider;
  }

  get lastSentClientRtpCapabilities() {
    return this.session.lastSentClientRtpCapabilities;
  }

  get lastReceivedConsumerParams() {
    return this.session.lastReceivedConsumerParams;
  }

  connect(channelId, options) {
    return this.session.connect(channelId, options);
  }

  disconnect() {
    return this.session.disconnect();
  }

  prepareAudioPlayback() {
    return this.session.prepareAudioPlayback();
  }

  restartAudioProduction() {
    return this.session.restartAudioProduction();
  }

  async startAudioProduction() {
    const result = await this.session.startAudioProduction();
    this.microphoneEnabled = true;
    return result;
  }

  async stopAudioProduction() {
    const result = await this.session.stopAudioProduction();
    this.microphoneEnabled = false;
    return result;
  }

  async startVideoProduction(source, options = {}) {
    const result = await this.session.startVideoProduction(source, options);
    if (source === "camera") this.cameraEnabled = true;
    if (source === "screen") this.screenSharing = true;
    return result;
  }

  async stopVideoProduction(source) {
    const result = await this.session.stopVideoProduction(source);
    if (source === "camera") this.cameraEnabled = false;
    if (source === "screen") this.screenSharing = false;
    return result;
  }

  startSystemAudioProduction(options = {}) {
    return this.session.startSystemAudioProduction(options);
  }

  stopSystemAudioProduction() {
    return this.session.stopSystemAudioProduction();
  }

  setRemoteScreenReceiving(...args) {
    return this.session.setRemoteScreenReceiving(...args);
  }

  setRemoteSystemAudioReceiving(...args) {
    return this.session.setRemoteSystemAudioReceiving(...args);
  }

  setSharedAudioVolume(...args) {
    return this.session.setSharedAudioVolume(...args);
  }

  setSystemAudioBitrate(...args) {
    return this.session.setSystemAudioBitrate(...args);
  }

  sendParticipantVoiceState(...args) {
    return this.session.sendParticipantVoiceState(...args);
  }

  applyOutputDeviceToAll(...args) {
    return this.session.applyOutputDeviceToAll(...args);
  }

  applyVolumeForUser(...args) {
    return this.session.applyVolumeForUser(...args);
  }

  applyVolumeForTrack(...args) {
    return this.session.applyVolumeForTrack(...args);
  }

  ensureAudioElements(...args) {
    return this.session.ensureAudioElements(...args);
  }

  getWebRTCStatsSnapshot(...args) {
    return this.session.getWebRTCStatsSnapshot(...args);
  }

  getOutboundRtpStats(...args) {
    return this.session.getOutboundRtpStats(...args);
  }

  getInboundRtpStats(...args) {
    return this.session.getInboundRtpStats(...args);
  }

  getWebRTCDiagnosticStats(...args) {
    return this.session.getWebRTCDiagnosticStats(...args);
  }

  areTransportsIceConnected(...args) {
    return this.session.areTransportsIceConnected(...args);
  }
}

export function createBrowserMediaEngine(session) {
  return new BrowserMediaEngine(session);
}

export default BrowserMediaEngine;
