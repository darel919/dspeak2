import { supabase } from "../../../auth/supabase.js";
import { profileRepository } from "../../../db/repositories/profiles.js";

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

  const config = useRuntimeConfig();
  const redirectUrl = `${config.public.appUrl}/#access_token=${encodeURIComponent(session.access_token)}&refresh_token=${encodeURIComponent(session.refresh_token)}`;

  return sendRedirect(event, redirectUrl);
});
