export function normalizeMediaOwnerSource<TSource, TOwnerSource>(
  source: TSource,
  ownerSource: TOwnerSource,
): "system-audio" | "screen" | null {
  if (source !== "screen-audio") return null;
  return ownerSource === "system-audio" ? "system-audio" : "screen";
}

export function isStandaloneSystemAudio(
  entry: { source?: unknown; ownerSource?: unknown } | null | undefined,
) {
  return (
    entry?.source === "screen-audio" &&
    normalizeMediaOwnerSource(entry.source, entry.ownerSource) ===
      "system-audio"
  );
}

export function isPairedScreenAudio(
  entry: { source?: unknown; ownerSource?: unknown } | null | undefined,
) {
  return (
    entry?.source === "screen-audio" &&
    normalizeMediaOwnerSource(entry.source, entry.ownerSource) === "screen"
  );
}
