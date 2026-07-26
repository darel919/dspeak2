const providers = ["p2p", "sfu"];

export function remoteMediaFeedKey(entry) {
  const owner = entry?.userId ?? entry?.peerId;
  if (owner == null || !entry?.source)
    throw new Error("Remote media requires an owner and source");
  return `remote:${String(owner)}:${String(entry.source)}`;
}

export class RemoteMediaHandoff {
  constructor(registry) {
    this.registry = registry;
    this.staged = Object.fromEntries(
      providers.map((provider) => [provider, new Map()]),
    );
    this.activeProvider = null;
  }

  entries(provider) {
    return this.provider(provider).values();
  }

  count(provider) {
    return this.provider(provider).size;
  }

  hasExpectedFeeds(provider, peers, localPeerId) {
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

  pruneExpectedFeeds(peers, localPeerId) {
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
      for (const entry of [...this.entries(provider)]) {
        if (!expected.has(entry.key)) this.remove(entry);
      }
    }
  }

  stage(entry, activeProvider) {
    this.activeProvider = activeProvider || this.activeProvider;
    const normalized = {
      ...entry,
      transportKey: entry.key,
      key: remoteMediaFeedKey(entry),
    };
    const tracks = this.provider(normalized.provider);
    for (const [key, current] of tracks) {
      if (
        current.transportKey === normalized.transportKey &&
        key !== normalized.key
      )
        tracks.delete(key);
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

  remove(entry) {
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

  bind(provider) {
    for (const entry of this.entries(provider))
      this.registry.bind(entry, { staged: true });
    this.registry.activateProvider(provider);
    this.activeProvider = provider;
  }

  retire(provider) {
    this.registry.clearProvider(provider);
    this.provider(provider).clear();
  }

  clear() {
    for (const provider of providers) this.provider(provider).clear();
    this.registry.clear();
    this.activeProvider = null;
  }

  provider(provider) {
    const tracks = this.staged[provider];
    if (!tracks) throw new Error(`Unknown media provider: ${String(provider)}`);
    return tracks;
  }
}
