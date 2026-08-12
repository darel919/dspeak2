import { eq } from "drizzle-orm";
import { avatars, profiles } from "../db/schema/index.ts";
import { deleteObject, putObject } from "../storage/r2.ts";
import type { ProfileApiDependencies } from "../types/profile-api.ts";

type ProfileAvatarInput = Parameters<
  NonNullable<ProfileApiDependencies["updateProfileAvatar"]>
>[0];

export async function updateProfileAvatar({
  db,
  userId,
  body,
  update,
}: ProfileAvatarInput) {
  const avatar = body.avatar instanceof File ? body.avatar : null;
  const hasNewAvatar = Boolean(avatar?.size);
  const removeAvatar =
    body.removeAvatar === true || body.removeAvatar === "true";
  const currentRows = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  const current = currentRows[0];
  const avatarRows = await db
    .select({ r2Key: avatars.r2Key })
    .from(avatars)
    .where(eq(avatars.userId, userId));
  const oldAvatarKeys = new Set(
    [current?.avatarKey, ...avatarRows.map((avatar) => avatar.r2Key)].filter(
      (key): key is string => Boolean(key),
    ),
  );
  let avatarKey = null;
  if (hasNewAvatar) {
    avatarKey = `avatars/${userId}/${crypto.randomUUID()}`;
    if (!avatar) throw new Error("Avatar file is missing");
    await putObject(avatarKey, avatar, avatar.type, avatar.size);
    update.avatarKey = avatarKey;
  } else if (removeAvatar) update.avatarKey = null;

  let result;
  try {
    result = await db.transaction(async (tx) => {
      if (hasNewAvatar || removeAvatar)
        await tx.delete(avatars).where(eq(avatars.userId, userId));
      const profileResult = await tx
        .update(profiles)
        .set({ ...update, updatedAt: new Date() })
        .where(eq(profiles.id, userId))
        .returning();
      if (hasNewAvatar && avatarKey && avatar)
        await tx.insert(avatars).values({
          userId,
          r2Key: avatarKey,
          mimeType: avatar?.type || "application/octet-stream",
          size: avatar?.size || 0,
        });
      return profileResult;
    });
  } catch (error) {
    if (avatarKey) await deleteObject(avatarKey).catch(() => {});
    throw error;
  }

  for (const oldAvatarKey of oldAvatarKeys)
    if (oldAvatarKey !== avatarKey)
      await deleteObject(oldAvatarKey).catch(() => {});
  return result[0];
}
