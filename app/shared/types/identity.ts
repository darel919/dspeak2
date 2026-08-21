export interface IdentityProfile {
  id: string;
  name?: string;
  username?: string;
  email?: string;
  [key: string]: unknown;
}

export interface IdentityRequestOptions {
  method?: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
  body?:
    | BodyInit
    | Record<string, string | number | boolean | null | undefined>
    | null;
  headers?: Record<string, string>;
}

export interface IdentityApiResult {
  nickname?: string;
  nicknames?: Record<string, string>;
  [key: string]: unknown;
}
