import { consumePendingOAuthSession } from "../../../auth/pending-oauth-session.ts";
import { provisionOAuthProfile } from "../../../auth/oauth-profile.ts";
import {
  parseExternalRecord,
  parseExternalString,
} from "../../../../shared/types/external.ts";

export default defineEventHandler(async (event) => {
  setHeader(event, "Cache-Control", "no-store");
  const body = parseExternalRecord(await readBody(event));
  const code = parseExternalString(body?.code) || "";
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
  await provisionOAuthProfile(session.user);
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
  };
});
