import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { usePocketBaseAdmin } from "../../../../utils/pocketbase.js";

const ALBUM_ART_DIR = "data/album-art";

export default defineEventHandler(async (event) => {
  const songId = getRouterParam(event, "songId");
  if (!songId) {
    throw createError({ statusCode: 400, statusMessage: "songId is required" });
  }

  const pb = await usePocketBaseAdmin();

  let song;
  try {
    song = await pb.collection("dspeak_lib_song").getOne(songId);
  } catch (error) {
    if (error?.status === 404 || error?.response?.status === 404) {
      throw createError({ statusCode: 404, statusMessage: "Song not found" });
    }
    throw error;
  }

  const filePath = join(ALBUM_ART_DIR, `${songId}.jpg`);

  try {
    const imageBuffer = await readFile(filePath);
    setHeader(event, "Cache-Control", "public, max-age=86400");
    setHeader(event, "Content-Type", "image/jpeg");
    return imageBuffer;
  } catch {
    if (song.itunes_artwork_url) {
      return sendRedirect(event, song.itunes_artwork_url, 302);
    }
    throw createError({
      statusCode: 404,
      statusMessage: "Album art not available",
    });
  }
});
