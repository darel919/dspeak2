import { Readable } from "node:stream";

export default defineEventHandler(async (event) => {
  const method = getMethod(event);

  if (method !== "GET") {
    throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
  }

  const { port, url } = getQuery(event);
  const targetUrl = url || `http://127.0.0.1:${port || "19350"}/`;

  const upstream = await fetch(targetUrl).catch(() => null);
  if (!upstream || !upstream.ok) {
    throw createError({
      statusCode: 502,
      statusMessage:
        "Broadcast stream is unavailable. Start VLC and try again.",
    });
  }

  setHeader(event, "Content-Type", "audio/ogg");
  setHeader(event, "Cache-Control", "no-cache");

  return sendStream(event, Readable.fromWeb(upstream.body));
});
