export default defineEventHandler((event) => {
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
