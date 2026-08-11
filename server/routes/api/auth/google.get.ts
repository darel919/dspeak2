import { createOAuthSupabaseClient } from "../../../auth/supabase.ts";

export default defineEventHandler(async (event) => {
  const publicOrigin =
    process.env.DSPEAK_PUBLIC_ORIGIN || getRequestURL(event).origin;
  const desktopRedirect = String(
    event.node.req.headers["x-desktop-redirect"] || "",
  );
  let redirectTo = `${publicOrigin.replace(/\/$/, "")}/api/auth/callback`;
  if (event.node.req.headers["x-desktop-app"] === "true" && desktopRedirect) {
    try {
      const candidate = new URL(desktopRedirect);
      if (
        candidate.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(candidate.hostname) &&
        candidate.pathname === "/callback"
      )
        redirectTo = candidate.toString();
    } catch {}
  }

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
