export const FATAL_CLIENT_ERROR_MESSAGE =
  "We encountered a fatal error and cannot recover. Please refresh the page.";

import { isExternalRecord, isExternalString } from "./types/boundary.ts";

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

export function isFatalClientError<T>(error: T) {
  const record = isExternalRecord(error) ? error : null;
  const message =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : isExternalString(error)
        ? error
        : `${String(record?.name || "")} ${String(record?.message || "")}`;

  return FATAL_CLIENT_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function errorCode<T>(error: T) {
  const record = isExternalRecord(error) ? error : null;
  if (!record) return null;
  const nested = isExternalRecord(record.error) ? record.error : null;
  const code = record.code ?? nested?.code;
  return isExternalString(code) ? code : null;
}

export function isNativeMediaWorkerFatalError<T>(error: T) {
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

export function classifyFatalClientError<T>(
  error: T,
): FatalClientErrorDescriptor | null {
  if (isNativeMediaWorkerFatalError(error)) {
    const details = isExternalRecord(error) ? error : {};
    return nativeMediaWorkerFatalDescriptor(details);
  }
  if (isFatalClientError(error)) return clientRuntimeFatalDescriptor();
  return null;
}
