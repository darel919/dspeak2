const providers = ['p2p', 'sfu']

export function remoteMediaFeedKey(entry) {
  const owner = entry?.userId ?? entry?.peerId
  if (owner == null || !entry?.source) throw new Error('Remote media requires an owner and source')
  return `remote:${String(owner)}:${String(entry.source)}`
}

export class RemoteMediaHandoff {
  constructor(registry) {
    this.registry = registry
    this.staged = Object.fromEntries(providers.map(provider => [provider, new Map()]))
    this.activeProvider = null
  }

  entries(provider) {
    return this.provider(provider).values()
  }

  count(provider) {
    return this.provider(provider).size
  }

  stage(entry, activeProvider) {
    this.activeProvider = activeProvider || this.activeProvider
    const normalized = { ...entry, transportKey: entry.key, key: remoteMediaFeedKey(entry) }
    const tracks = this.provider(normalized.provider)
    for (const [key, current] of tracks) {
      if (current.transportKey === normalized.transportKey && key !== normalized.key) tracks.delete(key)
    }
    tracks.set(normalized.key, normalized)
    if (activeProvider === normalized.provider) this.registry.bind(normalized)
  }

  remove(entry) {
    const tracks = this.provider(entry.provider)
    const key = remoteMediaFeedKey(entry)
    const current = tracks.get(key)
    if (entry.track && current?.track && current.track !== entry.track) return false
    tracks.delete(key)
    if (this.activeProvider === entry.provider) this.registry.remove(key)
    return true
  }

  bind(provider) {
    for (const entry of this.entries(provider)) this.registry.bind(entry, { staged: true })
    this.registry.activateProvider(provider)
    this.activeProvider = provider
  }

  retire(provider) {
    this.registry.clearProvider(provider)
    this.provider(provider).clear()
  }

  clear() {
    for (const provider of providers) this.provider(provider).clear()
    this.registry.clear()
    this.activeProvider = null
  }

  provider(provider) {
    const tracks = this.staged[provider]
    if (!tracks) throw new Error(`Unknown media provider: ${String(provider)}`)
    return tracks
  }
}
