import { createOAuthSupabaseClient } from "../../../auth/supabase.ts";
import { createPendingOAuthSession } from "../../../auth/pending-oauth-session.ts";
import { exchangeOAuthCode } from "../../../auth/oauth-exchange.ts";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const code = String(query.code || "");

  if (!code) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing authorization code",
    });
  }

  const { client, clearStorage } = createOAuthSupabaseClient(event);
  let data: { session: import("@supabase/supabase-js").Session | null };
  let error: { message: string } | null;
  try {
    ({ data, error } = (await exchangeOAuthCode(client, code)) as {
      data: { session: import("@supabase/supabase-js").Session | null };
      error: { message: string } | null;
    });
  } finally {
    await clearStorage();
  }

  if (error) {
    throw createError({ statusCode: 400, statusMessage: error.message });
  }

  const session = data.session;
  if (!session)
    throw createError({
      statusCode: 400,
      statusMessage: "OAuth session was not returned",
    });

  const pendingCode = createPendingOAuthSession(session);
  return sendRedirect(event, `/auth?code=${encodeURIComponent(pendingCode)}`);
});
