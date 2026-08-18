import type { CloudflarePublication } from "./types/cloudflare-media.ts";

function logicalSlot(publication: CloudflarePublication): string | null {
  const peerId = String(publication?.peerId || "");
  const source = String(publication?.source || "");
  const variantId = publication?.variantId
    ? String(publication.variantId)
    : null;
  const logicalStreamId = publication?.logicalStreamId
    ? String(publication.logicalStreamId)
    : null;
  // Variant-aware slot: peerId:source:variantId OR peerId:source:logicalStreamId
  // This allows multiple codec variants of the same source to coexist
  if (peerId && source) {
    if (variantId) return `${peerId}:${source}:${variantId}`;
    if (logicalStreamId) return `${peerId}:${source}:${logicalStreamId}`;
    return `${peerId}:${source}`;
  }
  return null;
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
  let publicationRevision = "0";

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
      if (removed) {
        publicationRevision = String(BigInt(publicationRevision) + 1n);
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
    publicationRevision = String(BigInt(publicationRevision) + 1n);
    return true;
  }

  function reconcileExact(
    snapshot: CloudflarePublication[],
    snapshotRevision?: string,
  ): {
    acceptedSnapshot: CloudflarePublication[];
    removed: CloudflarePublication[];
    newRevision: string;
  } {
    // Build server snapshot map by trackName
    const serverPublications = new Map<string, CloudflarePublication>();
    for (const pub of snapshot) {
      const trackName = String(pub?.trackName || "");
      if (!trackName) continue;
      serverPublications.set(trackName, pub);
    }

    const acceptedSnapshot: CloudflarePublication[] = [];
    const removed: CloudflarePublication[] = [];

    // 1. Process additions/repairs from server snapshot
    for (const [trackName, pub] of serverPublications) {
      const existingPublication = publications.get(trackName);

      if (pub.closed === true) {
        // Server explicitly closed this publication - process if not stale
        if (existingPublication) {
          const incomingEpoch = Number(pub.connectionEpoch || 0);
          const incomingGen = Number(pub.generation || 0);
          const currentEpoch = Number(existingPublication.connectionEpoch || 0);
          const currentGen = Number(existingPublication.generation || 0);
          // Only process if incoming is not stale
          if (
            incomingEpoch > currentEpoch ||
            (incomingEpoch === currentEpoch && incomingGen >= currentGen)
          ) {
            publications.delete(trackName);
            removed.push(pub);
            publicationRevision = String(BigInt(publicationRevision) + 1n);
          }
        }
      } else {
        // Addition/repair - update with authoritative server state
        // Check incarnation to prevent delayed heartbeat from downgrading newer publications
        const existingPublication = publications.get(trackName);
        if (existingPublication) {
          const incomingEpoch = Number(pub.connectionEpoch || 0);
          const incomingGen = Number(pub.generation || 0);
          const currentEpoch = Number(existingPublication.connectionEpoch || 0);
          const currentGen = Number(existingPublication.generation || 0);
          if (
            incomingEpoch < currentEpoch ||
            (incomingEpoch === currentEpoch && incomingGen < currentGen)
          ) {
            // Stale publication from delayed heartbeat - ignore
            continue;
          }
        }
        publications.set(trackName, pub);
        acceptedSnapshot.push(pub);
        publicationRevision = String(BigInt(publicationRevision) + 1n);
      }
    }

    // 2. Detect local publications MISSING from server snapshot (ghost tracks)
    // These must be retired locally even without explicit closed=true from server
    for (const [trackName, localPub] of publications) {
      if (!serverPublications.has(trackName)) {
        // Local publication not in server snapshot - retire it
        publications.delete(trackName);
        removed.push(localPub);
        publicationRevision = String(BigInt(publicationRevision) + 1n);
      }
    }

    // Use snapshot revision if provided and newer, otherwise use local
    let newRevision = publicationRevision;
    if (snapshotRevision) {
      const snapRev = BigInt(snapshotRevision);
      const localRev = BigInt(publicationRevision);
      if (snapRev > localRev) {
        newRevision = snapshotRevision;
      }
    }

    return { acceptedSnapshot, removed, newRevision };
  }

  return {
    clear: () => {
      publications.clear();
      publicationRevision = String(BigInt(publicationRevision) + 1n);
    },
    update,
    values: () => [...publications.values()],
    reconcileExact,
    getPublicationRevision: () => publicationRevision,
  };
}
