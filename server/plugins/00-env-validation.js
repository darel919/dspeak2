import { validateRuntimeEnvironment } from "../utils/env-validation";
import { closeSfu, initializeSfu } from "../utils/mediasoup-sfu";
import {
  startPushDispatcher,
  stopPushDispatcher,
} from "../utils/push-delivery";
import { terminateFailedStartup } from "../utils/startup-failure";

export default defineNitroPlugin(async (nitroApp) => {
  if (
    process.env.NITRO_PRESET === "static" ||
    nitroApp.options?.preset === "static"
  )
    return;
  let sessionCleanupTimer = null;
  try {
    await validateRuntimeEnvironment();
    startPushDispatcher();
    sessionCleanupTimer = setInterval(
      () => {
        // Session cleanup handled by Supabase Auth expiration
      },
      60 * 60 * 1000,
    );
    sessionCleanupTimer.unref?.();
    const state = await initializeSfu();

    console.debug(
      `[Server] Nitro and mediasoup ready: worker=${state.worker.pid}, ` +
        `listen=${state.config.listenIp}, announced=${state.config.announcedAddress || "none"}, ` +
        `rtc=${state.config.rtcPort}, announcedPort=${state.config.announcedPort}, ` +
        `direct=${state.config.directAddress || "none"}:${state.config.directPort}`,
    );

    nitroApp.hooks.hook("close", async () => {
      stopPushDispatcher();
      clearInterval(sessionCleanupTimer);
      await closeSfu();
      console.debug("[Server] mediasoup worker stopped");
    });
  } catch (error) {
    await terminateFailedStartup(error, {
      closeRuntime: closeSfu,
      stopBackground: () => {
        stopPushDispatcher();
        clearInterval(sessionCleanupTimer);
      },
    });
  }
});
