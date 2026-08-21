import { isExternalRecord, isExternalString } from "./boundary.ts";

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

export function isAuthSessionRecord<T>(
  value: T,
): value is T & AuthSessionRecord {
  if (!isExternalRecord(value)) return false;
  const record = value;
  const user = record.user;
  if (!isExternalRecord(user)) return false;
  const metadata = user.user_metadata;
  if (!isExternalRecord(metadata)) return false;
  const id = metadata.id;
  return isExternalString(id) && id.length > 0;
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

export type DesktopSessionResponseOrigin =
  "application" | "vercel-edge" | "upstream-edge" | "unknown";

export type DesktopAuthFailureStage =
  | "oauth-browser"
  | "oauth-callback"
  | "oauth-state"
  | "oauth-code-exchange"
  | "session-bridge"
  | "session-transport"
  | "edge-gateway"
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
  responseOrigin: DesktopSessionResponseOrigin;
  provider: string;
  clientBuildCommit: string;
  clientProjectRef: string;
  requestId: string;
  transport: "webview-fetch" | "tauri-http";
  requestUrl: string;
  responseUrl: string;
  redirected: boolean;
  statusText: string;
  retryAfter: string;
  serverHeader: string;
  viaHeader: string;
  vercelRequestId: string;
  cloudflareRay: string;
  contentType: string;
  vercelMitigated: string;
};
