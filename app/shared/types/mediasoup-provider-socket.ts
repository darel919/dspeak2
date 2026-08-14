import type { ParticipantMediaCapabilities } from "./video-codec-capabilities.ts";

export interface MediasoupProviderSocketOptions {
  onMessage: (type: string, payload: Record<string, unknown>) => unknown;
  onFailure: (error: unknown) => unknown;
}

export interface MediasoupProviderConnectOptions {
  signalingUrl: string;
  ticket: string;
  mediaCapabilities?: ParticipantMediaCapabilities | null;
  capabilityProtocol?: string;
}
