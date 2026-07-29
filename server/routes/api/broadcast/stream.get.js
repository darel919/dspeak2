import { Readable } from "node:stream";

export default defineEventHandler(async (event) => {
  const method = getMethod(event);

  if (method !== "GET") {
    throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
  }

  const { port = "19350", token } = getQuery(event);
  const portNumber = Number(port);
  if (
    !Number.isInteger(portNumber) ||
    portNumber < 1024 ||
    portNumber > 65535 ||
    typeof token !== "string" ||
    !/^[a-f0-9]{16}$/.test(token)
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid broadcast stream address",
    });
  }
  const targetUrl = `http://127.0.0.1:${portNumber}/${encodeURIComponent(token)}`;

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
