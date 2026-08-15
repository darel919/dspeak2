import type { PresentableVideoFrame } from "../video-codec-migration.ts";

export interface NativeAction {
  kind?: number;
  params?: Record<string, unknown> | string | null;
  state?: Record<string, unknown> | string | null;
  transportPtr?: number;
  actionId?: number;
}

export interface NativeReceiveEvent {
  kind?: number;
  id?: string;
  payload?: Record<string, unknown>;
  data?: string;
  dataBytes?: number;
  dataDropped?: boolean;
  eventId?: number | string;
}

export interface NativeConsumerEntry extends Record<string, unknown> {
  consumerId: string;
  producerId?: string;
  key: string;
  kind: string;
  closed?: boolean;
  receiving?: boolean;
  receivingRevision?: number;
  desiredReceiving?: boolean;
  track?: MediaStreamTrack | null;
  userId?: string | number | null;
  source: string;
  ownerSource?: string | null;
  logicalStreamId?: string;
  generation?: number;
  variantId?: string | null;
  codec?: string | null;
  codecAcceleration?: string | null;
  codecImplementation?: string | null;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  bitrate?: number | null;
  target?: {
    width?: number;
    height?: number;
    fps?: number;
    bitrate?: number;
  } | null;
  targetAdjusted?: boolean;
  preferredLayers?: {
    spatialLayer?: number;
    temporalLayer?: number;
  } | null;
  frame?: PresentableVideoFrame | null;
  migrationState?: string;
  presentableFrames?: number;
  lastFrameTimestamp?: number | null;
  lastFrameAt?: number | null;
  visible?: boolean;
  superseded?: boolean;
  transportEnded?: boolean;
  migrationStartedAt?: number | null;
  migrationTimer?: ReturnType<typeof setTimeout> | null;
}
