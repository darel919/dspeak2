export default defineEventHandler((event) => {
  setHeader(event, "X-Content-Type-Options", "nosniff");
  setHeader(event, "Referrer-Policy", "strict-origin-when-cross-origin");
  setHeader(event, "X-Frame-Options", "DENY");
  setHeader(
    event,
    "Content-Security-Policy",
    "base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
  );
  if (process.env.NODE_ENV === "production")
    setHeader(
      event,
      "Content-Security-Policy-Report-Only",
      [
        "default-src 'self'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data:",
        "media-src 'self' blob:",
        "worker-src 'self' blob:",
        "connect-src 'self' https: wss:",
        "form-action 'self'",
      ].join("; "),
    );
  setHeader(
    event,
    "Permissions-Policy",
    "camera=(self), microphone=(self), display-capture=(self), geolocation=()",
  );
  if (process.env.NODE_ENV === "production")
    setHeader(event, "Strict-Transport-Security", "max-age=31536000");
  const path = getRequestURL(event).pathname;
  if (path.startsWith("/api/session"))
    setHeader(event, "Cache-Control", "no-store");
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
    const originlessAllowed =
      process.env.DSPEAK_ALLOW_ORIGINLESS_HTTP === "true";
    if (
      fetchSite === "cross-site" ||
      (fetchSite !== "same-origin" && !originAllowed && !originlessAllowed)
    )
      throw createError({
        statusCode: 403,
        statusMessage: "Cross-site request rejected",
      });
  }
});
