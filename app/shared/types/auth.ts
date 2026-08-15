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
