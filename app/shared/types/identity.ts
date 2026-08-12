export interface IdentityProfile {
  id: string;
  name?: string;
  username?: string;
  email?: string;
  [key: string]: unknown;
}

export interface IdentityRequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface IdentityApiResult {
  nickname?: string;
  nicknames?: Record<string, string>;
  [key: string]: unknown;
}
