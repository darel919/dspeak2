export function debugLog(...values: unknown[]) {
  if (import.meta.dev) console.debug(...values);
}
