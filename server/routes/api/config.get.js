import {
  createCloudflareTurnServers,
  createIceServers,
} from "~~/server/const/ice-servers.js";
import { requireAuthenticatedUser } from "~~/server/utils/auth.js";

const TURN_CACHE_TTL_MS = 300_000;
const turnCache = new Map();

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
      const now = Date.now();
      let cached = turnCache.get("auto");
      if (cached && cached.expiresAt > now) {
        servers.push(...cached.value);
      } else {
        const turnServers = await createCloudflareTurnServers();
        turnCache.set("auto", {
          value: turnServers,
          expiresAt: now + TURN_CACHE_TTL_MS,
        });
        servers.push(...turnServers);
      }
    } catch (error) {
      console.warn("[ICE] Cloudflare TURN credentials unavailable", error);
    }
  }
  return servers;
});
