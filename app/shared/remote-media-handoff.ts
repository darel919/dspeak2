const providers = ["p2p", "sfu"];
type RemoteMediaProvider = (typeof providers)[number];

interface RemoteMediaEntry {
  key: string;
  transportKey?: string;
  userId?: string | number | null;
  peerId?: string | number | null;
  source: string;
  provider: RemoteMediaProvider;
  track?: MediaStreamTrack | null;
  incarnationId?: string;
  [key: string]: unknown;
}

function entryIncarnationRank(entry: RemoteMediaEntry): number {
  const epoch = Number(entry.connectionEpoch);
  const generation = Number(entry.sourceGeneration ?? entry.generation);
  const rankEpoch = Number.isSafeInteger(epoch) ? epoch : 0;
  const rankGeneration = Number.isSafeInteger(generation) ? generation : 0;
  return rankEpoch * 1_000_000 + rankGeneration;
}

interface RemoteMediaRegistry {
  bind(entry: RemoteMediaEntry, options?: { staged?: boolean }): void;
  remove(key: string, entry?: RemoteMediaEntry): void;
  clear(): void;
  clearProvider(provider: RemoteMediaProvider): void;
  clearReceivingPreference?(key: string): void;
  activateProvider(provider: RemoteMediaProvider): void;
}

interface ExpectedMediaPeer {
  peerId?: string | number | null;
  userId?: string | number | null;
  sources?: string[];
}

export function remoteMediaFeedKey(entry: {
  userId?: string | number | null;
  peerId?: string | number | null;
  source?: string | null;
}) {
  const owner = entry?.userId ?? entry?.peerId;
  if (owner == null || !entry?.source)
    throw new Error("Remote media requires an owner and source");
  return `remote:${String(owner)}:${String(entry.source)}`;
}
export class RemoteMediaHandoff {
  private readonly registry: RemoteMediaRegistry;
  private readonly staged: Record<
    RemoteMediaProvider,
    Map<string, RemoteMediaEntry>
  >;
  private activeProvider: RemoteMediaProvider | null;

  constructor(registry: RemoteMediaRegistry) {
    this.registry = registry;
    this.staged = Object.fromEntries(
      providers.map((provider) => [provider, new Map()]),
    );
    this.activeProvider = null;
  }

  entries(provider: RemoteMediaProvider) {
    return this.provider(provider).values();
  }

  count(provider: RemoteMediaProvider) {
    return this.provider(provider).size;
  }

  hasExpectedFeeds(
    provider: RemoteMediaProvider,
    peers: ExpectedMediaPeer[],
    localPeerId: string | number | null,
  ) {
    const tracks = this.provider(provider);
    return peers
      .filter((peer) => String(peer.peerId) !== String(localPeerId))
      .every((peer) =>
        (Array.isArray(peer.sources) ? peer.sources : []).every((source) =>
          tracks.has(
            remoteMediaFeedKey({
              userId: peer.userId,
              peerId: peer.peerId,
              source,
            }),
          ),
        ),
      );
  }

  pruneExpectedFeeds(
    peers: ExpectedMediaPeer[],
    localPeerId: string | number | null,
  ) {
    const expected = new Set();
    for (const peer of Array.isArray(peers) ? peers : []) {
      if (String(peer.peerId) === String(localPeerId)) continue;
      for (const source of Array.isArray(peer.sources) ? peer.sources : [])
        expected.add(
          remoteMediaFeedKey({
            userId: peer.userId,
            peerId: peer.peerId,
            source,
          }),
        );
    }
    for (const provider of providers) {
      for (const entry of this.entries(provider)) {
        if (!expected.has(entry.key)) this.remove(entry);
      }
    }
  }

  stage(
    entry: RemoteMediaEntry & { key: string; provider: RemoteMediaProvider },
    activeProvider?: RemoteMediaProvider | null,
  ) {
    this.activeProvider = activeProvider || this.activeProvider;
    const normalized = {
      ...entry,
      transportKey: entry.key,
      key: remoteMediaFeedKey(entry),
      incarnationId: entry.incarnationId,
    };
    const current = this.provider(normalized.provider).get(normalized.key);
    if (
      current &&
      current.track &&
      normalized.track &&
      current.track !== normalized.track
    ) {
      const staleIncoming =
        entryIncarnationRank(normalized) < entryIncarnationRank(current);
      if (staleIncoming) return;
    }
    const tracks = this.provider(normalized.provider);
    const replaced: Array<[string, RemoteMediaEntry]> = [];
    for (const [key, current] of tracks) {
      if (
        current.transportKey === normalized.transportKey &&
        key !== normalized.key
      ) {
        tracks.delete(key);
        replaced.push([key, current]);
      }
    }
    for (const [key, current] of replaced) {
      this.registry.remove(key, current);
      if (!providers.some((provider) => this.provider(provider).has(key)))
        this.registry.clearReceivingPreference?.(key);
    }
    tracks.set(normalized.key, normalized);
    const activeTracks = activeProvider ? this.provider(activeProvider) : null;
    const activeFeedExists =
      activeProvider !== normalized.provider &&
      activeTracks?.has(normalized.key) === true;
    if (
      activeProvider === normalized.provider ||
      (normalized.source === "screen" && !activeFeedExists)
    )
      this.registry.bind(normalized, {
        staged: activeProvider !== normalized.provider,
      });
  }

  remove(
    entry: RemoteMediaEntry & { key: string; provider: RemoteMediaProvider },
  ) {
    const tracks = this.provider(entry.provider);
    const key = remoteMediaFeedKey(entry);
    const current = tracks.get(key);
    if (entry.track && current?.track && current.track !== entry.track)
      return false;
    tracks.delete(key);
    if (this.activeProvider === entry.provider || current?.source === "screen")
      this.registry.remove(key, current);
    if (!providers.some((provider) => this.provider(provider).has(key)))
      this.registry.clearReceivingPreference?.(key);
    return true;
  }

  bind(provider: RemoteMediaProvider) {
    for (const entry of this.entries(provider))
      this.registry.bind(entry, { staged: true });
    this.registry.activateProvider(provider);
    this.activeProvider = provider;
  }

  retire(provider: RemoteMediaProvider) {
    this.registry.clearProvider(provider);
    this.provider(provider).clear();
  }

  clear() {
    for (const provider of providers) this.provider(provider).clear();
    this.registry.clear();
    this.activeProvider = null;
  }

  provider(provider: RemoteMediaProvider) {
    const tracks = this.staged[provider];
    if (!tracks) throw new Error(`Unknown media provider: ${String(provider)}`);
    return tracks;
  }
}
