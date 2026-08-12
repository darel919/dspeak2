const stateKey = Symbol.for("dspeak.rate-limit");
import type { H3Event } from "h3";
import type {
  RateLimitEntry,
  RateLimitErrorData,
  RateLimitState,
} from "../types/rate-limit.ts";
const maximumEntries = 10_000;
const pruneIntervalMs = 30_000;
let nextPruneAt = 0;

function getState(): RateLimitState {
  const globalState = globalThis as typeof globalThis & {
    [key: symbol]: RateLimitState;
  };
  if (!globalState[stateKey])
    globalState[stateKey] = new Map<string, RateLimitEntry>();
  return globalState[stateKey];
}

function prune(state: RateLimitState, now: number): void {
  for (const [key, value] of state) {
    if (value.resetAt <= now) state.delete(key);
  }
  if (state.size <= maximumEntries) return;
  const overflow = state.size - maximumEntries;
  for (const key of [...state.keys()].slice(0, overflow)) state.delete(key);
}

export function resolveClientIp(event: H3Event): string {
  const trustProxy = process.env.DSPEAK_TRUST_PROXY === "true";
  return getRequestIP(event, { xForwardedFor: trustProxy }) || "unknown";
}

export function resolveWebSocketClientIp(request: {
  headers?: Headers | Record<string, string | string[] | undefined>;
}): string {
  if (process.env.DSPEAK_TRUST_PROXY !== "true") return "untrusted-proxy";
  const headers = request.headers;
  const forwarded =
    headers instanceof Headers
      ? headers.get("x-forwarded-for")
      : headers?.["x-forwarded-for"];
  return (
    String(forwarded ?? "")
      .split(",")[0]
      ?.trim() || "unknown"
  );
}

export function enforceRateLimit(
  event: H3Event,
  scope: string,
  identity: string | null | undefined,
  limit: number,
  windowMs: number,
): void {
  try {
    const resetSeconds = enforceIdentifierRateLimit(
      scope,
      identity || resolveClientIp(event),
      limit,
      windowMs,
    );
    setHeader(event, "RateLimit-Reset", String(resetSeconds));
  } catch (error: unknown) {
    const data =
      error && typeof error === "object" && "data" in error
        ? (error.data as RateLimitErrorData | undefined)
        : undefined;
    if (data?.retryAfter)
      setHeader(event, "Retry-After", Number(data.retryAfter));
    throw error;
  }
}

export function enforceIdentifierRateLimit(
  scope: string,
  identity: string,
  limit: number,
  windowMs: number,
): number {
  const state = getState();
  const now = Date.now();
  if (now >= nextPruneAt || state.size > maximumEntries) {
    prune(state, now);
    nextPruneAt = now + pruneIntervalMs;
  }
  const key = `${scope}:${identity}`;
  let entry = state.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    state.set(key, entry);
  }
  entry.count += 1;
  const resetSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
  if (entry.count <= limit) return resetSeconds;
  throw createError({
    statusCode: 429,
    statusMessage: "Too many requests",
    data: { retryAfter: resetSeconds },
  });
}
