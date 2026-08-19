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

// Compare an incoming publication against the current occupant of its
// logical slot (peerId:source), not merely against the same trackName.
// A physical trackName change between incarnations must still fence stale
// heartbeats: an older incarnation arriving late cannot displace the newer
// incarnation that already occupies the slot.
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
  // Local counter of registry mutations. This is NOT the server's
  // publicationRevision domain: it only orders client-side edits and is
  // never used as an authoritative fence.
  let localMutationSequence = 0;

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
        localMutationSequence += 1;
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
    localMutationSequence += 1;
    return true;
  }

  function reconcileExact(snapshot: CloudflarePublication[]): {
    canonicalSnapshot: CloudflarePublication[];
    removed: CloudflarePublication[];
  } {
    // Build server snapshot map by trackName
    const serverPublications = new Map<string, CloudflarePublication>();
    for (const pub of snapshot) {
      const trackName = String(pub?.trackName || "");
      if (!trackName) continue;
      serverPublications.set(trackName, pub);
    }

    const removed: CloudflarePublication[] = [];
    // Logical slots the server snapshot mentions, and those where a server
    // entry was actually accepted (not rejected as stale).
    const anyServerSlots = new Set<string>();
    const acceptedServerSlots = new Set<string>();

    // 1. Process additions/repairs from server snapshot
    for (const [trackName, pub] of serverPublications) {
      const slot = logicalSlot(pub);
      if (slot) anyServerSlots.add(slot);
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
            localMutationSequence += 1;
            if (slot) acceptedServerSlots.add(slot);
          }
        }
      } else {
        // Addition/repair - update with authoritative server state.
        // Fence by logical slot: a delayed heartbeat carrying an older
        // incarnation must not displace the newer occupant even when the
        // physical trackName changed between incarnations.
        const occupant = findSlotOccupant(publications, pub);
        if (occupant && isStaleIncarnation(pub, occupant)) {
          continue;
        }
        publications.set(trackName, pub);
        localMutationSequence += 1;
        if (slot) acceptedServerSlots.add(slot);
      }
    }

    // 2. Detect local publications MISSING from server snapshot (ghost tracks)
    // These must be retired locally even without explicit closed=true from
    // server, EXCEPT when the server snapshot still covers the logical slot
    // but only with stale entries. In that case the retained local
    // publication is the newest incarnation of a slot the server still
    // knows about - a delayed heartbeat, not a ghost.
    for (const [trackName, localPub] of publications) {
      if (serverPublications.has(trackName)) continue;
      const slot = logicalSlot(localPub);
      const slotCoveredByServer = slot !== null && anyServerSlots.has(slot);
      const slotReplacedByAcceptedEntry =
        slot !== null && acceptedServerSlots.has(slot);
      if (slotCoveredByServer && !slotReplacedByAcceptedEntry) continue;
      // Local publication not in server snapshot - retire it
      publications.delete(trackName);
      removed.push(localPub);
      localMutationSequence += 1;
    }

    // The provider snapshot is the FINAL accepted canonical registry state,
    // not only the incoming entries that were accepted. Exact-set
    // reconciliation on the provider side must see every publication that
    // survives, so it does not delete a newer local incarnation merely
    // because a stale heartbeat entry was rejected.
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
