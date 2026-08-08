import { profileRepository } from "../db/repositories/profiles.js";

const profileProvisioningTimeoutMs = 15_000;

export async function provisionOAuthProfile(user) {
  const email = String(user?.email || "").trim();
  if (!user?.id || !email) {
    throw new Error("OAuth user profile is incomplete");
  }

  let timeoutId;
  const timeout = new Promise((resolve, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("User profile setup did not finish in time")),
      profileProvisioningTimeoutMs,
    );
  });

  try {
    return await Promise.race([
      profileRepository.getOrCreateOnFirstLogin(user.id, {
        email,
        username: user.user_metadata?.user_name || user.user_metadata?.name,
        displayName:
          user.user_metadata?.full_name || user.user_metadata?.name || email,
        avatarKey: null,
      }),
      timeout,
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}
