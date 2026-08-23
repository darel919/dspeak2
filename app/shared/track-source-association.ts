export type TrackSourceAssociationRecord = {
  source: string;
  generation: number;
  connectionEpoch: number;
  ownerSource: string | null;
};

type ParkedTrack = {
  trackId: string;
  kind: string;
  resolve: (record: TrackSourceAssociationRecord) => void;
};

const PLACEHOLDER_PREFIX = "__unassociated:";

function placeholderKey(peerId: string, trackId: string) {
  return `${PLACEHOLDER_PREFIX}${peerId}:${trackId}`;
}

export class TrackSourceAssociation {
  private readonly byTrack = new Map<
    string,
    Map<string, TrackSourceAssociationRecord>
  >();
  private readonly parked = new Map<string, ParkedTrack>();

  associate(
    peerId: string,
    trackId: string,
    record: TrackSourceAssociationRecord,
  ): "stored" | "resolved" {
    let perPeer = this.byTrack.get(trackId);
    if (!perPeer) {
      perPeer = new Map();
      this.byTrack.set(trackId, perPeer);
    }
    perPeer.set(peerId, record);
    const parkedKey = placeholderKey(peerId, trackId);
    const waiting = this.parked.get(parkedKey);
    if (!waiting) return "stored";
    this.parked.delete(parkedKey);
    waiting.resolve(record);
    return "resolved";
  }

  lookupByTrack(
    peerId: string,
    trackId: string,
  ): TrackSourceAssociationRecord | null {
    return this.byTrack.get(trackId)?.get(peerId) ?? null;
  }

  park(
    peerId: string,
    trackId: string,
    kind: string,
    resolve: (record: TrackSourceAssociationRecord) => void,
  ) {
    this.parked.set(placeholderKey(peerId, trackId), {
      trackId,
      kind,
      resolve,
    });
  }

  dropTrack(trackId: string) {
    this.byTrack.delete(trackId);
    for (const key of this.parked.keys())
      if (key.endsWith(`:${trackId}`)) this.parked.delete(key);
  }

  dropPeer(peerId: string) {
    for (const [trackId, perPeer] of this.byTrack) {
      perPeer.delete(peerId);
      if (perPeer.size === 0) this.byTrack.delete(trackId);
    }
    for (const key of this.parked.keys())
      if (key.startsWith(`${PLACEHOLDER_PREFIX}${peerId}:`))
        this.parked.delete(key);
  }
}
