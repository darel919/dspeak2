import { eq } from "drizzle-orm";
import { avatars, profiles } from "../db/schema/index.ts";
import { deleteObject, putObject } from "../storage/r2.ts";

export async function updateProfileAvatar({ db, userId, body, update }) {
  const hasNewAvatar = body.avatar instanceof File && body.avatar.size;
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
      Boolean,
    ),
  );
  let avatarKey = null;
  if (hasNewAvatar) {
    avatarKey = `avatars/${userId}/${crypto.randomUUID()}`;
    await putObject(avatarKey, body.avatar, body.avatar.type, body.avatar.size);
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
      if (hasNewAvatar)
        await tx.insert(avatars).values({
          userId,
          r2Key: avatarKey,
          mimeType: body.avatar.type,
          size: body.avatar.size,
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
