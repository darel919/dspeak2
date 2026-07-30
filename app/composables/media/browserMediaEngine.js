import { unref } from "vue";
import { MediaEngine } from "../../shared/media/contracts.js";

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
  constructor(session) {
    super();
    if (!session)
      throw new TypeError("BrowserMediaEngine requires a media session");
    this.session = session;
    this.listeners = new Map();
    this.initialized = false;
    this.microphoneEnabled = false;
    this.cameraEnabled = false;
    this.screenSharing = false;
  }

  async initialize() {
    this.initialized = true;
  }

  async joinSession(input) {
    await this.initialize();
    await this.session.connect(input.channelId || input);
  }

  async leaveSession() {
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
    if (options.includeSystemAudio) {
      await this.session.startSystemAudioProduction();
    }
    await this.session.startVideoProduction("screen");
    this.screenSharing = true;
  }

  async stopScreenShare() {
    await this.session.stopVideoProduction("screen");
    await this.session.stopSystemAudioProduction();
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
    return this.session.error;
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

  connect(channelId) {
    return this.session.connect(channelId);
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

  startAudioProduction() {
    this.microphoneEnabled = true;
    return this.session.startAudioProduction();
  }

  stopAudioProduction() {
    this.microphoneEnabled = false;
    return this.session.stopAudioProduction();
  }

  startVideoProduction(source) {
    if (source === "camera") this.cameraEnabled = true;
    if (source === "screen") this.screenSharing = true;
    return this.session.startVideoProduction(source);
  }

  stopVideoProduction(source) {
    if (source === "camera") this.cameraEnabled = false;
    if (source === "screen") this.screenSharing = false;
    return this.session.stopVideoProduction(source);
  }

  startSystemAudioProduction() {
    return this.session.startSystemAudioProduction();
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
