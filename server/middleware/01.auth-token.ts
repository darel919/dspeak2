export default defineEventHandler(async (event) => {
  const authHeader = getHeader(event, "authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return;
  }

  const token = authHeader.slice(7);
  if (!token) return;

  try {
    const { ensureVerifiedBearer } = await import("../auth/middleware.ts");
    const payload = await ensureVerifiedBearer(event);
    if (!payload) return;
    try {
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
    } catch (error) {
      console.warn("[Auth] BEARER_PROFILE_LOOKUP_FAILED", {
        name: error instanceof Error ? error.name : "unknown",
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  } catch (error) {
    console.warn("[Auth] BEARER_VERIFICATION_FAILED", {
      name: error instanceof Error ? error.name : "unknown",
      message: error instanceof Error ? error.message : "unknown",
    });
  }
});
