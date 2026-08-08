import { supabase } from "../../../auth/supabase.js";
import { createPendingOAuthSession } from "../../../auth/pending-oauth-session.js";
import { profileRepository } from "../../../db/repositories/profiles.js";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const code = String(body?.code || "");
  if (!code)
    throw createError({
      statusCode: 400,
      statusMessage: "Missing authorization code",
    });

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.session || !data.user)
    throw createError({
      statusCode: 401,
      statusMessage: error?.message || "Invalid authorization code",
    });

  await profileRepository.getOrCreateOnFirstLogin(data.user.id, {
    email: data.user.email,
    username:
      data.user.user_metadata?.user_name || data.user.user_metadata?.name,
    displayName:
      data.user.user_metadata?.full_name || data.user.user_metadata?.name,
    avatarKey: null,
  });

  return { code: createPendingOAuthSession(data.session) };
});
