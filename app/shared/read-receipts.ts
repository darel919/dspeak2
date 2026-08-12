import type { ReaderValue } from "./types/shared-utilities.ts";

export function readerId(reader: ReaderValue): string | null {
  if (typeof reader === "string") return reader;
  if (reader && typeof reader === "object" && reader.id) {
    return String(reader.id);
  }
  return null;
}

export function readerIds(readers: unknown): string[] {
  if (!Array.isArray(readers)) return [];
  return [
    ...new Set(readers.map(readerId).filter((id): id is string => Boolean(id))),
  ];
}

export function hasReader(readers: unknown, userId: string | number | null) {
  if (!userId) return false;
  return readerIds(readers).includes(String(userId));
}

export function addReader(readers: ReaderValue[], user: ReaderValue) {
  const userId = readerId(user);
  if (!userId || hasReader(readers, userId)) {
    return Array.isArray(readers) ? readers : [];
  }
  return [...(Array.isArray(readers) ? readers : []), user];
}

export function mergeReaders(
  currentReaders: ReaderValue[],
  nextReaders: ReaderValue[],
) {
  const currentById = new Map<string, ReaderValue>(
    (Array.isArray(currentReaders) ? currentReaders : [])
      .map((reader) => [readerId(reader), reader])
      .filter((entry): entry is [string, ReaderValue] => Boolean(entry[0])),
  );
  return readerIds(nextReaders).map((id) => currentById.get(id) || id);
}
