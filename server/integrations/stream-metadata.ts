import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ItunesSongRecord,
  SongRecordInput,
  StreamMetadataDatabase,
  StreamSongResult,
} from "../types/stream-metadata.ts";
import {
  parseExternalNumber,
  parseExternalRecord,
  parseExternalString,
  type ExternalField,
} from "../../shared/types/external.ts";

const ALBUM_ART_DIR = "data/album-art";

const ITUNES_SEARCH_URL = "https://itunes.apple.com/search";

export function normalizeSongTitle(str: ExternalField | undefined): string {
  const text = parseExternalString(str);
  return text ? text.trim().toLowerCase().replace(/\s+/g, " ") : "";
}

export function normalizeArtist(str: ExternalField | undefined): string {
  const text = parseExternalString(str);
  return text ? text.trim().toLowerCase().replace(/\s+/g, " ") : "";
}

export function getAlbumArtPath(songId: string): string {
  return join(ALBUM_ART_DIR, `${songId}.jpg`);
}

function parseItunesSongRecord(
  value: ExternalField | undefined,
): ItunesSongRecord | null {
  const record = parseExternalRecord(value);
  if (!record) return null;
  return {
    trackName: parseExternalString(record.trackName) ?? undefined,
    artistName: parseExternalString(record.artistName) ?? undefined,
    collectionName: parseExternalString(record.collectionName) ?? undefined,
    artworkUrl100: parseExternalString(record.artworkUrl100) ?? undefined,
  };
}

export async function ensureAlbumArtDir() {
  await mkdir(ALBUM_ART_DIR, { recursive: true });
}

export async function processStreamMetadata(
  pb: StreamMetadataDatabase,
  title: string,
  artist: string,
): Promise<StreamSongResult> {
  const normalizedTitle = normalizeSongTitle(title);
  const normalizedArtist = normalizeArtist(artist);

  if (!normalizedTitle || !normalizedArtist) {
    return {
      songId: null,
      title,
      artist,
      album: null,
      albumArtUrl: null,
      cached: false,
    };
  }

  const existing = await lookupCachedSong(
    pb,
    normalizedTitle,
    normalizedArtist,
  );
  if (existing) return existing;

  return fetchFromItunes(pb, normalizedTitle, normalizedArtist, title, artist);
}

export async function logPlayToHistory(
  pb: StreamMetadataDatabase,
  songId: string | null | undefined,
  channelId: string | null | undefined,
  userId: string | null | undefined,
  playedAt: string | null | undefined,
  duration: number | null | undefined,
): Promise<ExternalField> {
  if (!pb || !songId || !channelId) return null;

  return pb.collection("dspeak_stream_playlog").create({
    song: songId,
    channel: channelId,
    played_by: userId || null,
    played_at: playedAt || new Date().toISOString(),
    duration: duration || 0,
  });
}

