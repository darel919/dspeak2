export interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export type RateLimitState = Map<string, RateLimitEntry>;

export interface RateLimitErrorData {
  retryAfter?: number;
}
