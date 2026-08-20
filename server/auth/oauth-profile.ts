import { eq } from "drizzle-orm";
import { avatars, profiles } from "../db/schema/index.ts";
import { db } from "../db/client.ts";
import { profileRepository } from "../db/repositories/profiles.ts";
import { putObject, deleteObject } from "../storage/r2.ts";
import { fetchPublicBytes } from "../infrastructure/network/outbound-request.ts";
import type { OAuthProfileRecord, SupabaseUser } from "../types/auth.ts";

const profileProvisioningTimeoutMs = 15_000;

function providerAvatarUrl(user: SupabaseUser): string {
  return String(
    user?.user_metadata?.avatar_url ||
      user?.user_metadata?.picture ||
      user?.user_metadata?.avatarUrl ||
      "",
  ).trim();
}

function supportedAvatarType(contentType: string | null): string {
  if (
    typeof contentType === "string" &&
    new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]).has(
      contentType,
    )
  )
    return contentType;
  return "";
}

function normalizeOAuthProfileRecord(value: unknown): OAuthProfileRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("OAuth profile is not an object");
  return Object.fromEntries(Object.entries(value));
}

async function importProviderAvatar(
  user: SupabaseUser,
  profile: OAuthProfileRecord,
): Promise<OAuthProfileRecord> {
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
      return normalizeOAuthProfileRecord(result);
    } catch (error) {
      await deleteObject(avatarKey).catch(() => {});
      throw error;
    }
  } catch (error) {
    console.warn(
      "[OAuth] Provider avatar import skipped:",
      error instanceof Error ? error.message : String(error),
    );
    return profile;
  }
}

export async function provisionOAuthProfile(user: SupabaseUser) {
  const email = String(user?.email || "").trim();
  if (!user?.id || !email) {
    throw new Error("OAuth user profile is incomplete");
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("User profile setup did not finish in time")),
      profileProvisioningTimeoutMs,
    );
  });

  try {
    const profile = await Promise.race([
      profileRepository.getOrCreateOnFirstLogin(user.id, {
        email,
        displayName:
          user.user_metadata?.full_name || user.user_metadata?.name || email,
        avatarKey: null,
      }),
      timeout,
    ]);
    return await importProviderAvatar(
      user,
      normalizeOAuthProfileRecord(profile),
    );
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
