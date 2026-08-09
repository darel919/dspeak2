import { requireAuthenticatedUser } from "../../../utils/auth.js";
import { broadcastGlobally } from "../../../utils/dspeak-realtime.js";
import {
  getOnlinePresence,
  setPresence,
  sweepExpiredPresence,
} from "../../../utils/presence-manager.js";

export default defineEventHandler(async (event) => {
  const userId = await requireAuthenticatedUser(event);
  const method = getMethod(event);

  if (method === "GET") {
    const expiredUserIds = await sweepExpiredPresence();
    for (const expiredUserId of expiredUserIds) {
      broadcastGlobally({
        type: "status_updated",
        data: {
          userId: expiredUserId,
          status: "offline",
          updatedAt: new Date().toISOString(),
          isManualOverride: false,
          platform: "web",
        },
      });
    }
    const users = await getOnlinePresence();
    return { users };
  }

  if (method === "POST") {
    const body = await readBody(event).catch(() => ({}));
    const status = String(body.status || "online");
    const presence = await setPresence(userId, status, {
      timestamp: body.timestamp,
      isManualOverride: body.manual !== false,
      platform: body.platform,
    });
    broadcastGlobally({ type: "status_updated", data: presence });
    return { ok: true };
  }

  throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
});
