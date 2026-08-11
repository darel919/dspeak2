import { requireAuthenticatedUser } from "../../../utils/auth.ts";
import { broadcastGlobally } from "../../../utils/dspeak-realtime.ts";
import { markPresenceOffline } from "../../../utils/presence-manager.ts";

export default defineEventHandler(async (event) => {
  const userId = await requireAuthenticatedUser(event);
  if (getMethod(event) !== "POST") {
    throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
  }
  await markPresenceOffline(userId);
  broadcastGlobally({
    type: "status_updated",
    data: {
      userId,
      status: "offline",
      updatedAt: new Date().toISOString(),
      isManualOverride: false,
      platform: "web",
    },
  });
  return { ok: true };
});
