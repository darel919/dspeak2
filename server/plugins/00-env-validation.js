import { validateRuntimeEnvironment } from '../utils/env-validation'
import { closeSfu, initializeSfu } from '../utils/mediasoup-sfu'

export default defineNitroPlugin(async (nitroApp) => {
  const config = await validateRuntimeEnvironment()
  const state = await initializeSfu(config)

  console.log(
    `[Server] Nitro and mediasoup ready: worker=${state.worker.pid}, ` +
    `listen=${config.listenIp}, announced=${config.announcedAddress || 'none'}, ` +
    `rtc=${config.rtcPort}, announcedPort=${config.announcedPort}, ` +
    `direct=${config.directAddress || 'none'}:${config.directPort}`
  )

  nitroApp.hooks.hook('close', async () => {
    await closeSfu()
    console.log('[Server] mediasoup worker stopped')
  })
})
