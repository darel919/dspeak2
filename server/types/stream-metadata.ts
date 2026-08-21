import type { ExternalField } from "../../shared/types/external.ts";

export interface StreamMetadataCollection {
  getFirstListItem: (filter: string) => Promise<ExternalField>;
  create: (data: Record<string, unknown>) => Promise<ExternalField>;
}

export interface StreamMetadataDatabase {
  collection: (name: string) => StreamMetadataCollection;
}

export interface StreamSongResult {
  songId: string | null;
  title: string;
  artist: string;
  album: string | null;
  albumArtUrl: string | null;
  cached: boolean;
}

export interface ItunesSongRecord {
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  artworkUrl100?: string;
}

export interface SongRecordInput {
  title: string;
  artist: string;
  album: string | null;
  albumArtPath: string | null;
  itunesArtworkUrl: string | null;
}
