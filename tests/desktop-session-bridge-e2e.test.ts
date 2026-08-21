import assert from "node:assert/strict";
import test from "node:test";
import { supabaseProjectRef } from "../app/shared/desktop-session-diagnostics.ts";
import {
  parseExternalRecord,
  parseExternalString,
} from "../shared/types/external.ts";

const serverUrl = process.env.DSPEAK_TEST_SERVER_URL || "";
const accessToken = process.env.DSPEAK_TEST_TOKEN || "";
const otherProjectToken = process.env.DSPEAK_TEST_TOKEN_OTHER_PROJECT || "";
const configuredProjectRef = process.env.DSPEAK_TEST_PROJECT_REF || "";

const enabled = Boolean(serverUrl && accessToken);

test(
  "desktop-session bridge end-to-end accepts a real Supabase token",
  {
    skip: !enabled && "set DSPEAK_TEST_SERVER_URL and DSPEAK_TEST_TOKEN",
  },
  async () => {
    const response = await fetch(`${serverUrl}/api/auth/desktop-session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Device-Id": "integration-test-device",
      },
    });

    assert.equal(
      response.status,
      200,
      `expected 200, got ${response.status}: ${await response.text()}`,
    );

    const payload = parseExternalRecord(await response.json());
    const user = parseExternalRecord(payload?.user);
    const metadata = parseExternalRecord(user?.user_metadata);
    assert.ok(parseExternalString(metadata?.id), "session payload has user id");

    if (configuredProjectRef) {
      const serverProjectRef = response.headers.get(
        "X-dSpeak-Supabase-Project",
      );
      assert.equal(serverProjectRef, configuredProjectRef);
    }
  },
);

test(
  "desktop-session bridge rejects a valid token from another Supabase project",
  {
    skip:
      !enabled &&
      "set DSPEAK_TEST_SERVER_URL, DSPEAK_TEST_TOKEN, and DSPEAK_TEST_TOKEN_OTHER_PROJECT",
  },
  async () => {
    if (!otherProjectToken) return;
    const response = await fetch(`${serverUrl}/api/auth/desktop-session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${otherProjectToken}`,
        "Content-Type": "application/json",
        "X-Device-Id": "integration-test-device",
      },
    });

    assert.equal(response.status, 401);
    const payload = parseExternalRecord(await response.json());
    assert.equal(
      parseExternalString(payload?.statusMessage),
      "DESKTOP_SUPABASE_PROJECT_MISMATCH",
      `expected PROJECT_MISMATCH, got ${payload.statusMessage}`,
    );
  },
);

test(
  "desktop-session bridge rejects a tampered JWT as invalid",
  {
    skip: !enabled && "set DSPEAK_TEST_SERVER_URL and DSPEAK_TEST_TOKEN",
  },
  async () => {
    const parts = accessToken.split(".");
    if (parts.length !== 3) return;
    const claims =
      parseExternalRecord(
        JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")),
      ) ?? {};
    const tampered = [
      parts[0],
      Buffer.from(
        JSON.stringify({ ...claims, sub: "tampered-sub" }),
        "utf8",
      ).toString("base64url"),
      parts[2],
    ].join(".");

    const response = await fetch(`${serverUrl}/api/auth/desktop-session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tampered}`,
        "Content-Type": "application/json",
        "X-Device-Id": "integration-test-device",
      },
    });

    assert.equal(response.status, 401);
  },
);

test("project ref extraction matches the configured Supabase project", () => {
  assert.equal(
    supabaseProjectRef("https://crmucqnebwlssqzthnek.supabase.co/auth/v1"),
    "crmucqnebwlssqzthnek",
  );
});
