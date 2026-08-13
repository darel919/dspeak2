export interface NativeCloudflareMessage extends Record<string, unknown> {
  requestId?: string;
  error?: string;
  result?: unknown;
  trackName?: string;
  closed?: boolean;
  sessionId?: string;
  source?: string;
  ownerSource?: string | null;
  userId?: string | number | null;
  peerId?: string | number | null;
  kind?: string;
  mid?: string | number | null;
  trackId?: string;
  payload?: Record<string, unknown>;
}

export interface NativeCloudflarePublication extends NativeCloudflareMessage {
  trackName: string;
}

export interface NativeCloudflareSourceEntry extends NativeCloudflareMessage {
  source: string;
  track?: MediaStreamTrack | Record<string, unknown> | null;
  audioBitrate?: number | null;
  audioStereo?: boolean | null;
  videoSettings?: import("./video-settings.ts").VideoSettings | null;
  captureSelection?: Record<string, unknown> | null;
}

export interface NativeCloudflareTopology {
  localPeerId?: string | number | null;
  peers?: Array<{
    userId?: string | number | null;
    peerId?: string | number | null;
    sources?: unknown;
  }>;
}

export interface NativeCloudflareEvent {
  kind?: number;
  id?: string;
  eventId?: number | string;
  payload?: Record<string, unknown>;
  data?: string;
}

export interface NativeCloudflareNegotiationResponse extends NativeCloudflareMessage {
  sessionDescription?: { type?: string; sdp?: string };
  tracks?: Array<{ trackName?: string; mid?: string | number | null }>;
}
