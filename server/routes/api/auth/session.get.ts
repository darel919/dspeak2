import {
  exposeCsrfToken,
  getAuthenticatedSession,
} from "../../../utils/auth.ts";

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  if (!session) {
    throw createError({
      statusCode: 401,
      statusMessage: "Authentication required",
    });
  }
  exposeCsrfToken(event, session.user);
  return { authenticated: true };
});
