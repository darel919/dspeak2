import { enforceRateLimit } from "../../../utils/rate-limit.ts";

const allowedFields = new Set([
  "age",
  "blockedURL",
  "columnNumber",
  "disposition",
  "documentURL",
  "effectiveDirective",
  "lineNumber",
  "referrer",
  "sourceFile",
  "statusCode",
  "type",
]);
const urlFields = new Set([
  "blockedURL",
  "documentURL",
  "referrer",
  "sourceFile",
]);

function sanitizeValue(key, value) {
  if (typeof value !== "string") return value;
  if (!urlFields.has(key)) return value.slice(0, 1000);
  try {
    const url = new URL(value);
    if (key === "documentURL" || key === "referrer") return url.origin;
    return `${url.origin}${url.pathname}`.slice(0, 1000);
  } catch {
    return "";
  }
}

function sanitizeReport(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => allowedFields.has(key))
      .map(([key, item]) => [key, sanitizeValue(key, item)]),
  );
}

export default defineEventHandler(async (event) => {
  enforceRateLimit(event, "csp-report", null, 60, 60 * 1000);
  const contentLength = Number(getHeader(event, "content-length") || 0);
  if (contentLength > 64_000)
    throw createError({
      statusCode: 413,
      statusMessage: "CSP report is too large",
    });
  const body = await readBody(event);
  const reports = (Array.isArray(body) ? body : [body])
    .slice(0, 20)
    .map((report) => sanitizeReport(report?.body || report))
    .filter(Boolean);
  for (const report of reports)
    console.warn("[Security] CSP violation", report);
  setResponseStatus(event, 204);
  return null;
});
