import { supabase } from "../../../auth/supabase.js";

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${config.public.appUrl}/auth/callback`,
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
