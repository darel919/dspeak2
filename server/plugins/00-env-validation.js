import { validateRuntimeEnvironment } from "../utils/env-validation";
import { closeSfu, initializeSfu } from "../utils/mediasoup-sfu";
import { usePocketBaseAdmin } from "../utils/pocketbase";
import { runPocketBaseMigrations } from "../utils/pocketbase-migrations";
import {
  startPushDispatcher,
  stopPushDispatcher,
} from "../utils/push-delivery";
import { pruneExpiredSessions } from "../utils/authentication";

export default defineNitroPlugin(async (nitroApp) => {
  const config = await validateRuntimeEnvironment();
  await runPocketBaseMigrations(await usePocketBaseAdmin());
  startPushDispatcher();
  const sessionCleanupTimer = setInterval(
    () => {
      pruneExpiredSessions().catch((error) =>
        console.error("[SessionCleanup] Cleanup failed", error),
      );
    },
    60 * 60 * 1000,
  );
  sessionCleanupTimer.unref?.();
  const state = await initializeSfu(config);

  console.debug(
    `[Server] Nitro and mediasoup ready: worker=${state.worker.pid}, ` +
      `listen=${config.listenIp}, announced=${config.announcedAddress || "none"}, ` +
      `rtc=${config.rtcPort}, announcedPort=${config.announcedPort}, ` +
      `direct=${config.directAddress || "none"}:${config.directPort}`,
  );

  nitroApp.hooks.hook("close", async () => {
    stopPushDispatcher();
    clearInterval(sessionCleanupTimer);
    await closeSfu();
    console.debug("[Server] mediasoup worker stopped");
  });
});
