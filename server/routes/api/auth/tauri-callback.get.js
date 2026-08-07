import { supabase } from "../../../auth/supabase.js";
import { profileRepository } from "../../../db/repositories/profiles.js";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const { access_token, refresh_token, type, error, error_description } = query;

  if (error) {
    throw createError({
      statusCode: 400,
      statusMessage: error_description || error,
    });
  }

  if (type === "recovery") {
    return sendRedirect(event, "/account/recovery");
  }

  if (!access_token || !refresh_token) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing access_token or refresh_token",
    });
  }

  const { data, error: sessionError } = await supabase.auth.setSession({
    access_token,
    refresh_token,
  });

  if (sessionError || !data.user) {
    throw createError({
      statusCode: 401,
      statusMessage: sessionError?.message || "Invalid session",
    });
  }

  const user = data.user;
  const session = data.session;

  await profileRepository.getOrCreateOnFirstLogin(user.id, {
    email: user.email,
    username: user.user_metadata?.user_name || user.user_metadata?.name,
    displayName: user.user_metadata?.full_name || user.user_metadata?.name,
    avatarKey: null,
  });

  return sendRedirect(event, "/");
});
