import type { CloudflarePublication } from "./types/cloudflare-media.ts";

function publicationIdentity(
  publication: CloudflarePublication,
): string | null {
  const peerId = String(publication?.peerId || "");
  const source = String(publication?.source || "");
  const connectionEpoch = publication?.connectionEpoch
    ? String(publication.connectionEpoch)
    : "";
  const generation = publication?.generation
    ? String(publication.generation)
    : "";
  return peerId && source
    ? `${peerId}:${source}:${connectionEpoch}:${generation}`
    : null;
}

export function createCloudflarePublicationRegistry() {
  const publications = new Map<string, CloudflarePublication>();

  function update(publication: CloudflarePublication): boolean {
    const trackName = String(publication?.trackName || "");
    if (!trackName) return false;
    if (publication.closed === true) {
      const identity = publicationIdentity(publication);
      for (const [currentTrackName, current] of publications) {
        if (
          currentTrackName === trackName ||
          (identity && publicationIdentity(current) === identity)
        )
          publications.delete(currentTrackName);
      }
      return true;
    }
    const identity = publicationIdentity(publication);
    // Generation/epoch fencing: discard stale publications
    for (const [currentTrackName, current] of publications) {
      if (
        currentTrackName === trackName ||
        (identity && publicationIdentity(current) === identity)
      ) {
        // If current publication is newer generation/epoch, ignore the update
        const currentGen = Number(current.generation || 0);
        const newGen = Number(publication.generation || 0);
        const currentEpoch = Number(current.connectionEpoch || 0);
        const newEpoch = Number(publication.connectionEpoch || 0);
        if (
          newGen < currentGen ||
          (newGen === currentGen && newEpoch < currentEpoch)
        ) {
          return false; // stale publication, ignore
        }
        publications.delete(currentTrackName);
      }
    }
    publications.set(trackName, publication);
    return true;
  }

  return {
    clear: () => publications.clear(),
    update,
    values: () => [...publications.values()],
  };
}
