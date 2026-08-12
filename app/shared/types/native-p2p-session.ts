export interface NativeP2pSource extends Record<string, unknown> {
  source: string;
  kind?: "audio" | "video";
  track?: Record<string, unknown> | null;
  ownerSource?: string | null;
  captureSelection?: Record<string, unknown> | null;
  audioBitrate?: number | null;
  roomBitrateBps?: number | null;
  videoSettings?: import("./video-settings.ts").VideoSettings | null;
}

export interface NativeP2pTrackEntry extends Record<string, unknown> {
  key: string;
  id?: string;
  trackId: string;
  userId: string | number;
  source: string;
  ownerSource?: string | null;
  kind: "audio" | "video";
  receiving: boolean;
  closed: boolean;
  p2pHandle: string | number;
  frame?: Record<string, unknown> | null;
}

export interface NativeP2pSessionPeer extends Record<string, unknown> {
  peerId: string;
  userId: string;
  handle: string | number;
  sources: Set<string>;
  trackIds: Map<string, string>;
  connected: boolean;
  candidateTimer: ReturnType<typeof setTimeout> | null;
  sourceByTrackId: Map<string, string>;
  ownerSourceByTrackId: Map<string, string | null>;
  offerCreated: boolean;
  negotiationInFlight: boolean;
  negotiationRequested: boolean;
  remoteDescriptionSet: boolean;
  pendingCandidates: Array<Record<string, unknown>>;
  healthOpen: boolean;
  healthReceived: number;
  healthSequence: number;
  healthTimer: ReturnType<typeof setInterval> | null;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
  restartTimer: ReturnType<typeof setTimeout> | null;
  iceState: number;
  restarted: boolean;
  failureReported: boolean;
  readyReported: boolean;
  remoteSourceNames: Set<string>;
  sourceReceiving: Map<string, boolean>;
  remoteReceiving: Map<string, boolean>;
}

