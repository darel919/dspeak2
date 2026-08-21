import { enforceRateLimit } from "../../../utils/rate-limit.ts";
import {
  parseExternalRecord,
  parseExternalString,
  type ExternalField,
} from "../../../../shared/types/external.ts";

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

function sanitizeValue(key: string, value: ExternalField): ExternalField {
  const text = parseExternalString(value);
  if (text === null) return value;
  if (!urlFields.has(key)) return text.slice(0, 1000);
  try {
    const url = new URL(text);
    if (key === "documentURL" || key === "referrer") return url.origin;
    return `${url.origin}${url.pathname}`.slice(0, 1000);
  } catch {
    return "";
  }
}

function sanitizeReport(
  value: ExternalField,
): Record<string, ExternalField> | null {
  const record = parseExternalRecord(value);
  if (!record) return null;
  return Object.fromEntries(
    Object.entries(record)
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
    .map((report) => {
      const record = parseExternalRecord(report);
      return sanitizeReport(record?.body ?? report);
    })
    .filter(Boolean);
  for (const report of reports)
    console.warn("[Security] CSP violation", report);
  setResponseStatus(event, 204);
  return null;
});
