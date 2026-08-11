export function normalizeMediaOwnerSource(source, ownerSource) {
  if (source !== "screen-audio") return null;
  return ownerSource === "system-audio" ? "system-audio" : "screen";
}

export function isStandaloneSystemAudio(entry) {
  return (
    entry?.source === "screen-audio" &&
    normalizeMediaOwnerSource(entry.source, entry.ownerSource) ===
      "system-audio"
  );
}

export function isPairedScreenAudio(entry) {
  return (
    entry?.source === "screen-audio" &&
    normalizeMediaOwnerSource(entry.source, entry.ownerSource) === "screen"
  );
}
