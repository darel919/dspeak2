const stateKey = Symbol.for("dspeak.rate-limit");
const maximumEntries = 10_000;
const pruneIntervalMs = 30_000;
let nextPruneAt = 0;

function getState() {
  if (!globalThis[stateKey]) globalThis[stateKey] = new Map();
  return globalThis[stateKey];
}

function prune(state, now) {
  for (const [key, value] of state) {
    if (value.resetAt <= now) state.delete(key);
  }
  if (state.size <= maximumEntries) return;
  const overflow = state.size - maximumEntries;
  for (const key of [...state.keys()].slice(0, overflow)) state.delete(key);
}

export function resolveClientIp(event) {
  const trustProxy = process.env.DSPEAK_TRUST_PROXY === "true";
  return getRequestIP(event, { xForwardedFor: trustProxy }) || "unknown";
}

export function resolveWebSocketClientIp(request) {
  if (process.env.DSPEAK_TRUST_PROXY !== "true") return "untrusted-proxy";
  const forwarded =
    request.headers?.get?.("x-forwarded-for") ||
    request.headers?.["x-forwarded-for"] ||
    "";
  return String(forwarded).split(",")[0].trim() || "unknown";
}

export function enforceRateLimit(event, scope, identity, limit, windowMs) {
  try {
    const resetSeconds = enforceIdentifierRateLimit(
      scope,
      identity || resolveClientIp(event),
      limit,
      windowMs,
    );
    setHeader(event, "RateLimit-Reset", String(resetSeconds));
  } catch (error) {
    if ((error as any)?.data?.retryAfter)
      setHeader(event, "Retry-After", Number((error as any).data.retryAfter));
    throw error;
  }
}

export function enforceIdentifierRateLimit(scope, identity, limit, windowMs) {
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
