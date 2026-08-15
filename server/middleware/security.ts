import {
  ensureVerifiedBearer,
  extractBearerToken,
  hasVerifiedBearerContext,
} from "../auth/middleware.ts";
import { validateCsrfRequest } from "../utils/auth.ts";
import type { H3Event } from "h3";

const csrfExemptPaths = new Set([
  "/api/security/csp-report",
  "/api/auth/callback-session",
  "/api/auth/session",
]);
const oauthCallbackPaths = new Set(["/api/auth/callback"]);
const internalCronPaths = new Set(["/api/internal/push-dispatch"]);

function rejectRequest(
  event: H3Event,
  path: string,
  verifiedBearer: boolean,
  statusMessage: string,
): never {
  console.warn("[Security] REQUEST_REJECTED", {
    method: event.method,
    path,
    reason: statusMessage,
    verifiedBearer,
  });
  throw createError({ statusCode: 403, statusMessage });
}

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname;
  const ingestAuthSecret = process.env.DSPEAK_INGEST_AUTH_SECRET || "";
  const internalIngestAuth =
    path === "/api/dj/ingest-auth" &&
    Boolean(ingestAuthSecret) &&
    getQuery(event).secret === ingestAuthSecret;
  let verifiedBearer = hasVerifiedBearerContext(event);
  if (!verifiedBearer && extractBearerToken(event)) {
    try {
      verifiedBearer = Boolean(await ensureVerifiedBearer(event));
    } catch (error) {
      console.warn("[Security] BEARER_VERIFICATION_FAILED", {
        name: error instanceof Error ? error.name : "unknown",
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  if (path.startsWith("/api")) {
    setHeader(event, "Cache-Control", "no-store");
    setHeader(event, "Pragma", "no-cache");
    const fetchSite = getHeader(event, "sec-fetch-site");
    if (
      Boolean(fetchSite && ["same-site", "cross-site"].includes(fetchSite)) &&
      ["GET", "HEAD"].includes(event.method) &&
      !verifiedBearer &&
      !oauthCallbackPaths.has(path) &&
      !internalCronPaths.has(path)
    )
      rejectRequest(
        event,
        path,
        verifiedBearer,
        "Cross-origin resource request rejected",
      );
  }
  if (
    path.startsWith("/api") &&
    !["GET", "HEAD", "OPTIONS"].includes(event.method) &&
    !internalIngestAuth &&
    !internalCronPaths.has(path)
  ) {
    const fetchSite = getHeader(event, "sec-fetch-site");
    const origin = getHeader(event, "origin");
    const expectedOrigin =
      process.env.DSPEAK_PUBLIC_ORIGIN || getRequestURL(event).origin;
    let originAllowed = false;
    try {
      originAllowed =
        Boolean(origin) &&
        new URL(origin || "").origin === new URL(expectedOrigin || "").origin;
    } catch {
      originAllowed = false;
    }
    if (
      !verifiedBearer &&
      (fetchSite === "cross-site" ||
        (fetchSite !== "same-origin" && !originAllowed))
    )
      rejectRequest(event, path, verifiedBearer, "Cross-site request rejected");
    if (!csrfExemptPaths.has(path) && !(await validateCsrfRequest(event)))
      rejectRequest(event, path, verifiedBearer, "CSRF validation failed");
  }
});
