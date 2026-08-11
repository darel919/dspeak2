export const BROWSER_STORAGE_METRICS_EVENT = "dspeak:browser-storage-metrics";

export function boundedStorageMap(
  value: unknown,
  limit: number,
): Record<string, unknown> {
  const entries =
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.entries(value)
      : [];
  return Object.fromEntries(entries.slice(-Math.max(0, Number(limit) || 0)));
}

export function updateBoundedStorageMap(
  value: unknown,
  key: string,
  entry: unknown,
  limit: number,
): Record<string, unknown> {
  const next = boundedStorageMap(value, limit);
  delete next[String(key)];
  next[String(key)] = entry;
  return boundedStorageMap(next, limit);
}

export function browserStorageMetric(key: string, value: unknown) {
  const serialized = JSON.stringify(value);
  return {
    key,
    entries:
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.keys(value).length
        : null,
    bytes: new TextEncoder().encode(serialized).byteLength,
  };
}

export function reportBrowserStorageMetric(key: string, value: unknown): void {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined")
    return;
  window.dispatchEvent(
    new CustomEvent(BROWSER_STORAGE_METRICS_EVENT, {
      detail: browserStorageMetric(key, value),
    }),
  );
}
