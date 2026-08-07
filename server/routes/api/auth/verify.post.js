import { supabase } from "../../../auth/supabase.js";
import { verifyAccessToken } from "../../../auth/middleware.js";

export default defineEventHandler(async (event) => {
  const { accessToken } = await readBody(event);

  if (!accessToken) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing access token",
    });
  }

  try {
    const payload = await verifyAccessToken(accessToken);
    return { user: { id: payload.sub, email: payload.email } };
  } catch (error) {
    throw createError({
      statusCode: 401,
      statusMessage: "Invalid or expired token",
    });
  }
});
