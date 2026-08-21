import { verifySupabaseAccessToken } from "../../../auth/supabase.ts";

export default defineEventHandler(async (event) => {
  const { accessToken } = await readBody(event);

  if (!accessToken) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing access token",
    });
  }

  try {
    const payload = await verifySupabaseAccessToken(accessToken);
    return { user: { id: payload.sub, email: payload.email } };
  } catch {
    throw createError({
      statusCode: 401,
      statusMessage: "Invalid or expired token",
    });
  }
});
