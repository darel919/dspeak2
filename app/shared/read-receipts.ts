import type { ReaderValue } from "./types/shared-utilities.ts";
import { isExternalRecord, isExternalString } from "./types/boundary.ts";

export function readerId<T>(reader: T): string | null {
  if (isExternalString(reader)) return reader;
  if (isExternalRecord(reader) && reader.id) {
    return String(reader.id);
  }
  return null;
}

export function readerIds<T>(readers: T): string[] {
  if (!Array.isArray(readers)) return [];
  return [
    ...new Set(readers.map(readerId).filter((id): id is string => Boolean(id))),
  ];
}

export function hasReader<T>(readers: T, userId: string | number | null) {
  if (!userId) return false;
  return readerIds(readers).includes(String(userId));
}

export function addReader(
  readers: ReaderValue[] | undefined,
  user: ReaderValue,
) {
  const userId = readerId(user);
  if (!userId || hasReader(readers, userId)) {
    return Array.isArray(readers) ? readers : [];
  }
  return [...(Array.isArray(readers) ? readers : []), user];
}

export function mergeReaders(
  currentReaders: ReaderValue[] | undefined,
  nextReaders: ReaderValue[] | undefined,
) {
  const currentById = new Map<string, ReaderValue>(
    (Array.isArray(currentReaders) ? currentReaders : [])
      .map((reader) => [readerId(reader), reader])
      .filter((entry): entry is [string, ReaderValue] => Boolean(entry[0])),
  );
  return readerIds(nextReaders).map((id) => currentById.get(id) || id);
}
