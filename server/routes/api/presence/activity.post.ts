import { requireAuthenticatedUser } from "../../../utils/auth.ts";
import { markPresenceActivity } from "../../../utils/presence-manager.ts";

export default defineEventHandler(async (event) => {
  const userId = await requireAuthenticatedUser(event);
  if (getMethod(event) !== "POST") {
    throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
  }
  await markPresenceActivity(userId);
  return { ok: true };
});
