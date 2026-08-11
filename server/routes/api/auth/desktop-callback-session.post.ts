import { createOAuthSupabaseClient } from "../../../auth/supabase.ts";
import { createPendingOAuthSession } from "../../../auth/pending-oauth-session.ts";
import { exchangeOAuthCode } from "../../../auth/oauth-exchange.ts";
import { provisionOAuthProfile } from "../../../auth/oauth-profile.ts";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const code = String(body?.code || "");
  if (!code)
    throw createError({
      statusCode: 400,
      statusMessage: "Missing authorization code",
    });

  const { client, clearStorage } = createOAuthSupabaseClient(event);
  let data;
  let error;
  try {
    ({ data, error } = await exchangeOAuthCode(client, code));
  } finally {
    await clearStorage();
  }
  if (error || !data.session || !data.user)
    throw createError({
      statusCode: 401,
      statusMessage: error?.message || "Invalid authorization code",
    });

  await provisionOAuthProfile(data.user);

  return { code: createPendingOAuthSession(data.session) };
});
