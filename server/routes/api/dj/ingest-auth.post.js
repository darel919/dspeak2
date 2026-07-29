import { authorizeDjIngest } from "../../../domains/dj/dj-sessions.js";

export default defineEventHandler(async (event) => {
  const expectedSecret = process.env.DSPEAK_INGEST_AUTH_SECRET || "";
  if (!expectedSecret || getQuery(event).secret !== expectedSecret)
    throw createError({
      statusCode: 404,
      statusMessage: "Not found",
    });
  const payload = await readBody(event);
  if (!authorizeDjIngest(payload))
    throw createError({
      statusCode: 401,
      statusMessage: "Invalid DJ ingest credentials",
    });
  setResponseStatus(event, 204);
  return null;
});
