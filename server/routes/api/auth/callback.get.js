import { supabase } from "../../../auth/supabase.js";
import { profileRepository } from "../../../db/repositories/profiles.js";
import { createPendingOAuthSession } from "../../../auth/pending-oauth-session.js";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const code = query.code;

  if (!code) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing authorization code",
    });
  }

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    throw createError({ statusCode: 400, statusMessage: error.message });
  }

  const user = data.user;
  const session = data.session;

  if (user) {
    await profileRepository.getOrCreateOnFirstLogin(user.id, {
      email: user.email,
      username: user.user_metadata?.user_name || user.user_metadata?.name,
      displayName: user.user_metadata?.full_name || user.user_metadata?.name,
      avatarKey: null,
    });
  }

  const pendingCode = createPendingOAuthSession(session);
  return sendRedirect(event, `/auth?code=${encodeURIComponent(pendingCode)}`);
});
