import { defineStore } from 'pinia'
import { useVoiceStore } from './voice'
import { getRtcSignalMetrics } from '../shared/voice-transport'

const HISTORY_LIMIT = 60

export const useRtcStatsStore = defineStore('rtc-stats', () => {
  const voiceStore = useVoiceStore()
  const snapshot = ref(null)
  const outbound = ref([])
  const inbound = ref([])
  const history = reactive({ rtt: [], bitrate: [], jitter: [], loss: [] })
  const polling = ref(true)
  const lastError = ref('')
  let intervalId = null
  let pollBusy = false

  const metrics = computed(() => {
    const result = getRtcSignalMetrics(snapshot.value?.transports)
    const pairs = snapshot.value?.transports?.map(item => item.candidatePair).filter(Boolean) || []
    return {
      ...result,
      lossPercent: result.loss == null ? null : result.loss * 100,
      bitrate: pairs.reduce((total, pair) => total + (Number(pair.availableOutgoingBitrate) || 0), 0) || null
    }
  })

  const report = computed(() => ({
    generatedAt: new Date().toISOString(),
    snapshot: snapshot.value,
    outbound: outbound.value,
    inbound: inbound.value
  }))

  function appendHistory(target, value, timestamp) {
    target.push({ value: Number.isFinite(Number(value)) ? Number(value) : null, timestamp })
    if (target.length > HISTORY_LIMIT) target.splice(0, target.length - HISTORY_LIMIT)
  }

  function reset() {
    snapshot.value = null
    outbound.value = []
    inbound.value = []
    history.rtt.splice(0)
    history.bitrate.splice(0)
    history.jitter.splice(0)
    history.loss.splice(0)
    lastError.value = ''
  }

  async function update() {
    if (pollBusy || !polling.value || !voiceStore.connected) return
    const session = voiceStore.sfuComposable
    if (!session?.getWebRTCStatsSnapshot) return
    pollBusy = true
    try {
      const next = await session.getWebRTCStatsSnapshot()
      const nextMetrics = getRtcSignalMetrics(next?.transports)
      const pairs = next?.transports?.map(item => item.candidatePair).filter(Boolean) || []
      const bitrate = pairs.reduce((total, pair) => total + (Number(pair.availableOutgoingBitrate) || 0), 0) || null
      snapshot.value = next
      outbound.value = session.getOutboundVideoStats ? await session.getOutboundVideoStats() : []
      inbound.value = session.getInboundVideoStats ? await session.getInboundVideoStats() : []
      appendHistory(history.rtt, nextMetrics.rttMs, next.timestamp)
      appendHistory(history.jitter, nextMetrics.jitterMs, next.timestamp)
      appendHistory(history.loss, nextMetrics.loss == null ? null : nextMetrics.loss * 100, next.timestamp)
      appendHistory(history.bitrate, bitrate, next.timestamp)
      lastError.value = ''
    } catch (error) {
      lastError.value = error?.message || 'RTC statistics could not be collected.'
    } finally {
      pollBusy = false
    }
  }

  function start() {
    if (!import.meta.client || intervalId) return
    update()
    intervalId = setInterval(update, 1000)
  }

  function stop() {
    if (intervalId) clearInterval(intervalId)
    intervalId = null
  }

  function togglePolling() {
    polling.value = !polling.value
    if (polling.value) update()
  }

  watch(() => voiceStore.connected, (connected) => {
    if (connected) {
      start()
      update()
    } else {
      reset()
    }
  })

  return { snapshot, outbound, inbound, history, polling, lastError, metrics, report, update, start, stop, reset, togglePolling }
})
