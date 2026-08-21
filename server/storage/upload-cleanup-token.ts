import { createHmac, timingSafeEqual } from "node:crypto";
import {
  parseExternalNumber,
  parseExternalRecord,
  parseExternalString,
  type ExternalField,
} from "../../shared/types/external.ts";

const configuredCleanupSecret = process.env.DSPEAK_CSRF_SECRET;
const CLEANUP_TOKEN_LIFETIME_SECONDS = 2 * 60 * 60;

if (!configuredCleanupSecret) {
  throw new Error("DSPEAK_CSRF_SECRET is not configured");
}
const CLEANUP_SECRET: string = configuredCleanupSecret;

function sign(payload: string): string {
  return createHmac("sha256", CLEANUP_SECRET)
    .update(payload)
    .digest("base64url");
}

export function createUploadCleanupToken(
  userId: string,
  key: string,
  expiresAt = Math.floor(Date.now() / 1000) + CLEANUP_TOKEN_LIFETIME_SECONDS,
) {
  const payload = Buffer.from(
    JSON.stringify({ userId, key, expiresAt }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyUploadCleanupToken(
  token: ExternalField,
  userId: string,
  now = Math.floor(Date.now() / 1000),
) {
  const encodedToken = parseExternalString(token);
  if (encodedToken === null) return null;
  const [payload, suppliedSignature, extra] = encodedToken.split(".");
  if (!payload || !suppliedSignature || extra) return null;

  const expectedSignature = sign(payload);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    return null;

  try {
    const claims = parseExternalRecord(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    const key = parseExternalString(claims?.key);
    const expiresAt = parseExternalNumber(claims?.expiresAt);
    if (
      parseExternalString(claims?.userId) !== userId ||
      key === null ||
      !key ||
      expiresAt === null ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt < now
    )
      return null;
    return { key };
  } catch {
    return null;
  }
}
