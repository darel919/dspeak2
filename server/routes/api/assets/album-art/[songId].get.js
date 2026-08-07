import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { assetsRepository } from "../../../../db/repositories/assets.js";

const ALBUM_ART_DIR = "data/album-art";

export default defineEventHandler(async (event) => {
  const songId = getRouterParam(event, "songId");
  if (!songId) {
    throw createError({ statusCode: 400, statusMessage: "songId is required" });
  }

  const song = await assetsRepository.getSong(songId);
  if (!song) {
    throw createError({ statusCode: 404, statusMessage: "Song not found" });
  }

  const filePath = join(ALBUM_ART_DIR, `${songId}.jpg`);

  try {
    const imageBuffer = await readFile(filePath);
    setHeader(event, "Cache-Control", "public, max-age=86400");
    setHeader(event, "Content-Type", "image/jpeg");
    return imageBuffer;
  } catch {
    if (song.artworkKey) {
      const { createDownloadUrl } = await import("../../../../storage/r2.js");
      const url = await createDownloadUrl(song.artworkKey);
      return sendRedirect(event, url, 302);
    }
    throw createError({
      statusCode: 404,
      statusMessage: "Album art not available",
    });
  }
});
