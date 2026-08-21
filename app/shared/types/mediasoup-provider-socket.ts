import type { OwnedErrorValue } from "./shared-utilities.ts";

import type { MediaCommandResult } from "./boundary.ts";

import type { ParticipantMediaCapabilities } from "./video-codec-capabilities.ts";

export interface MediasoupProviderSocketOptions {
  onMessage: (
    type: string,
    payload: Record<string, unknown>,
  ) => MediaCommandResult;
  onFailure: (error: OwnedErrorValue) => MediaCommandResult;
}

export interface MediasoupProviderConnectOptions {
  signalingUrl: string;
  ticket: string;
  mediaCapabilities?: ParticipantMediaCapabilities | null;
  capabilityProtocol?: string;
}
