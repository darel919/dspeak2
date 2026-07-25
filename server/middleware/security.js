import { validateCsrfRequest } from "../utils/authentication.js";

const csrfExemptPaths = new Set([
  "/api/security/csp-report",
  "/api/session/handoff/start",
  "/api/session/handoff/exchange",
]);

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname;
  if (path.startsWith("/api")) {
    setHeader(event, "Cache-Control", "no-store");
    setHeader(event, "Pragma", "no-cache");
    const fetchSite = getHeader(event, "sec-fetch-site");
    if (
      ["same-site", "cross-site"].includes(fetchSite) &&
      ["GET", "HEAD"].includes(event.method)
    )
      throw createError({
        statusCode: 403,
        statusMessage: "Cross-origin resource request rejected",
      });
  }
  if (
    path.startsWith("/api") &&
    !["GET", "HEAD", "OPTIONS"].includes(event.method)
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
