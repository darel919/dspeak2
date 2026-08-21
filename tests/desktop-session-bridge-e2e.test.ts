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

async function callSessionBridge(token: string, deviceId: string) {
  return fetch(`${serverUrl}/api/auth/desktop-session`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Device-Id": deviceId,
    },
    signal: AbortSignal.timeout(15_000),
  });
}

function tamperAccessToken(token: string): string {
  const parts = token.split(".");
  assert.equal(parts.length, 3, "test token must be a JWT");
  const claims =
    parseExternalRecord(
      JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")),
    ) ?? {};
  return [
    parts[0],
    Buffer.from(
      JSON.stringify({ ...claims, sub: "tampered-sub" }),
      "utf8",
    ).toString("base64url"),
    parts[2],
  ].join(".");
}

async function assertSuccessfulSession(response: Response) {
  assert.equal(response.status, 200, "valid desktop session call failed");
  assert.equal(response.redirected, false, "desktop session call redirected");
  assert.ok(
    response.headers.get("X-dSpeak-Build-Commit"),
    "session response is missing its build fingerprint",
  );
  assert.ok(
    response.headers.get("X-dSpeak-Supabase-Project"),
    "session response is missing its Supabase fingerprint",
  );
  const payload = parseExternalRecord(await response.json());
  const user = parseExternalRecord(payload?.user);
  const metadata = parseExternalRecord(user?.user_metadata);
  assert.ok(parseExternalString(metadata?.id), "session payload has user id");

  if (configuredProjectRef) {
    assert.equal(
      response.headers.get("X-dSpeak-Supabase-Project"),
      configuredProjectRef,
    );
  }
}

test(
  "desktop-session bridge performs a bounded three-call smoke",
  {
    skip: !enabled && "set DSPEAK_TEST_SERVER_URL and DSPEAK_TEST_TOKEN",
  },
  async () => {
    const firstResponse = await callSessionBridge(
      accessToken,
      "integration-test-device",
    );
    await assertSuccessfulSession(firstResponse);

    const secondToken = otherProjectToken || accessToken;
    const secondResponse = await callSessionBridge(
      secondToken,
      "integration-test-device-retry",
    );
    if (otherProjectToken) {
      assert.equal(
        secondResponse.status,
        401,
        "cross-project desktop session call was accepted",
      );
      const payload = parseExternalRecord(await secondResponse.json());
      assert.equal(
        parseExternalString(payload?.statusMessage),
        "DESKTOP_SUPABASE_PROJECT_MISMATCH",
      );
    } else {
      await assertSuccessfulSession(secondResponse);
    }

    const tamperedResponse = await callSessionBridge(
      tamperAccessToken(accessToken),
      "integration-test-device",
    );
    assert.equal(
      tamperedResponse.status,
      401,
      "tampered desktop session call was accepted",
    );
    const payload = parseExternalRecord(await tamperedResponse.json());
    assert.equal(
      parseExternalString(payload?.statusMessage),
      "DESKTOP_SESSION_TOKEN_INVALID",
    );
  },
);

test("project ref extraction matches the configured Supabase project", () => {
  assert.equal(
    supabaseProjectRef("https://crmucqnebwlssqzthnek.supabase.co/auth/v1"),
    "crmucqnebwlssqzthnek",
  );
});
