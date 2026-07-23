export function readerId(reader) {
  if (typeof reader === "string") return reader;
  if (reader && typeof reader === "object" && reader.id) {
    return String(reader.id);
  }
  return null;
}

export function readerIds(readers) {
  if (!Array.isArray(readers)) return [];
  return [...new Set(readers.map(readerId).filter(Boolean))];
}

export function hasReader(readers, userId) {
  if (!userId) return false;
  return readerIds(readers).includes(String(userId));
}

export function addReader(readers, user) {
  const userId = readerId(user);
  if (!userId || hasReader(readers, userId)) {
    return Array.isArray(readers) ? readers : [];
  }
  return [...(Array.isArray(readers) ? readers : []), user];
}

export function mergeReaders(currentReaders, nextReaders) {
  const currentById = new Map(
    (Array.isArray(currentReaders) ? currentReaders : [])
      .map((reader) => [readerId(reader), reader])
      .filter(([id]) => id),
  );
  return readerIds(nextReaders).map((id) => currentById.get(id) || id);
}
