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
  if (!("user" in record)) return false;
  const user = record.user;
  if (user === null || user === undefined) return true;
  if (typeof user !== "object") return false;
  return (
    typeof (user as { id?: unknown }).id !== "undefined" ||
    "user_metadata" in user
  );
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
