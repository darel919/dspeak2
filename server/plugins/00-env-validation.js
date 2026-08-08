import { validateRuntimeEnvironment } from "../utils/env-validation";
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
  try {
    await validateRuntimeEnvironment();
    startPushDispatcher();
    nitroApp.hooks.hook("close", () => {
      stopPushDispatcher();
    });
  } catch (error) {
    await terminateFailedStartup(error, {
      stopBackground: () => {
        stopPushDispatcher();
      },
    });
  }
});
