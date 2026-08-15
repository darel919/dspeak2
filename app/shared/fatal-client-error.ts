export const FATAL_CLIENT_ERROR_MESSAGE =
  "We encountered a fatal error and cannot recover. Please refresh the page.";

export type FatalClientErrorKind = "client-runtime" | "native-media-worker";

export type FatalRecoveryAction = "refresh-page" | "restart-app";

export interface FatalClientErrorDescriptor {
  kind: FatalClientErrorKind;
  title: string;
  message: string;
  recoveryAction: FatalRecoveryAction;
  recoveryLabel: string;
  code?: string;
  details?: Record<string, unknown>;
}

export const NATIVE_MEDIA_WORKER_FATAL_CODE = "MEDIA_WORKER_EXITED";

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

function errorCode(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  const nested =
    record.error && typeof record.error === "object"
      ? (record.error as Record<string, unknown>)
      : null;
  const code = record.code ?? nested?.code;
  return typeof code === "string" ? code : null;
}

export function isNativeMediaWorkerFatalError(error: unknown) {
  return errorCode(error) === NATIVE_MEDIA_WORKER_FATAL_CODE;
}

export function nativeMediaWorkerFatalDescriptor(
  details: Record<string, unknown> = {},
): FatalClientErrorDescriptor {
  return {
    kind: "native-media-worker",
    title: "Media engine crashed",
    message:
      "dSpeak's native media engine stopped unexpectedly. Voice, camera, and screen sharing cannot recover in this session. Restart dSpeak to continue.",
    recoveryAction: "restart-app",
    recoveryLabel: "Restart dSpeak",
    code: NATIVE_MEDIA_WORKER_FATAL_CODE,
    details,
  };
}

export function clientRuntimeFatalDescriptor(
  details: Record<string, unknown> = {},
): FatalClientErrorDescriptor {
  return {
    kind: "client-runtime",
    title: "Fatal error",
    message: FATAL_CLIENT_ERROR_MESSAGE,
    recoveryAction: "refresh-page",
    recoveryLabel: "Refresh page",
    details,
  };
}

export function classifyFatalClientError(
  error: unknown,
): FatalClientErrorDescriptor | null {
  if (isNativeMediaWorkerFatalError(error)) {
    const details =
      error && typeof error === "object"
        ? (error as Record<string, unknown>)
        : {};
    return nativeMediaWorkerFatalDescriptor(details);
  }
  if (isFatalClientError(error)) return clientRuntimeFatalDescriptor();
  return null;
}
