export interface AuthMetadata {
  id?: string | number;
  [key: string]: unknown;
}

export interface AuthUserRecord {
  user_metadata?: AuthMetadata;
  [key: string]: unknown;
}

export interface AuthSessionRecord {
  user?: AuthUserRecord | null;
  [key: string]: unknown;
}

export function isAuthSessionRecord(
  value: unknown,
): value is AuthSessionRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const user = record.user;
  if (!user || typeof user !== "object") return false;
  const metadata = (user as Record<string, unknown>).user_metadata;
  if (!metadata || typeof metadata !== "object") return false;
  const id = (metadata as Record<string, unknown>).id;
  return typeof id === "string" && id.length > 0;
}

export interface AuthTokenResponse {
  accessToken: string;
  refreshToken: string;
}

export interface AuthCallbackResponse {
  code: string;
}

export interface AuthStorageValue {
  id?: string | number;
  [key: string]: unknown;
}

export type DesktopAuthFailureStage =
  | "oauth-browser"
  | "oauth-callback"
  | "oauth-state"
  | "oauth-code-exchange"
  | "session-bridge"
  | "server-session"
  | "session-payload"
  | "session-restore"
  | "client-config"
  | "unknown";

export type DesktopAuthError = Error & {
  code: string;
  stage: DesktopAuthFailureStage;
  httpStatus: number;
  serverDiagnostic: string;
  serverBuildCommit: string;
  serverProjectRef: string;
  clientBuildCommit: string;
  clientProjectRef: string;
  requestId: string;
  transport: "webview-fetch" | "tauri-http";
};
