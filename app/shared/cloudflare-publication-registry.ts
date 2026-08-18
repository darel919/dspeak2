import type { CloudflarePublication } from "./types/cloudflare-media.ts";

function logicalSlot(publication: CloudflarePublication): string | null {
  const peerId = String(publication?.peerId || "");
  const source = String(publication?.source || "");
  return peerId && source ? `${peerId}:${source}` : null;
}

function incarnationValue(publication: CloudflarePublication): number {
  const epoch = Number(publication?.connectionEpoch || 0);
  const generation = Number(publication?.generation || 0);
  // Lexicographic-style comparison: epoch dominates, generation breaks ties.
  return epoch * 1_000_000 + generation;
}

function isStaleIncarnation(
  incoming: CloudflarePublication,
  current: CloudflarePublication,
): boolean {
  const incomingEpoch = Number(incoming.connectionEpoch || 0);
  const incomingGen = Number(incoming.generation || 0);
  const currentEpoch = Number(current.connectionEpoch || 0);
  const currentGen = Number(current.generation || 0);
  if (incomingEpoch !== currentEpoch) return incomingEpoch < currentEpoch;
  return incomingGen < currentGen;
}

export function createCloudflarePublicationRegistry() {
  const publications = new Map<string, CloudflarePublication>();

  function update(publication: CloudflarePublication): boolean {
    const trackName = String(publication?.trackName || "");
    if (!trackName) return false;
    const slot = logicalSlot(publication);
    if (publication.closed === true) {
      // A close retires only the matching incarnation (same trackName) of a
      // logical slot, or the slot itself when no trackName is given. An older
      // close cannot retire a newer incarnation: a different trackName means
      // a different incarnation, so it is left alone.
      let removed = false;
      for (const [currentTrackName, current] of publications) {
        if (slot !== null && slot !== logicalSlot(current)) continue;
        if (trackName && currentTrackName !== trackName) continue;
        if (slot !== null && isStaleIncarnation(publication, current)) continue; // stale close: current incarnation is newer
        publications.delete(currentTrackName);
        removed = true;
      }
      return removed;
    }
    // A newer incarnation replaces the logical slot; an older one is ignored.
    let stale = false;
    for (const [currentTrackName, current] of publications) {
      if (currentTrackName !== trackName && slot !== logicalSlot(current))
        continue;
      if (isStaleIncarnation(publication, current)) {
        stale = true;
        break;
      }
      publications.delete(currentTrackName);
    }
    if (stale) return false;
    publications.set(trackName, publication);
    return true;
  }

  return {
    clear: () => publications.clear(),
    update,
    values: () => [...publications.values()],
  };
}
