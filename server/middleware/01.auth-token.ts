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
    event.context.authToken = token;
    event.context.authPayload = payload;
    event.context.token = token;
    event.context.user = {
      id: payload.sub,
      email: payload.email || "",
      role: payload.role,
    };
    const { profileRepository } =
      await import("../db/repositories/profiles.ts");
    const profile = await profileRepository.findById(payload.sub);
    if (profile) {
      event.context.authProfile = profile;
      event.context.user = {
        id: profile.id,
        email: payload.email || "",
        role: payload.role,
      };
    }
  } catch {}
});
