import { createOAuthSupabaseClient } from "../../../auth/supabase.ts";

export default defineEventHandler(async (event) => {
  const publicOrigin =
    process.env.DSPEAK_PUBLIC_ORIGIN || getRequestURL(event).origin;
  const redirectTo = `${publicOrigin.replace(/\/$/, "")}/api/auth/callback`;

  const { client } = createOAuthSupabaseClient(event);
  const { data, error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      scopes: "openid email profile",
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
  });

  if (error) {
    throw createError({ statusCode: 400, statusMessage: error.message });
  }

  return { url: data.url };
});
