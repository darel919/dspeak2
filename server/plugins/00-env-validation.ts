import { validateRuntimeEnvironment } from "../utils/env-validation.ts";
import { closeDatabase } from "../db/client.ts";
import {
  startPushDispatcher,
  stopPushDispatcher,
} from "../utils/push-delivery.ts";
import { terminateFailedStartup } from "../utils/startup-failure.ts";
import { isPersistentEnvironment } from "../../shared/runtime-mode.ts";

export default defineNitroPlugin(async (nitroApp) => {
  if (process.env.NITRO_PRESET === "static") return;
  try {
    const environment = await validateRuntimeEnvironment();
    if (environment?.supabaseUrl) {
      const projectRef = new URL(environment.supabaseUrl).hostname.split(
        ".",
      )[0];
      console.info(
        `[Startup] Supabase project: ${projectRef}`,
        `API origin: ${process.env.VITE_DSPEAK_API_PATH || "/api"}`,
      );
    }
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