async function lookupCachedSong(
  pb: StreamMetadataDatabase,
  normalizedTitle: string,
  normalizedArtist: string,
): Promise<StreamSongResult | null> {
  const escapedTitle = normalizedTitle.replace(/'/g, "''");
  const escapedArtist = normalizedArtist.replace(/'/g, "''");

  try {
    const record = await pb
      .collection("dspeak_lib_song")
      .getFirstListItem(
        `title = '${escapedTitle}' && artist = '${escapedArtist}'`,
      );

    const song = parseExternalRecord(record);
    if (!song) return null;
    const id = parseExternalString(song.id);
    const title = parseExternalString(song.title);
    const artist = parseExternalString(song.artist);
    const album = parseExternalString(song.album);
    const albumArtPath = parseExternalString(song.album_art_path);
    const artworkUrl = parseExternalString(song.itunes_artwork_url);
    if (!id || !title || !artist) return null;
    return {
      songId: id,
      title,
      artist,
      album,
      albumArtUrl: albumArtPath
        ? `/api/assets/album-art/${id}`
        : artworkUrl?.replace("100x100bb.jpg", "192x192bb.jpg") || null,
      cached: true,
    };
  } catch (error) {
    const value = parseExternalRecord(error);
    const response = parseExternalRecord(value?.response);
    const status = parseExternalNumber(value?.status);
    const responseStatus = parseExternalNumber(response?.status);
    if (status === 404 || responseStatus === 404) return null;
    console.error("[StreamMetadata] cache lookup failed", error);
    return null;
  }
}

async function fetchFromItunes(
  pb: StreamMetadataDatabase,
  normalizedTitle: string,
  normalizedArtist: string,
  originalTitle: string,
  originalArtist: string,
): Promise<StreamSongResult> {
  const searchParams = new URLSearchParams({
    term: `${normalizedArtist} ${normalizedTitle}`,
    entity: "song",
    limit: "1",
    media: "music",
  });

  let itunesResult: ItunesSongRecord | null = null;
  try {
    const response = await fetch(`${ITUNES_SEARCH_URL}?${searchParams}`);
    if (!response.ok) {
      console.warn(
        "[StreamMetadata] iTunes search failed with status",
        response.status,
      );
      return buildFallbackResult(
        normalizedTitle,
        normalizedArtist,
        originalTitle,
        originalArtist,
      );
    }

    const data = parseExternalRecord(await response.json());
    const result = data && Array.isArray(data.results) ? data.results[0] : null;
    const parsedResult = parseItunesSongRecord(result);
    if (!parsedResult) {
      return buildFallbackResult(
        normalizedTitle,
        normalizedArtist,
        originalTitle,
        originalArtist,
      );
    }

    itunesResult = parsedResult;
  } catch (error) {
    console.error("[StreamMetadata] iTunes search error", error);
    return buildFallbackResult(
      normalizedTitle,
      normalizedArtist,
      originalTitle,
      originalArtist,
    );
  }

  if (!itunesResult)
    return buildFallbackResult(
      normalizedTitle,
      normalizedArtist,
      originalTitle,
      originalArtist,
    );
  const itunesTitle = itunesResult.trackName || originalTitle;
  const itunesArtist = itunesResult.artistName || originalArtist;
  const album = itunesResult.collectionName || null;
  const artworkUrl = itunesResult.artworkUrl100 || null;

  let localArtPath = null;
  if (artworkUrl) {
    const highResUrl = artworkUrl.replace("100x100bb.jpg", "192x192bb.jpg");
    localArtPath = await downloadAlbumArt(highResUrl);
  }

  const songId = await persistSongRecord(pb, {
    title: normalizeSongTitle(itunesTitle),
    artist: normalizeArtist(itunesArtist),
    album,
    albumArtPath: null,
    itunesArtworkUrl: artworkUrl,
  });

  let albumArtUrl = null;
  if (songId && localArtPath) {
    const destPath = getAlbumArtPath(songId);
    try {
      await ensureAlbumArtDir();
      const data = await readFile(localArtPath);
      await writeFile(destPath, data);
      await unlink(localArtPath).catch(() => {});
      albumArtUrl = `/api/assets/album-art/${songId}`;
    } catch {
      albumArtUrl =
        artworkUrl?.replace("100x100bb.jpg", "192x192bb.jpg") || null;
    }
  } else if (songId) {
    albumArtUrl = artworkUrl?.replace("100x100bb.jpg", "192x192bb.jpg") || null;
  }

  return {
    songId,
    title: normalizeSongTitle(itunesTitle),
    artist: normalizeArtist(itunesArtist),
    album,
    albumArtUrl,
    cached: false,
  };
}

function buildFallbackResult(
  normalizedTitle: string,
  normalizedArtist: string,
  originalTitle: string,
  originalArtist: string,
): StreamSongResult {
  return {
    songId: null,
    title: originalTitle || normalizedTitle,
    artist: originalArtist || normalizedArtist,
    album: null,
    albumArtUrl: null,
    cached: false,
  };
}

async function downloadAlbumArt(url: string): Promise<string | null> {
  try {
    await ensureAlbumArtDir();
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(
        "[StreamMetadata] album art download failed",
        response.status,
      );
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const tempId = crypto.randomUUID();
    const filePath = getAlbumArtPath(tempId);
    await writeFile(filePath, buffer);
    return filePath;
  } catch (error) {
    console.error("[StreamMetadata] album art download error", error);
    return null;
  }
}

async function persistSongRecord(
  pb: StreamMetadataDatabase,
  { title, artist, album, albumArtPath, itunesArtworkUrl }: SongRecordInput,
): Promise<string | null> {
  try {
    const record = await pb.collection("dspeak_lib_song").create({
      title,
      artist,
      album,
      album_art_path: albumArtPath,
      itunes_artwork_url: itunesArtworkUrl,
      last_updated: new Date().toISOString(),
    });
    const value = parseExternalRecord(record);
    return parseExternalString(value?.id);
  } catch (error) {
    console.error("[StreamMetadata] failed to persist song record", error);
    return null;
  }
}
