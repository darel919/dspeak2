export default defineEventHandler(async (event) => {
  const authHeader = getHeader(event, "authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return;
  }

  const token = authHeader.slice(7);
  if (!token) return;

  try {
    const { verifyAccessToken } = await import("../auth/middleware.ts");
    const payload = await verifyAccessToken(token);
    if (!payload.sub) return;
    const { profileRepository } =
      await import("../db/repositories/profiles.ts");
    const profile = await profileRepository.findById(payload.sub);
    if (profile) {
      event.context.authToken = token;
      event.context.authPayload = payload;
      event.context.authProfile = profile;
      event.context.user = {
        id: profile.id,
        email: payload.email || "",
        role: payload.role,
      };
      event.context.token = token;
    }
  } catch {}
});
