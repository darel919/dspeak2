import { validateRuntimeEnvironment } from "../utils/env-validation.ts";
import { closeDatabase } from "../db/client.ts";
import {
  startPushDispatcher,
  stopPushDispatcher,
} from "../utils/push-delivery.ts";
import { terminateFailedStartup } from "../utils/startup-failure.ts";
import { isPersistentEnvironment } from "../../shared/runtime-mode.ts";

export default defineNitroPlugin(async (nitroApp) => {
  if (
    process.env.NITRO_PRESET === "static" ||
    (nitroApp as unknown as { options?: { preset?: string } }).options
      ?.preset === "static"
  )
    return;
  try {
    await validateRuntimeEnvironment();
    if (isPersistentEnvironment()) {
      startPushDispatcher();
    }
    nitroApp.hooks.hook("close", async () => {
      await stopPushDispatcher();
      return closeDatabase();
    });
  } catch (error) {
    await terminateFailedStartup(error, {
      stopBackground: () => {
        stopPushDispatcher();
      },
    });
  }
});
