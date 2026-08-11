import {
  createUnavailableSnapshot,
  getRepositoryUpdate,
} from "../../utils/repository-update.ts";

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event);
  const query = getQuery(event);
  const clientBuild = {
    ...(config.public?.appBuild || {}),
    commit: typeof query.commit === "string" ? query.commit : null,
  };
  const deployedBuild = config.public?.appBuild || {};
  try {
    const snapshot = await getRepositoryUpdate({ clientBuild, deployedBuild });
    setHeader(
      event,
      "Cache-Control",
      "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
    );
    return snapshot;
  } catch (error) {
    console.warn("[Updates] Repository comparison unavailable", error);
    setHeader(event, "Cache-Control", "no-store");
    return createUnavailableSnapshot(
      clientBuild,
      deployedBuild,
      process.env.DSPEAK_UPDATE_REPOSITORY || "darel919/dspeak2",
      process.env.DSPEAK_UPDATE_BRANCH || "next",
    );
  }
});
