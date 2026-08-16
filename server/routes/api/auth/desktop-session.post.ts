import {
  getUserFromToken,
  verifySupabaseAccessToken,
  supabaseProjectRef,
  configuredSupabaseProjectRef,
  SupabaseTokenIssuerMismatchError,
} from "../../../auth/supabase.ts";
import {
  extractBearerToken,
  hasVerifiedBearerContext,
} from "../../../auth/middleware.ts";
import { provisionOAuthProfile } from "../../../auth/oauth-profile.ts";
import {
  profileRepository,
  EmailIdentityConflictError,
} from "../../../db/repositories/profiles.ts";
import { persistAuthenticatedSession } from "../../../utils/auth.ts";

function safeErrorDetails(error: unknown): {
  name: string;
  message: string;
} {
  return {
    name: error instanceof Error ? error.name : "unknown",
    message: error instanceof Error ? error.message : "unknown",
  };
}

function desktopAuthFailure(
  code: string,
  statusCode: number,
  error?: unknown,
): never {
  console.error(`[DesktopAuth] ${code}`, {
    statusCode,
    ...(error ? safeErrorDetails(error) : {}),
  });
  throw createError({ statusCode, statusMessage: code });
}

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig(event);
  const serverBuildCommit =
    typeof runtimeConfig.public?.appBuild?.shortCommit === "string"
      ? runtimeConfig.public.appBuild.shortCommit
      : "";
  if (serverBuildCommit)
    setHeader(event, "X-dSpeak-Build-Commit", serverBuildCommit);
  if (configuredSupabaseProjectRef)
    setHeader(event, "X-dSpeak-Supabase-Project", configuredSupabaseProjectRef);

  const requestId =
    getHeader(event, "x-dspeak-request-id") || crypto.randomUUID();
  setHeader(event, "X-dSpeak-Request-ID", requestId);

  const hasAuthorization = Boolean(getHeader(event, "authorization"));
  console.info("[DesktopAuth] DESKTOP_SESSION_REQUEST_RECEIVED", {
    requestId,
    hasAuthorization,
    projectRef: configuredSupabaseProjectRef,
  });
  console.info("[DesktopAuth] DESKTOP_SESSION_BEARER_PRESENT", {
    hasAuthorization,
  });

  const token = extractBearerToken(event);
  if (!token) return desktopAuthFailure("DESKTOP_SESSION_MISSING_BEARER", 401);

  let payload: Awaited<ReturnType<typeof verifySupabaseAccessToken>>;
  try {
    payload =
      hasVerifiedBearerContext(event) &&
      event.context.authToken === token &&
      event.context.authPayload
        ? event.context.authPayload
        : await verifySupabaseAccessToken(token);
  } catch (error) {
    if (error instanceof SupabaseTokenIssuerMismatchError) {
      console.error("[DesktopAuth] DESKTOP_SUPABASE_PROJECT_MISMATCH", {
        tokenProjectRef: supabaseProjectRef(error.receivedIssuer || ""),
        configuredProjectRef: configuredSupabaseProjectRef,
      });
      return desktopAuthFailure("DESKTOP_SUPABASE_PROJECT_MISMATCH", 401);
    }
    return desktopAuthFailure("DESKTOP_SESSION_TOKEN_INVALID", 401, error);
  }
  if (!payload.sub)
    return desktopAuthFailure("DESKTOP_SESSION_TOKEN_INVALID", 401);
  console.info("[DesktopAuth] DESKTOP_SESSION_TOKEN_VERIFIED", {
    hasSubject: Boolean(payload.sub),
    tokenIssuerProjectRef: supabaseProjectRef(String(payload.iss || "")),
    configuredProjectRef: configuredSupabaseProjectRef,
  });

  const tokenProjectRef = supabaseProjectRef(String(payload.iss || ""));
  if (
    tokenProjectRef &&
    configuredSupabaseProjectRef &&
    tokenProjectRef !== configuredSupabaseProjectRef
  ) {
    console.error("[DesktopAuth] DESKTOP_SUPABASE_PROJECT_MISMATCH", {
      tokenProjectRef,
      configuredProjectRef: configuredSupabaseProjectRef,
    });
    return desktopAuthFailure("DESKTOP_SUPABASE_PROJECT_MISMATCH", 401);
  }

  let supabaseUser;
  try {
    supabaseUser = await getUserFromToken(token);
  } catch (error) {
    return desktopAuthFailure(
      "DESKTOP_SESSION_SUPABASE_USER_LOOKUP_FAILED",
      502,
      error,
    );
  }
  console.info("[DesktopAuth] DESKTOP_SESSION_SUPABASE_USER_RESOLVED", {
    hasUser: Boolean(supabaseUser),
  });
  if (!supabaseUser || supabaseUser.id !== payload.sub)
    return desktopAuthFailure("DESKTOP_SESSION_USER_MISMATCH", 401);

  console.info("[DesktopAuth] DESKTOP_SESSION_PROFILE_PROVISION_STARTED");
  try {
    await provisionOAuthProfile(supabaseUser);
  } catch (error) {
    if (error instanceof EmailIdentityConflictError) {
      return desktopAuthFailure(
        "DESKTOP_ACCOUNT_EMAIL_IDENTITY_CONFLICT",
        409,
        error,
      );
    }
    return desktopAuthFailure("DESKTOP_PROFILE_PROVISION_FAILED", 500, error);
  }
  console.info("[DesktopAuth] DESKTOP_SESSION_PROFILE_PROVISION_SUCCEEDED");

  let profile;
  try {
    profile = await profileRepository.findById(supabaseUser.id);
  } catch (error) {
    return desktopAuthFailure("DESKTOP_PROFILE_PROVISION_FAILED", 500, error);
  }
  console.info("[DesktopAuth] DESKTOP_SESSION_PROFILE_RESOLVED", {
    hasProfile: Boolean(profile),
  });
  if (!profile) return desktopAuthFailure("DESKTOP_PROFILE_NOT_FOUND", 500);

  try {
    const deviceId =
      getHeader(event, "x-device-id") ||
      getHeader(event, "x-dspeak-device") ||
      "unknown";
    const session = await persistAuthenticatedSession(
      event,
      supabaseUser.id,
      deviceId,
      token,
      profile,
      { persistCookie: false },
    );
    console.info("[DesktopAuth] DESKTOP_SESSION_CREATED");
    return session;
  } catch (error) {
    return desktopAuthFailure("DESKTOP_SESSION_PERSIST_FAILED", 500, error);
  }
});
