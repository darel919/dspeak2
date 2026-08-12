import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { assetsRepository } from "../../../../db/repositories/assets.ts";

type AlbumSong = NonNullable<
  Awaited<ReturnType<typeof assetsRepository.getSong>>
>;
interface SongCacheEntry {
  value: AlbumSong;
  expiresAt: number;
}

const ALBUM_ART_DIR = "data/album-art";

const SONG_CACHE_TTL_MS = 3_600_000;
const SONG_CACHE_MAX = 500;
const songCache = new Map<string, SongCacheEntry>();

function evictExpiredSongs() {
  const now = Date.now();
  for (const [key, entry] of songCache) {
    if (entry.expiresAt <= now) songCache.delete(key);
  }
}

function cacheSong(songId: string, song: AlbumSong | null): void {
  if (!song) return;
  if (songCache.size >= SONG_CACHE_MAX) evictExpiredSongs();
  if (songCache.size >= SONG_CACHE_MAX) {
    const oldest = songCache.keys().next().value;
    if (oldest) songCache.delete(oldest);
  }
  songCache.set(songId, {
    value: song,
    expiresAt: Date.now() + SONG_CACHE_TTL_MS,
  });
}

function getCachedSong(songId: string): AlbumSong | undefined {
  const entry = songCache.get(songId);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    songCache.delete(songId);
    return undefined;
  }
  return entry.value;
}

export default defineEventHandler(async (event) => {
  const songId = getRouterParam(event, "songId");
  if (!songId) {
    throw createError({ statusCode: 400, statusMessage: "songId is required" });
  }

  let song = getCachedSong(songId);
  if (song === undefined) {
    const loadedSong = await assetsRepository.getSong(songId);
    if (loadedSong) {
      song = loadedSong;
      cacheSong(songId, loadedSong);
    }
  }
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
      const { createDownloadUrl } = await import("../../../../storage/r2.ts");
      const url = await createDownloadUrl(song.artworkKey);
      return sendRedirect(event, url, 302);
    }
    throw createError({
      statusCode: 404,
      statusMessage: "Album art not available",
    });
  }
});
