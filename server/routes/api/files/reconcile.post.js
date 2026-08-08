import { eq } from "drizzle-orm";
import { db } from "../../../db/client.js";
import {
  avatars,
  chatFiles,
  librarySongs,
  roomImages,
  soundboards,
} from "../../../db/schema/index.js";
import { deleteObject, listObjects } from "../../../storage/r2.js";

const MINIMUM_AGE_MS = 2 * 60 * 60 * 1000;

async function isCommitted(key) {
  const rows = await Promise.all([
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
  return rows.some((result) => result.length > 0);
}

export default defineEventHandler(async (event) => {
  const expected = process.env.DSPEAK_CRON_SECRET;
  const supplied = getHeader(event, "authorization");
  if (!expected || supplied !== `Bearer ${expected}`)
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });

  const cutoff = Date.now() - MINIMUM_AGE_MS;
  const listed = await Promise.all(
    ["avatars/", "rooms/", "chat/", "soundboards/", "album-art/"].map(
      listObjects,
    ),
  );
  let removed = 0;
  for (const object of listed.flat()) {
    if (!object.lastModified || object.lastModified.getTime() > cutoff)
      continue;
    if (await isCommitted(object.key)) continue;
    await deleteObject(object.key);
    removed += 1;
  }
  return { success: true, removed };
});
