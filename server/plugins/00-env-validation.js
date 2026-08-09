import { validateRuntimeEnvironment } from "../utils/env-validation.js";
import {
  startPushDispatcher,
  stopPushDispatcher,
} from "../utils/push-delivery.js";
import { terminateFailedStartup } from "../utils/startup-failure.js";
import { isPersistentEnvironment } from "../../shared/runtime-mode.js";

export default defineNitroPlugin(async (nitroApp) => {
  if (
    process.env.NITRO_PRESET === "static" ||
    nitroApp.options?.preset === "static"
  )
    return;
  try {
    await validateRuntimeEnvironment();
    if (isPersistentEnvironment()) {
      startPushDispatcher();
    }
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
