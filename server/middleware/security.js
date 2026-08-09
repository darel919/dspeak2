import { validateCsrfRequest } from "../utils/auth.js";

const csrfExemptPaths = new Set([
  "/api/security/csp-report",
  "/api/auth/callback-session",
  "/api/auth/session",
]);
const oauthCallbackPaths = new Set(["/api/auth/callback"]);
const internalCronPaths = new Set(["/api/internal/push-dispatch"]);

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname;
  const ingestAuthSecret = process.env.DSPEAK_INGEST_AUTH_SECRET || "";
  const internalIngestAuth =
    path === "/api/dj/ingest-auth" &&
    Boolean(ingestAuthSecret) &&
    getQuery(event).secret === ingestAuthSecret;
  if (path.startsWith("/api")) {
    setHeader(event, "Cache-Control", "no-store");
    setHeader(event, "Pragma", "no-cache");
    const fetchSite = getHeader(event, "sec-fetch-site");
    if (
      ["same-site", "cross-site"].includes(fetchSite) &&
      ["GET", "HEAD"].includes(event.method) &&
      !oauthCallbackPaths.has(path) &&
      !internalCronPaths.has(path)
    )
      throw createError({
        statusCode: 403,
        statusMessage: "Cross-origin resource request rejected",
      });
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
        new URL(origin).origin === new URL(expectedOrigin).origin;
    } catch {
      originAllowed = false;
    }
    if (
      fetchSite === "cross-site" ||
      (fetchSite !== "same-origin" && !originAllowed)
    )
      throw createError({
        statusCode: 403,
        statusMessage: "Cross-site request rejected",
      });
    if (!csrfExemptPaths.has(path) && !(await validateCsrfRequest(event)))
      throw createError({
        statusCode: 403,
        statusMessage: "CSRF validation failed",
      });
  }
});
