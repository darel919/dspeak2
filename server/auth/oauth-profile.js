import { eq } from "drizzle-orm";
import { avatars, profiles } from "../db/schema/index.js";
import { db } from "../db/client.js";
import { profileRepository } from "../db/repositories/profiles.js";
import { putObject, deleteObject } from "../storage/r2.js";
import { fetchPublicBytes } from "../infrastructure/network/outbound-request.js";

const profileProvisioningTimeoutMs = 15_000;

function providerAvatarUrl(user) {
  return String(
    user?.user_metadata?.avatar_url ||
      user?.user_metadata?.picture ||
      user?.user_metadata?.avatarUrl ||
      "",
  ).trim();
}

function supportedAvatarType(contentType) {
  return new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]).has(
    contentType,
  )
    ? contentType
    : "";
}

async function importProviderAvatar(user, profile) {
  if (profile?.avatarKey) return profile;
  const source = providerAvatarUrl(user);
  if (!source) return profile;

  try {
    const downloaded = await fetchPublicBytes(source, {
      maxBytes: 5 * 1024 * 1024,
      timeoutMs: 5000,
    });
    const contentType = supportedAvatarType(downloaded.contentType);
    if (!contentType || !downloaded.body.length) return profile;
    const avatarKey = `avatars/${user.id}/${crypto.randomUUID()}`;
    await putObject(
      avatarKey,
      downloaded.body,
      contentType,
      downloaded.body.length,
    );
    try {
      const result = await db.transaction(async (tx) => {
        const updated = await tx
          .update(profiles)
          .set({ avatarKey, updatedAt: new Date() })
          .where(eq(profiles.id, user.id))
          .returning();
        if (!updated[0]) throw new Error("OAuth profile was not found");
        await tx.insert(avatars).values({
          userId: user.id,
          r2Key: avatarKey,
          mimeType: contentType,
          size: downloaded.body.length,
        });
        return updated[0];
      });
      return result;
    } catch (error) {
      await deleteObject(avatarKey).catch(() => {});
      throw error;
    }
  } catch (error) {
    console.warn("[OAuth] Provider avatar import skipped:", error.message);
    return profile;
  }
}

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
    const profile = await Promise.race([
      profileRepository.getOrCreateOnFirstLogin(user.id, {
        email,
        username: user.user_metadata?.user_name || user.user_metadata?.name,
        displayName:
          user.user_metadata?.full_name || user.user_metadata?.name || email,
        avatarKey: null,
      }),
      timeout,
    ]);
    return await importProviderAvatar(user, profile);
  } finally {
    clearTimeout(timeoutId);
  }
}
