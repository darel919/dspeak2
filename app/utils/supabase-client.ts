import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasTauriRuntimeMarker } from "../shared/desktop-capture.ts";

let supabaseClient: SupabaseClient | null = null;

export function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  if (!import.meta.client) return null;
  const config = useRuntimeConfig();
  const url = config.public.supabaseUrl;
  const anonKey = config.public.supabaseAnonKey;
  if (!url || !anonKey) return null;
  const desktop = hasTauriRuntimeMarker();
  supabaseClient = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: !desktop,
      ...(desktop ? { flowType: "pkce" as const } : {}),
    },
    realtime: { params: { eventsPerSecond: 40 } },
  });
  return supabaseClient;
}

export async function captureSupabaseSession() {
  if (!import.meta.client) return null;
  const client = getSupabaseClient();
  if (!client) return null;
  try {
    if (!hasTauriRuntimeMarker()) {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      if (accessToken && refreshToken) {
        const { error } = await client.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) {
          console.warn("[SupabaseClient] Unable to bind PKCE session:", error);
          return null;
        }
        params.delete("access_token");
        params.delete("refresh_token");
        const remaining = params.toString();
        const strippedUrl =
          window.location.pathname +
          window.location.search +
          (remaining ? `#${remaining}` : "");
        history.replaceState({}, "", strippedUrl);
        return client.auth.getSession();
      }
    }
    await client.auth.initialize();
    return client.auth.getSession();
  } catch (error) {
    console.warn("[SupabaseClient] Session capture failed:", error);
    return null;
  }
}

export async function bindSupabaseSession(
  accessToken: string,
  refreshToken = "",
) {
  const client = getSupabaseClient();
  if (!client || !accessToken) return false;
  try {
    const { error } = await client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    return !error;
  } catch {
    return false;
  }
}
