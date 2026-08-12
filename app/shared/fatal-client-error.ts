export const FATAL_CLIENT_ERROR_MESSAGE =
  "We encountered a fatal error and cannot recover. Please refresh the page.";

const FATAL_CLIENT_ERROR_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /loading chunk [\d-]+ failed/i,
  /chunkloaderror/i,
];

export function isFatalClientError(error: unknown) {
  const record =
    error && typeof error === "object"
      ? (error as { name?: unknown; message?: unknown })
      : null;
  const message =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === "string"
        ? error
        : `${record?.name || ""} ${record?.message || ""}`;

  return FATAL_CLIENT_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}
