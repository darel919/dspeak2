import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ALBUM_ART_DIR = "data/album-art";

const ITUNES_SEARCH_URL = "https://itunes.apple.com/search";

export function normalizeSongTitle(str) {
  if (typeof str !== "string") return "";
  return str.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeArtist(str) {
  if (typeof str !== "string") return "";
  return str.trim().toLowerCase().replace(/\s+/g, " ");
}

export function getAlbumArtPath(songId) {
  return join(ALBUM_ART_DIR, `${songId}.jpg`);
}

export function ensureAlbumArtDir() {
  mkdirSync(ALBUM_ART_DIR, { recursive: true });
}

export async function processStreamMetadata(pb, title, artist) {
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
  pb,
  songId,
  channelId,
  userId,
  playedAt,
  duration,
) {
  if (!pb || !songId || !channelId) return null;

  return pb.collection("dspeak_stream_playlog").create({
    song: songId,
    channel: channelId,
    played_by: userId || null,
    played_at: playedAt || new Date().toISOString(),
    duration: duration || 0,
  });
}

async function lookupCachedSong(pb, normalizedTitle, normalizedArtist) {
  const escapedTitle = normalizedTitle.replace(/'/g, "\\'");
  const escapedArtist = normalizedArtist.replace(/'/g, "\\'");

  try {
    const record = await pb
      .collection("dspeak_lib_song")
      .getFirstListItem(
        `title = '${escapedTitle}' && artist = '${escapedArtist}'`,
      );

    return {
      songId: record.id,
      title: record.title,
      artist: record.artist,
      album: record.album || null,
      albumArtUrl: record.album_art_path
        ? `/api/assets/album-art/${record.id}`
        : record.itunes_artwork_url?.replace(
            "100x100bb.jpg",
            "192x192bb.jpg",
          ) || null,
      cached: true,
    };
  } catch (error) {
    if (error?.status === 404 || error?.response?.status === 404) return null;
    console.error("[StreamMetadata] cache lookup failed", error);
    return null;
  }
}

async function fetchFromItunes(
  pb,
  normalizedTitle,
  normalizedArtist,
  originalTitle,
  originalArtist,
) {
  const searchParams = new URLSearchParams({
    term: `${normalizedArtist} ${normalizedTitle}`,
    entity: "song",
    limit: "1",
    media: "music",
  });

  let itunesResult = null;
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

    const data = await response.json();
    if (!data.results || data.results.length === 0) {
      return buildFallbackResult(
        normalizedTitle,
        normalizedArtist,
        originalTitle,
        originalArtist,
      );
    }

    itunesResult = data.results[0];
  } catch (error) {
    console.error("[StreamMetadata] iTunes search error", error);
    return buildFallbackResult(
      normalizedTitle,
      normalizedArtist,
      originalTitle,
      originalArtist,
    );
  }

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
    albumArtPath: localArtPath,
    itunesArtworkUrl: artworkUrl,
  });

  const albumArtUrl = songId
    ? `/api/assets/album-art/${songId}`
    : itunesResult?.artworkUrl100?.replace("100x100bb.jpg", "192x192bb.jpg") ||
      null;

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
  normalizedTitle,
  normalizedArtist,
  originalTitle,
  originalArtist,
) {
  return {
    songId: null,
    title: originalTitle || normalizedTitle,
    artist: originalArtist || normalizedArtist,
    album: null,
    albumArtUrl: null,
    cached: false,
  };
}

async function downloadAlbumArt(url) {
  try {
    ensureAlbumArtDir();
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
    writeFileSync(filePath, buffer);
    return filePath;
  } catch (error) {
    console.error("[StreamMetadata] album art download error", error);
    return null;
  }
}

async function persistSongRecord(
  pb,
  { title, artist, album, albumArtPath, itunesArtworkUrl },
) {
  try {
    const record = await pb.collection("dspeak_lib_song").create({
      title,
      artist,
      album,
      album_art_path: albumArtPath,
      itunes_artwork_url: itunesArtworkUrl,
      last_updated: new Date().toISOString(),
    });
    return record.id;
  } catch (error) {
    console.error("[StreamMetadata] failed to persist song record", error);
    return null;
  }
}
