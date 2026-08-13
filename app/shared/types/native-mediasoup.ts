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
}
