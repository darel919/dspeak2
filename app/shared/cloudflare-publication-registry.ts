import type { CloudflarePublication } from "./types/cloudflare-media.ts";

export type PublicationReconciliation = {
  canonicalSnapshot: CloudflarePublication[];
  removed: CloudflarePublication[];
};

function logicalSlot(publication: CloudflarePublication): string | null {
  const peerId = String(publication?.peerId || "");
  const source = String(publication?.source || "");
  const variantId = publication?.variantId
    ? String(publication.variantId)
    : null;
  const logicalStreamId = publication?.logicalStreamId
    ? String(publication.logicalStreamId)
    : null;
  if (peerId && source) {
    if (variantId) return `${peerId}:${source}:${variantId}`;
    if (logicalStreamId) return `${peerId}:${source}:${logicalStreamId}`;
    return `${peerId}:${source}`;
  }
  return null;
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

function findSlotOccupant(
  publications: Map<string, CloudflarePublication>,
  publication: CloudflarePublication,
): CloudflarePublication | null {
  const trackName = String(publication?.trackName || "");
  const direct = trackName ? publications.get(trackName) : null;
  if (direct) return direct;
  const slot = logicalSlot(publication);
  if (!slot) return null;
  for (const current of publications.values()) {
    if (slot === logicalSlot(current)) return current;
  }
  return null;
}

export function createCloudflarePublicationRegistry() {
  const publications = new Map<string, CloudflarePublication>();
  let localMutationSequence = 0;

  function update(publication: CloudflarePublication): boolean {
    const trackName = String(publication?.trackName || "");
    if (!trackName) return false;
    const slot = logicalSlot(publication);
    if (publication.closed === true) {
      let removed = false;
      for (const [currentTrackName, current] of publications) {
        if (slot !== null && slot !== logicalSlot(current)) continue;
        if (trackName && currentTrackName !== trackName) continue;
        if (slot !== null && isStaleIncarnation(publication, current)) continue;
        publications.delete(currentTrackName);
        removed = true;
      }
      if (removed) {
        localMutationSequence += 1;
      }
      return removed;
    }
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
    localMutationSequence += 1;
    return true;
  }

  function reconcileExact(
    snapshot: CloudflarePublication[],
  ): PublicationReconciliation {
    const serverPublications = new Map<string, CloudflarePublication>();
    for (const pub of snapshot) {
      const trackName = String(pub?.trackName || "");
      if (!trackName) continue;
      serverPublications.set(trackName, pub);
    }

    const removed: CloudflarePublication[] = [];
    const anyServerSlots = new Set<string>();
    const acceptedServerSlots = new Set<string>();

    for (const [trackName, pub] of serverPublications) {
      const slot = logicalSlot(pub);
      if (slot) anyServerSlots.add(slot);
      const existingPublication = publications.get(trackName);
      if (pub.closed === true) {
        if (existingPublication) {
          const incomingEpoch = Number(pub.connectionEpoch || 0);
          const incomingGen = Number(pub.generation || 0);
          const currentEpoch = Number(existingPublication.connectionEpoch || 0);
          const currentGen = Number(existingPublication.generation || 0);
          if (
            incomingEpoch > currentEpoch ||
            (incomingEpoch === currentEpoch && incomingGen >= currentGen)
          ) {
            publications.delete(trackName);
            removed.push(pub);
            localMutationSequence += 1;
            if (slot) acceptedServerSlots.add(slot);
          }
        }
      } else {
        const occupant = findSlotOccupant(publications, pub);
        if (occupant && isStaleIncarnation(pub, occupant)) {
          continue;
        }
        publications.set(trackName, pub);
        localMutationSequence += 1;
        if (slot) acceptedServerSlots.add(slot);
      }
    }

    for (const [trackName, localPub] of publications) {
      if (serverPublications.has(trackName)) continue;
      const slot = logicalSlot(localPub);
      const slotCoveredByServer = slot !== null && anyServerSlots.has(slot);
      const slotReplacedByAcceptedEntry =
        slot !== null && acceptedServerSlots.has(slot);
      if (slotCoveredByServer && !slotReplacedByAcceptedEntry) continue;
      publications.delete(trackName);
      removed.push(localPub);
      localMutationSequence += 1;
    }

    return { canonicalSnapshot: [...publications.values()], removed };
  }

  return {
    clear: () => {
      publications.clear();
      localMutationSequence += 1;
    },
    update,
    values: () => [...publications.values()],
    reconcileExact,
    getLocalMutationSequence: () => localMutationSequence,
  };
}
