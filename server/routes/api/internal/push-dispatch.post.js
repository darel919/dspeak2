import { timingSafeEqual } from "node:crypto";
import { dispatchPushJobs } from "../../../utils/push-delivery.js";

function verifyCronSecret(event) {
  const expected =
    process.env.DSPEAK_CRON_SECRET || process.env.CRON_SECRET || "";
  if (!expected) return false;
  const header = getHeader(event, "authorization") || "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  const token = header.slice(prefix.length);
  if (token.length !== expected.length) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return timingSafeEqual(a, b);
}

export default defineEventHandler(async (event) => {
  if (!verifyCronSecret(event)) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }
  try {
    const dispatched = await dispatchPushJobs();
    return { ok: true, dispatched };
  } catch (error) {
    console.error("[PushDispatcher] Cron dispatch failed", error);
    throw createError({ statusCode: 500, statusMessage: "Internal error" });
  }
});
