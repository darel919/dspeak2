export function waitFor(map, key, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      map.delete(key);
      reject(new Error(`${label} timed out`));
    }, timeoutMs);
    map.set(key, {
      resolve(value) {
        clearTimeout(timer);
        map.delete(key);
        resolve(value);
      },
      reject(error) {
        clearTimeout(timer);
        map.delete(key);
        reject(error);
      },
    });
  });
}

export function asError(value, fallback) {
  if (value instanceof Error) return value;
  return new Error(value?.message || value || fallback);
}

export function nativeRemoteFeedKey(userId, source, consumerId) {
  const owner = userId == null ? consumerId : String(userId);
  return `remote:${owner}:${String(source || "audio")}`;
}

export function receiveEventMatches(entry, payload) {
  if (!entry || !payload || payload.consumerId !== entry.consumerId)
    return false;
  if (payload.producerId && payload.producerId !== entry.producerId)
    return false;
  if (payload.kind && payload.kind !== entry.kind) return false;
  return true;
}
