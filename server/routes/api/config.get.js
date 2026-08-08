import {
  createCloudflareTurnServers,
  createIceServers,
} from "~~/server/const/ice-servers.js";
import { requireAuthenticatedUser } from "~~/server/utils/auth.js";

export default defineEventHandler(async (event) => {
  await requireAuthenticatedUser(event);
  const query = getQuery(event);
  const connectionMode = query.connectionMode || "auto";
  if (!["auto", "direct"].includes(connectionMode))
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid connection mode",
    });
  const servers = createIceServers(process.env, Date.now(), { connectionMode });
  if (connectionMode === "auto") {
    try {
      servers.push(...(await createCloudflareTurnServers()));
    } catch (error) {
      console.warn("[ICE] Cloudflare TURN credentials unavailable", error);
    }
  }
  return servers;
});
