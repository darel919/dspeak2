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