export interface NativeP2pSessionOptions {
  invoke: (
    operation: string,
    payload?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  sendSignal?: (data: Record<string, unknown>) => unknown;
  sendMessage?: (type: string, data: Record<string, unknown>) => unknown;
  onRemoteTrack?: (entry: Record<string, unknown>) => unknown;
  onRemoteTrackEnded?: (entry: Record<string, unknown>) => unknown;
  onStateChange?: (state: Record<string, unknown>) => unknown;
  onError?: (error: unknown) => unknown;
  getAudioBitrate?: (source: string) => number | null;
  getAudioStereo?: (source: string) => boolean | null;
  getVideoSettings?: (
    source: string,
  ) => import("./video-settings.ts").VideoSettings;
  disconnectGraceMs?: number;
  iceRestartTimeoutMs?: number;
}

export interface NativeP2pSessionSurface {
  invoke: NativeP2pSessionOptions["invoke"];
  sendSignal?: NativeP2pSessionOptions["sendSignal"];
  sendMessage?: NativeP2pSessionOptions["sendMessage"];
  onRemoteTrack?: NativeP2pSessionOptions["onRemoteTrack"];
  onRemoteTrackEnded?: NativeP2pSessionOptions["onRemoteTrackEnded"];
  onStateChange?: NativeP2pSessionOptions["onStateChange"];
  onError?: NativeP2pSessionOptions["onError"];
  getAudioBitrate?: NativeP2pSessionOptions["getAudioBitrate"];
  getAudioStereo?: NativeP2pSessionOptions["getAudioStereo"];
  getVideoSettings?: NativeP2pSessionOptions["getVideoSettings"];
  disconnectGraceMs: number;
  iceRestartTimeoutMs: number;
  peers: Map<string, NativeP2pSessionPeer>;
  sources: Map<string, NativeP2pSource>;
  sourceTransmission: Map<string, boolean>;
  remoteReceiving: Map<string, boolean>;
  trackEntries: Map<string, NativeP2pTrackEntry>;
  retiredTrackEntries: Map<string, NativeP2pTrackEntry>;
  jitterBufferMinimumDelay: number;
  jitterBufferTargetDelay: number;
  mode: string;
  epoch: number;
  localPeerId: string;
  closed: boolean;
  operation: Promise<unknown>;
  pendingSignals: Map<number, Array<Record<string, unknown>>>;
  pendingSignalLimit: number;
  _enqueue: (operation: () => Promise<unknown>) => Promise<unknown>;
  closeAll: () => Promise<unknown>;
  shutdown: () => Promise<unknown>;
  addSourceInternal: (entry: NativeP2pSource) => Promise<unknown>;
  removeSourceInternal: (source: string) => Promise<unknown>;
  handleSignalInternal: (data: Record<string, unknown>) => Promise<unknown>;
  queuePendingSignal: (data: Record<string, unknown>) => boolean;
  _flushPendingSignals: () => Promise<unknown>;
  _ensurePeer: (
    peerId: string,
    userId: string | number | null,
    sources?: string[],
  ) => Promise<NativeP2pSessionPeer>;
  _applyJitterBufferConfig: (entry: NativeP2pTrackEntry) => unknown;
  _updateSourceParameters: (
    source: string,
    parameters: Record<string, unknown>,
  ) => Promise<unknown>;
  setRemoteReceiving: (
    userIdOrKey: string,
    sourceOrReceiving: string | boolean,
    receivingValue?: boolean,
  ) => Promise<boolean>;
  applyTopology: (topology: Record<string, unknown>) => Promise<unknown>;
  addSource: (entry: NativeP2pSource) => Promise<unknown>;
  removeSource: (source: string) => Promise<unknown>;
  handleSignal: (data: Record<string, unknown>) => Promise<unknown>;
  handleReceiveEvent: (event: Record<string, unknown>) => boolean;
  setSourceTransmission: (source: string, enabled: boolean) => Promise<unknown>;
  updateAudioBitrate: (source: string, bitrate: number) => Promise<unknown>;
  updateVideoBitrate: (source: string, bitrate: number) => Promise<unknown>;
  setConsumerVolume: (
    userId: string | number,
    source: string | null,
    volume: number,
  ) => Promise<unknown>;
  stats: () => Promise<unknown[]>;
  diagnosticStats: () => Promise<unknown[]>;
  getOutboundRtpStats: () => Promise<unknown[]>;
  getInboundRtpStats: () => Promise<unknown[]>;
  mediaReadiness: (
    expectedInbound?: number,
  ) => Promise<Record<string, unknown>>;
  iceConnectedBoth: boolean;
  setJitterBufferConfig: (config?: {
    minDelayMs?: number;
    targetDelayMs?: number;
  }) => unknown;
  _closePeer: (peerId: string) => Promise<unknown>;
  _attachSource: (
    peer: NativeP2pSessionPeer,
    source: NativeP2pSource,
  ) => Promise<unknown>;
  _detachSource: (
    peer: NativeP2pSessionPeer,
    source: string,
  ) => Promise<unknown>;
  _replaceSource: (
    peer: NativeP2pSessionPeer,
    source: NativeP2pSource,
  ) => Promise<unknown>;
  _syncAudioProfile: (peer: NativeP2pSessionPeer) => unknown;
  _setSourceParameters: (
    peer: NativeP2pSessionPeer,
    source: string,
    parameters: Record<string, unknown>,
  ) => Promise<unknown>;
  _sourceParameters: (
    source: NativeP2pSource,
    overrides?: Record<string, unknown>,
  ) => Record<string, unknown>;
  _sendSignal: (
    targetPeerId: string,
    signal: Record<string, unknown>,
  ) => unknown;
  _checkPeerQualification: (peer: NativeP2pSessionPeer) => unknown;
  _handleP2pEvent: (
    peer: NativeP2pSessionPeer | undefined,
    event: Record<string, unknown>,
    payload: Record<string, unknown>,
  ) => unknown;
  _addCandidate: (
    peer: NativeP2pSessionPeer,
    candidate: Record<string, unknown>,
  ) => Promise<unknown>;
  _flushCandidates: (peer: NativeP2pSessionPeer) => Promise<unknown>;
  _createOffer: (peer: NativeP2pSessionPeer) => Promise<unknown>;
  _requestOffer: (peer: NativeP2pSessionPeer) => unknown;
  _startCandidatePump: (peer: NativeP2pSessionPeer) => unknown;
  _handleIceState: (peer: NativeP2pSessionPeer, state: number) => unknown;
  _restartIce: (peer: NativeP2pSessionPeer) => Promise<unknown>;
  _failPeer: (
    peer: NativeP2pSessionPeer,
    reason: string,
    cause?: unknown,
  ) => unknown;
  _startHealthPump: (peer: NativeP2pSessionPeer) => unknown;
  _stopHealthPump: (peer: NativeP2pSessionPeer) => unknown;
  _hasExpectedMedia: (peer: NativeP2pSessionPeer) => boolean;
  _emitState: () => unknown;
}
