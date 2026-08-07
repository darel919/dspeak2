export default defineEventHandler(async (event) => {
  const authHeader = getHeader(event, "authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return;
  }

  const token = authHeader.slice(7);
  if (!token) return;

  try {
    const { verifyAccessToken } = await import("../auth/middleware.js");
    const payload = await verifyAccessToken(token);
    const { profileRepository } =
      await import("../db/repositories/profiles.js");
    const profile = await profileRepository.findById(payload.sub);
    if (profile) {
      event.context.user = {
        id: profile.id,
        email: profile.email || payload.email,
        role: payload.role,
      };
      event.context.token = token;
    }
  } catch {}
});
