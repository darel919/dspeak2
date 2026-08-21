import { createOAuthSupabaseClient } from "../../../auth/supabase.ts";
import { createPendingOAuthSession } from "../../../auth/pending-oauth-session.ts";
import { exchangeOAuthCode } from "../../../auth/oauth-exchange.ts";
import { parseExternalString } from "../../../../shared/types/external.ts";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const code = parseExternalString(query.code) || "";

  if (!code) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing authorization code",
    });
  }

  const { client, clearStorage } = createOAuthSupabaseClient(event);
  let data: Awaited<ReturnType<typeof exchangeOAuthCode>>["data"];
  let error: Awaited<ReturnType<typeof exchangeOAuthCode>>["error"];
  try {
    ({ data, error } = await exchangeOAuthCode(client, code));
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
