export function waitFor(
  map: Map<
    string,
    { resolve: (value?: unknown) => void; reject: (error: unknown) => void }
  >,
  key: string,
  timeoutMs: number,
  label: string,
) {
  return new Promise<unknown>((resolve, reject) => {
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

export function asError(value: unknown, fallback: string) {
  if (value instanceof Error) return value;
  const message =
    value && typeof value === "object" && "message" in value
      ? String(value.message)
      : String(value || fallback);
  return new Error(message);
}

export function nativeRemoteFeedKey(
  userId: string | number | null | undefined,
  source: string | null | undefined,
  consumerId: string,
) {
  const owner = userId == null ? consumerId : String(userId);
  return `remote:${owner}:${String(source || "audio")}`;
}

export function receiveEventMatches(
  entry:
    | { consumerId?: string; producerId?: string; kind?: string }
    | null
    | undefined,
  payload: { consumerId?: string; producerId?: string; kind?: string },
) {
  if (!entry || !payload || payload.consumerId !== entry.consumerId)
    return false;
  if (payload.producerId && payload.producerId !== entry.producerId)
    return false;
  if (payload.kind && payload.kind !== entry.kind) return false;
  return true;
}
