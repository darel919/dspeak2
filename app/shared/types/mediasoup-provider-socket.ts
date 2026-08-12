export interface MediasoupProviderSocketOptions {
  onMessage: (type: string, payload: Record<string, unknown>) => unknown;
  onFailure: (error: unknown) => unknown;
}

export interface MediasoupProviderConnectOptions {
  signalingUrl: string;
  ticket: string;
}
