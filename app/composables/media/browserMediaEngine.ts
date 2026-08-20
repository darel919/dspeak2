import { unref } from "vue";
import { MediaEngine } from "../../shared/media/contracts.ts";
import {
  createMediaQoeReport,
  mediaQoePathsFromStats,
} from "../../shared/media-qoe.ts";
import type {
  BrowserMediaEngineOptions,
  BrowserMediaEngineSession,
  BrowserJoinInput,
  BrowserScreenShareOptions,
  BrowserSignalMessage,
  MediaQoeReport,
} from "../../shared/types/media-engine-adapters.ts";
import type {
  MediaDeviceInfo,
  MediaEngineState,
  MediaEngineConfig,
  MediaStats,
} from "../../shared/media/types.ts";
import { probeBrowserVideoCodecCapabilities } from "../../shared/browser-video-codec-capabilities.ts";
import type { ParticipantMediaCapabilities } from "../../shared/types/video-codec-capabilities.ts";

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
  session: BrowserMediaEngineSession;
  listeners: Map<string, Set<(...args: unknown[]) => void>>;
  initialized: boolean;
  microphoneEnabled: boolean;
  cameraEnabled: boolean;
  screenSharing: boolean;
  onQoe?: (report: MediaQoeReport) => void;
  qoeTimer: ReturnType<typeof setInterval> | null;
  mediaCapabilities: ParticipantMediaCapabilities | null;

  constructor(
    session: BrowserMediaEngineSession,
    { onQoe }: BrowserMediaEngineOptions = {},
  ) {
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
    this.mediaCapabilities = null;
  }

  override async initialize(_config?: MediaEngineConfig): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    try {
      this.mediaCapabilities = await probeBrowserVideoCodecCapabilities();
    } catch {
      this.mediaCapabilities = null;
    }
    await this.session.setMediaCapabilities?.(this.mediaCapabilities);
    this.qoeTimer = setInterval(() => {
      this.getStats().catch(() => {});
    }, 5000);
    this.qoeTimer?.unref?.();
  }

  override async joinSession(input: BrowserJoinInput): Promise<void> {
    await this.initialize();
    const channelId = input.channelId || "";
    await this.session.connect(
      channelId,
      input.roomId ? { roomId: input.roomId } : undefined,
    );
  }

  override async leaveSession(): Promise<void> {
    if (this.qoeTimer) clearInterval(this.qoeTimer);
    this.qoeTimer = null;
    await this.session.disconnect();
    this.microphoneEnabled = false;
    this.cameraEnabled = false;
    this.screenSharing = false;
  }

  override async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    if (enabled) await this.session.startAudioProduction();
    else await this.session.stopAudioProduction();
    this.microphoneEnabled = enabled;
  }

  override async setCameraEnabled(enabled: boolean): Promise<void> {
    if (enabled) await this.session.startVideoProduction("camera");
    else await this.session.stopVideoProduction("camera");
    this.cameraEnabled = enabled;
  }

  override async startScreenShare(
    options: BrowserScreenShareOptions = {},
  ): Promise<void> {
    await this.session.startVideoProduction("screen", options);
    this.screenSharing = true;
  }

  override async stopScreenShare(): Promise<void> {
    await this.session.stopVideoProduction("screen");
    this.screenSharing = false;
  }

  override async handleSignal(message: BrowserSignalMessage): Promise<void> {
    if (typeof this.session.handleSignal === "function") {
      return this.session.handleSignal(message);
    }
  }

  override async getDevices(): Promise<MediaDeviceInfo[]> {
    if (!globalThis.navigator?.mediaDevices?.enumerateDevices) return [];
    const devices = await globalThis.navigator.mediaDevices.enumerateDevices();
    return devices.map(({ deviceId, groupId, kind, label }) => ({
      deviceId,
      groupId,
      kind,
      label,
    }));
  }

  override async getStats(): Promise<MediaStats> {
    const snapshot =
      (await this.session.getWebRTCStatsSnapshot()) as MediaStats & {
        timestamp?: number;
      };
    const report = createMediaQoeReport({
      provider: unref(this.session.activeProvider) || "sfu",
      epoch:
        (unref(this.session.topologyState) as { epoch?: number } | undefined)
          ?.epoch || 0,
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

  override on(
    event: string,
    callback: (...args: unknown[]) => void,
  ): () => void {
    const callbacks =
      this.listeners.get(event) || new Set<(...args: unknown[]) => void>();
    callbacks.add(callback);
    this.listeners.set(event, callbacks);
    return () => {
      callbacks.delete(callback);
      if (callbacks.size === 0) this.listeners.delete(event);
    };
  }

  override getCapabilities() {
    return BROWSER_CAPABILITIES;
  }

  override async shutdown(): Promise<void> {
    await this.leaveSession();
    this.listeners.clear();
    this.initialized = false;
    this.mediaCapabilities = null;
    await this.session.setMediaCapabilities?.(null);
    if (this.qoeTimer) clearInterval(this.qoeTimer);
    this.qoeTimer = null;
  }

  override getState(): MediaEngineState {
    return (unref(this.session.mediaConnectionState) ||
      "disconnected") as MediaEngineState;
  }

  override isScreenSharing(): boolean {
    return this.screenSharing;
  }

  override isMicrophoneEnabled(): boolean {
    return this.microphoneEnabled;
  }

  override isCameraEnabled(): boolean {
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

  connect(
    channelId: string,
    options?: { roomId?: string },
  ): ReturnType<BrowserMediaEngineSession["connect"]>;
  connect(channelId: string, options?: { roomId?: string }) {
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

  async startAudioProduction(): Promise<unknown> {
    const result = await this.session.startAudioProduction();
    this.microphoneEnabled = true;
    return result;
  }

  async stopAudioProduction(): Promise<unknown> {
    const result = await this.session.stopAudioProduction();
    this.microphoneEnabled = false;
    return result;
  }

  async startVideoProduction(
    source: "camera" | "screen",
    options: BrowserScreenShareOptions = {},
  ): Promise<unknown> {
    const result = await this.session.startVideoProduction(source, options);
    if (source === "camera") this.cameraEnabled = true;
    if (source === "screen") this.screenSharing = true;
    return result;
  }

  async stopVideoProduction(source: "camera" | "screen"): Promise<unknown> {
    const result = await this.session.stopVideoProduction(source);
    if (source === "camera") this.cameraEnabled = false;
    if (source === "screen") this.screenSharing = false;
    return result;
  }

  startSystemAudioProduction(options: BrowserScreenShareOptions = {}) {
    return this.session.startSystemAudioProduction(options);
  }

  stopSystemAudioProduction() {
    return this.session.stopSystemAudioProduction();
  }

  setRemoteScreenReceiving(
    ...args: Parameters<BrowserMediaEngineSession["setRemoteScreenReceiving"]>
  ) {
    return this.session.setRemoteScreenReceiving(...args);
  }

  setRemoteSystemAudioReceiving(
    ...args: Parameters<
      BrowserMediaEngineSession["setRemoteSystemAudioReceiving"]
    >
  ) {
    return this.session.setRemoteSystemAudioReceiving(...args);
  }

  setSharedAudioVolume(
    ...args: Parameters<BrowserMediaEngineSession["setSharedAudioVolume"]>
  ) {
    return this.session.setSharedAudioVolume(...args);
  }

  setSharedAudioAttenuation(
    ...args: Parameters<BrowserMediaEngineSession["setSharedAudioAttenuation"]>
  ) {
    return this.session.setSharedAudioAttenuation(...args);
  }

  setSystemAudioBitrate(
    ...args: Parameters<BrowserMediaEngineSession["setSystemAudioBitrate"]>
  ) {
    return this.session.setSystemAudioBitrate(...args);
  }

  sendParticipantVoiceState(
    ...args: Parameters<BrowserMediaEngineSession["sendParticipantVoiceState"]>
  ) {
    return this.session.sendParticipantVoiceState(...args);
  }

  applyOutputDeviceToAll(
    ...args: Parameters<BrowserMediaEngineSession["applyOutputDeviceToAll"]>
  ) {
    return this.session.applyOutputDeviceToAll(...args);
  }

  applyVolumeForUser(
    ...args: Parameters<BrowserMediaEngineSession["applyVolumeForUser"]>
  ) {
    return this.session.applyVolumeForUser(...args);
  }

  applyVolumeForTrack(
    ...args: Parameters<BrowserMediaEngineSession["applyVolumeForTrack"]>
  ) {
    return this.session.applyVolumeForTrack(...args);
  }

  ensureAudioElements(
    ...args: Parameters<BrowserMediaEngineSession["ensureAudioElements"]>
  ) {
    return this.session.ensureAudioElements(...args);
  }

  getWebRTCStatsSnapshot(
    ...args: Parameters<BrowserMediaEngineSession["getWebRTCStatsSnapshot"]>
  ) {
    return this.session.getWebRTCStatsSnapshot(...args);
  }

  getOutboundRtpStats(
    ...args: Parameters<BrowserMediaEngineSession["getOutboundRtpStats"]>
  ) {
    return this.session.getOutboundRtpStats(...args);
  }

  getInboundRtpStats(
    ...args: Parameters<BrowserMediaEngineSession["getInboundRtpStats"]>
  ) {
    return this.session.getInboundRtpStats(...args);
  }

  getWebRTCDiagnosticStats(
    ...args: Parameters<BrowserMediaEngineSession["getWebRTCDiagnosticStats"]>
  ) {
    return this.session.getWebRTCDiagnosticStats(...args);
  }

  areTransportsIceConnected(
    ...args: Parameters<BrowserMediaEngineSession["areTransportsIceConnected"]>
  ) {
    return this.session.areTransportsIceConnected(...args);
  }
}

export function createBrowserMediaEngine(session: BrowserMediaEngineSession) {
  return new BrowserMediaEngine(session);
}

export default BrowserMediaEngine;
