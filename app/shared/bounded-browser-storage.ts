export const BROWSER_STORAGE_METRICS_EVENT = "dspeak:browser-storage-metrics";

import { isExternalRecord } from "./types/boundary.ts";

export function boundedStorageMap<T>(
  value: T,
  limit: number,
): Record<string, unknown> {
  const entries = isExternalRecord(value) ? Object.entries(value) : [];
  return Object.fromEntries(entries.slice(-Math.max(0, Number(limit) || 0)));
}

export function updateBoundedStorageMap<T, U>(
  value: T,
  key: string,
  entry: U,
  limit: number,
): Record<string, unknown> {
  const next = boundedStorageMap(value, limit);
  delete next[String(key)];
  next[String(key)] = entry;
  return boundedStorageMap(next, limit);
}

export function browserStorageMetric<T>(key: string, value: T) {
  const serialized = JSON.stringify(value);
  return {
    key,
    entries: isExternalRecord(value) ? Object.keys(value).length : null,
    bytes: new TextEncoder().encode(serialized).byteLength,
  };
}

export function reportBrowserStorageMetric<T>(key: string, value: T): void {
  if (!import.meta.client) return;
  window.dispatchEvent(
    new CustomEvent(BROWSER_STORAGE_METRICS_EVENT, {
      detail: browserStorageMetric(key, value),
    }),
  );
}
