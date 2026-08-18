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
        if (
          slot !== null &&
          incarnationValue(publication) < incarnationValue(current)
        )
          continue; // stale close: current incarnation is newer
        publications.delete(currentTrackName);
        removed = true;
      }
      return removed;
    }
    // A newer incarnation replaces the logical slot; an older one is ignored.
    let replaced = false;
    for (const [currentTrackName, current] of publications) {
      if (currentTrackName !== trackName && slot !== logicalSlot(current))
        continue;
      if (
        slot !== null &&
        incarnationValue(publication) < incarnationValue(current)
      )
        continue; // stale update: keep current incarnation
      publications.delete(currentTrackName);
      replaced = true;
    }
    publications.set(trackName, publication);
    return replaced || true;
  }

  return {
    clear: () => publications.clear(),
    update,
    values: () => [...publications.values()],
  };
}
