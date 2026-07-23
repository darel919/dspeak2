export default defineEventHandler((event) => {
  setHeader(event, "X-Content-Type-Options", "nosniff");
  setHeader(event, "Referrer-Policy", "strict-origin-when-cross-origin");
  setHeader(event, "X-Frame-Options", "DENY");
  setHeader(
    event,
    "Content-Security-Policy",
    "base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
  );
  setHeader(
    event,
    "Permissions-Policy",
    "camera=(self), microphone=(self), display-capture=(self), geolocation=()",
  );
  if (process.env.NODE_ENV === "production")
    setHeader(event, "Strict-Transport-Security", "max-age=31536000");
  const path = getRequestURL(event).pathname;
  if (path.startsWith("/dspeak/session"))
    setHeader(event, "Cache-Control", "no-store");
  if (
    path.startsWith("/dspeak") &&
    !["GET", "HEAD", "OPTIONS"].includes(event.method) &&
    getHeader(event, "sec-fetch-site") === "cross-site"
  )
    throw createError({
      statusCode: 403,
      statusMessage: "Cross-site request rejected",
    });
});
