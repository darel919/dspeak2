import { validateRuntimeEnvironment } from '../utils/env-validation'
import { closeSfu, initializeSfu } from '../utils/mediasoup-sfu'

export default defineNitroPlugin(async (nitroApp) => {
  const config = validateRuntimeEnvironment()
  const state = await initializeSfu()

  console.log(
    `[Server] Nitro and mediasoup ready: worker=${state.worker.pid}, ` +
    `listen=${config.listenIp}, announced=${config.announcedAddress || 'none'}, ` +
    `rtc=${config.rtcMinPort}-${config.rtcMaxPort}`
  )

  nitroApp.hooks.hook('close', async () => {
    await closeSfu()
    console.log('[Server] mediasoup worker stopped')
  })
})
