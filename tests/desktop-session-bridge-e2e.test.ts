import assert from "node:assert/strict";
import test from "node:test";
import { supabaseProjectRef } from "../app/shared/desktop-session-diagnostics.ts";

const serverUrl = process.env.DSPEAK_TEST_SERVER_URL || "";
const accessToken = process.env.DSPEAK_TEST_TOKEN || "";
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

    const payload = (await response.json()) as {
      user?: { user_metadata?: Record<string, string> };
    };
    assert.ok(payload?.user?.user_metadata?.id, "session payload has user id");

    if (configuredProjectRef) {
      const serverProjectRef = response.headers.get(
        "X-dSpeak-Supabase-Project",
      );
      assert.equal(serverProjectRef, configuredProjectRef);
    }
  },
);

test(
  "desktop-session bridge rejects a wrong-issuer token with a clear diagnostic",
  {
    skip: !enabled && "set DSPEAK_TEST_SERVER_URL and DSPEAK_TEST_TOKEN",
  },
  async () => {
    const otherProject =
      configuredProjectRef === "crmucqnebwlssqzthnek"
        ? "another-project"
        : "crmucqnebwlssqzthnek";
    const otherIssuer = `https://${otherProject}.supabase.co/auth/v1`;

    const header = JSON.parse(
      Buffer.from(accessToken.split(".")[0], "base64url").toString("utf8"),
    ) as { kid?: string };
    const claims = JSON.parse(
      Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const forged = [
      Buffer.from(JSON.stringify({ ...header }), "utf8").toString("base64url"),
      Buffer.from(
        JSON.stringify({ ...claims, iss: otherIssuer }),
        "utf8",
      ).toString("base64url"),
      accessToken.split(".")[2],
    ].join(".");

    const response = await fetch(`${serverUrl}/api/auth/desktop-session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${forged}`,
        "Content-Type": "application/json",
        "X-Device-Id": "integration-test-device",
      },
    });

    assert.equal(response.status, 401);
    const payload = (await response.json()) as { statusMessage?: string };
    assert.equal(
      payload.statusMessage,
      "DESKTOP_SUPABASE_PROJECT_MISMATCH",
      `expected PROJECT_MISMATCH, got ${payload.statusMessage}`,
    );
  },
);

test("project ref extraction matches the configured Supabase project", () => {
  assert.equal(
    supabaseProjectRef("https://crmucqnebwlssqzthnek.supabase.co/auth/v1"),
    "crmucqnebwlssqzthnek",
  );
});
