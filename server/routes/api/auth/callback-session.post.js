import { consumePendingOAuthSession } from "../../../auth/pending-oauth-session.js";

export default defineEventHandler(async (event) => {
  setHeader(event, "Cache-Control", "no-store");
  const body = await readBody(event);
  const code = String(body?.code || "");
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(code)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid callback code",
    });
  }
  const session = consumePendingOAuthSession(code);
  if (!session) {
    throw createError({
      statusCode: 410,
      statusMessage: "Callback session expired or was already used",
    });
  }
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
  };
});
