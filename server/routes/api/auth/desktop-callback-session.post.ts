import { createOAuthSupabaseClient } from "../../../auth/supabase.ts";
import { createPendingOAuthSession } from "../../../auth/pending-oauth-session.ts";
import { exchangeOAuthCode } from "../../../auth/oauth-exchange.ts";
import { provisionOAuthProfile } from "../../../auth/oauth-profile.ts";

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) as { code?: unknown };
  const code = String(body?.code || "");
  if (!code)
    throw createError({
      statusCode: 400,
      statusMessage: "Missing authorization code",
    });

  const { client, clearStorage } = createOAuthSupabaseClient(event);
  let data: {
    session: import("@supabase/supabase-js").Session | null;
    user: import("@supabase/supabase-js").User | null;
  };
  let error: { message: string } | null;
  try {
    ({ data, error } = (await exchangeOAuthCode(client, code)) as {
      data: {
        session: import("@supabase/supabase-js").Session | null;
        user: import("@supabase/supabase-js").User | null;
      };
      error: { message: string } | null;
    });
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
