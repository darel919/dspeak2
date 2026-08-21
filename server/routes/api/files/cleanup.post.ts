import { eq } from "drizzle-orm";
import { requireAuth } from "../../../auth/middleware.ts";
import { parseExternalRecord } from "../../../../shared/types/external.ts";
import { db } from "../../../db/client.ts";
import {
  avatars,
  chatFiles,
  librarySongs,
  roomImages,
  roomSoundboards,
  soundboards,
} from "../../../db/schema/index.ts";
import { deleteObject } from "../../../storage/r2.ts";
import { verifyUploadCleanupToken } from "../../../storage/upload-cleanup-token.ts";

async function committedUploadExists(key: string): Promise<boolean> {
  const matches = await Promise.all([
    db
      .select({ id: avatars.id })
      .from(avatars)
      .where(eq(avatars.r2Key, key))
      .limit(1),
    db
      .select({ id: roomImages.id })
      .from(roomImages)
      .where(eq(roomImages.r2Key, key))
      .limit(1),
    db
      .select({ id: chatFiles.id })
      .from(chatFiles)
      .where(eq(chatFiles.r2Key, key))
      .limit(1),
    db
      .select({ id: soundboards.id })
      .from(soundboards)
      .where(eq(soundboards.audioKey, key))
      .limit(1),
    db
      .select({ id: roomSoundboards.id })
      .from(roomSoundboards)
      .where(eq(roomSoundboards.audioKey, key))
      .limit(1),
    db
      .select({ id: roomSoundboards.id })
      .from(roomSoundboards)
      .where(eq(roomSoundboards.iconImageKey, key))
      .limit(1),
    db
      .select({ id: librarySongs.id })
      .from(librarySongs)
      .where(eq(librarySongs.audioKey, key))
      .limit(1),
    db
      .select({ id: librarySongs.id })
      .from(librarySongs)
      .where(eq(librarySongs.artworkKey, key))
      .limit(1),
  ]);
  return matches.some((rows) => rows.length > 0);
}

export default defineEventHandler(async (event) => {
  await requireAuth(event);
  const body = parseExternalRecord(await readBody(event));
  const claims = verifyUploadCleanupToken(
    body?.cleanupToken,
    event.context.user.id,
  );
  if (!claims)
    throw createError({
      statusCode: 403,
      statusMessage: "Upload cleanup is not authorized",
    });

  const { key } = claims;
  if (await committedUploadExists(key))
    throw createError({
      statusCode: 409,
      statusMessage: "Committed uploads cannot be cleaned up",
    });

  await deleteObject(key);
  return { success: true };
});
