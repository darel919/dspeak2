export type PendingSignalEntry = {
  payload: Record<string, unknown>;
  enqueuedAt: number;
};

export type PendingSignalQueueSample = {
  epochs: number;
  queued: number;
  oldestQueuedAgeMs: number | null;
};

export const PENDING_SIGNAL_MAX_AGE_MS = 10_000;
export const PENDING_SIGNAL_LIMIT = 256;

export function enqueuePendingSignal(
  pendingSignals: Map<number, PendingSignalEntry[]>,
  epoch: number,
  payload: Record<string, unknown>,
  limit: number,
  now: number,
): number {
  const pending = pendingSignals.get(epoch) || [];
  let droppedCount = 0;
  while (pending.length >= Math.max(1, limit)) {
    pending.shift();
    droppedCount += 1;
  }
  pending.push({ payload, enqueuedAt: now });
  pendingSignals.set(epoch, pending);
  return droppedCount;
}

export function expirePendingSignals(
  pendingSignals: Map<number, PendingSignalEntry[]>,
  maxAgeMs: number,
  now: number,
): number {
  let expiredCount = 0;
  for (const [epoch, pending] of pendingSignals) {
    const fresh = pending.filter((entry) => {
      const stale = now - entry.enqueuedAt > maxAgeMs;
      if (stale) expiredCount += 1;
      return !stale;
    });
    if (fresh.length) pendingSignals.set(epoch, fresh);
    else pendingSignals.delete(epoch);
  }
  return expiredCount;
}

export function takePendingSignals(
  pendingSignals: Map<number, PendingSignalEntry[]>,
  epoch: number,
): PendingSignalEntry[] {
  const pending = pendingSignals.get(epoch) || [];
  pendingSignals.delete(epoch);
  return pending;
}

export function samplePendingSignalQueue(
  pendingSignals: Map<number, PendingSignalEntry[]>,
  now: number,
): PendingSignalQueueSample {
  let queued = 0;
  let oldestEnqueuedAt: number | null = null;
  for (const pending of pendingSignals.values())
    for (const entry of pending) {
      queued += 1;
      if (oldestEnqueuedAt == null || entry.enqueuedAt < oldestEnqueuedAt)
        oldestEnqueuedAt = entry.enqueuedAt;
    }
  return {
    epochs: pendingSignals.size,
    queued,
    oldestQueuedAgeMs:
      oldestEnqueuedAt == null ? null : Math.max(0, now - oldestEnqueuedAt),
  };
}
