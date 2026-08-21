export interface StatsCacheOwner {}

type SharedStatsCache = {
  value?: unknown;
  sampledAt: number;
  pending?: Promise<unknown>;
};

const sharedStatsCaches = new WeakMap<StatsCacheOwner, SharedStatsCache>();

export function getSharedStatsSnapshot<T>(
  owner: StatsCacheOwner,
  load: () => Promise<T> | T,
  maxAgeMs = 1000,
): Promise<T> {
  const now = Date.now();
  const cache = sharedStatsCaches.get(owner) || { sampledAt: 0 };
  sharedStatsCaches.set(owner, cache);
  if (
    cache.value !== undefined &&
    now - cache.sampledAt <= Math.max(0, maxAgeMs)
  )
    /* SAFETY: The cache value was produced by the generic loader for this owner. */
    return Promise.resolve(cache.value as T);
  if (cache.pending) {
    /* SAFETY: The pending promise is the generic loader already registered for this owner. */
    return cache.pending as Promise<T>;
  }
  let pending: Promise<T>;
  pending = Promise.resolve()
    .then(load)
    .then((value) => {
      cache.value = value;
      cache.sampledAt = Date.now();
      return value;
    })
    .finally(() => {
      if (cache.pending === pending) cache.pending = undefined;
    });
  cache.pending = pending;
  return pending;
}

export function clearSharedStatsSnapshot(owner: StatsCacheOwner) {
  sharedStatsCaches.delete(owner);
}
