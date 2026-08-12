export interface TurnProbeResult {
  available: boolean;
  detail: string;
}

export interface TurnHealthResult extends TurnProbeResult {
  configured: boolean;
}

export interface TurnHealthOptions {
  now?: number;
  bypassCache?: boolean;
  timeoutMs?: number;
}
