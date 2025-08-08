// GLOBAL PRESENCE HANDLER
// THIS WILL INFORM BACKEND IF USER IS ONLINE OR NOT.

import { useRuntimeConfig } from '#app'

export function usePresence(userId) {
  const status = ref('disconnected') // 'connected', 'disconnected', 'permanently-disconnected'
  let ws = null
  let retryCount = 0
  let retryTimer = null
  const config = useRuntimeConfig()

  function connect(id) {
    if (!id) {
      console.log('[usePresence] No userId provided for connection')
      return
    }
    const base = config.public.websocketPath
    if (!base) {
      console.log('[usePresence] No websocketPath in config')
      return
    }
    const wsUrl = `${base}/presence?userId=${encodeURIComponent(id)}`
    console.log('[usePresence] Connecting to:', wsUrl)
    ws = new WebSocket(wsUrl)
    ws.onopen = () => {
      console.log('[usePresence] Connected successfully')
      status.value = 'connected'
      retryCount = 0
      clearTimeout(retryTimer)
    }
    ws.onclose = () => {
      console.log('[usePresence] Connection closed, retry count:', retryCount)
      status.value = 'disconnected'
      if (retryCount < 10) {
        retryCount++
        retryTimer = setTimeout(() => connect(id), 2000)
      } else {
        status.value = 'permanently-disconnected'
      }
    }
    ws.onerror = (error) => {
      console.log('[usePresence] WebSocket error:', error)
      ws.close()
    }
  }
  function disconnect() {
    if (ws) ws.close()
    clearTimeout(retryTimer)
    ws = null
    retryCount = 0
  }

  // Only reconnect when userId changes and is a non-empty string
  if (isRef(userId)) {
    console.log('[usePresence] Setting up watcher for reactive userId')
    watch(userId, (id, oldId) => {
      console.log('[usePresence] userId changed from', oldId, 'to', id)
      disconnect()
      if (id) connect(id)
    }, { immediate: true })
  } else {
    console.log('[usePresence] Static userId provided:', userId)
    if (userId) connect(userId)
  }

  return { status, connect: () => connect(isRef(userId) ? userId.value : userId), disconnect }
}
