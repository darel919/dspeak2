export default defineEventHandler(() => ({
  status: 'ok',
  service: 'dspeak',
  timestamp: new Date().toISOString()
}))
