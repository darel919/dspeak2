import { validateRuntimeEnvironment } from "../utils/env-validation";
import { closeSfu, initializeSfu } from "../utils/mediasoup-sfu";
import { usePocketBaseAdmin } from "../utils/pocketbase";
import { runPocketBaseMigrations } from "../utils/pocketbase-migrations";

export default defineNitroPlugin(async (nitroApp) => {
  const config = await validateRuntimeEnvironment();
  await runPocketBaseMigrations(await usePocketBaseAdmin());
  const state = await initializeSfu(config);

  console.debug(
    `[Server] Nitro and mediasoup ready: worker=${state.worker.pid}, ` +
      `listen=${config.listenIp}, announced=${config.announcedAddress || "none"}, ` +
      `rtc=${config.rtcPort}, announcedPort=${config.announcedPort}, ` +
      `direct=${config.directAddress || "none"}:${config.directPort}`,
  );

  nitroApp.hooks.hook("close", async () => {
    await closeSfu();
    console.debug("[Server] mediasoup worker stopped");
  });
});
