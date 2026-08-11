export function debugLog(...values) {
  if (import.meta.dev) console.debug(...values);
}
