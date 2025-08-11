 
 

import { useRuntimeConfig } from '#app'

export function usePresence(userId) {
  const status = ref('disconnected') 
  let ws = null
  let retryCount = 0
  let retryTimer = null
  let pingInterval = null
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
      
      if (pingInterval) clearInterval(pingInterval)
      pingInterval = setInterval(() => {
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'ping' }))
        }
      }, 30000)
    }
    ws.onclose = () => {
      console.log('[usePresence] Connection closed, retry count:', retryCount)
      status.value = 'disconnected'
      if (pingInterval) {
        clearInterval(pingInterval)
        pingInterval = null
      }
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
    if (pingInterval) {
      clearInterval(pingInterval)
      pingInterval = null
    }
    clearTimeout(retryTimer)
    ws = null
    retryCount = 0
  }

  
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
