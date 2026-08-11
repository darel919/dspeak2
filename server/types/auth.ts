import type { User } from "@supabase/supabase-js";
import type { H3Event } from "h3";

export type AuthEvent = H3Event;
export type SupabaseUser = User;
export type OAuthProfileRecord = Record<string, unknown> & {
  avatarKey?: string | null;
};
export interface PendingOAuthSession {
  session: unknown;
  expiresAt: number;
}
export interface OAuthStorage {
  isServer: boolean;
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}
export interface PublicBytes {
  body: Uint8Array;
  contentType: string | null;
}
