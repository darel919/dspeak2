import { getSfuMetrics } from '../utils/mediasoup-sfu'

export default defineEventHandler(async (event) => {
  const metrics = await getSfuMetrics()
  setHeader(event, 'Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  return [
    '# HELP dspeak_sfu_rooms Active media rooms.',
    '# TYPE dspeak_sfu_rooms gauge',
    `dspeak_sfu_rooms ${metrics.rooms}`,
    '# HELP dspeak_sfu_peers Active SFU peers.',
    '# TYPE dspeak_sfu_peers gauge',
    `dspeak_sfu_peers ${metrics.peers}`,
    '# HELP dspeak_sfu_transports Active WebRTC transports.',
    '# TYPE dspeak_sfu_transports gauge',
    `dspeak_sfu_transports ${metrics.transports}`,
    '# HELP dspeak_sfu_producers Active media producers.',
    '# TYPE dspeak_sfu_producers gauge',
    `dspeak_sfu_producers ${metrics.producers}`,
    '# HELP dspeak_sfu_consumers Active media consumers.',
    '# TYPE dspeak_sfu_consumers gauge',
    `dspeak_sfu_consumers ${metrics.consumers}`,
    `dspeak_sfu_worker_info{pid="${metrics.workerPid}"} 1`,
    ''
  ].join('\n')
})
