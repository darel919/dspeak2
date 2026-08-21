import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isConfiguredApiRequest,
  resolveApiRequestTarget,
} from "../app/shared/api-request-target.ts";
import {
  isDesktopApiRequest,
  withDesktopAuthorization,
} from "../app/shared/desktop-api-fetch.ts";
import { buildPublicUrl } from "../app/shared/desktop-external-url.ts";
import {
  parseExternalRecord,
  parseExternalString,
} from "../shared/types/external.ts";

const defaultCapability = JSON.parse(
  await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../desktop/src-tauri/capabilities/default.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ),
);

const securityFetch = await import("node:fs/promises").then(({ readFile }) =>
  readFile(
    new URL("../app/plugins/security-fetch.client.ts", import.meta.url),
    "utf8",
  ),
);

describe("desktop first-run URL and transport boundaries", () => {
  it("builds legal URLs from the configured public origin", () => {
    assert.equal(
      buildPublicUrl("https://www.dspeak.example", "/terms"),
      "https://www.dspeak.example/terms",
    );
    assert.equal(
      buildPublicUrl("https://www.dspeak.example/", "/privacy"),
      "https://www.dspeak.example/privacy",
    );
    assert.throws(() => buildPublicUrl("http://tauri.localhost", "/terms"));
    assert.throws(() => buildPublicUrl("https://www.dspeak.example", "terms"));
  });

  it("selects native transport only for the configured desktop API", () => {
    const target = resolveApiRequestTarget(
      "https://api.dspeak.example/api",
      "tauri://localhost",
    );
    const apiRequest = new URL("https://api.dspeak.example/api/rooms");
    const unrelatedRequest = new URL("https://supabase.example/auth/v1/user");

    assert.equal(isDesktopApiRequest(true, apiRequest, target), true);
    assert.equal(isDesktopApiRequest(false, apiRequest, target), false);
    assert.equal(isDesktopApiRequest(true, unrelatedRequest, target), false);
    assert.equal(isConfiguredApiRequest(apiRequest, target), true);
    assert.equal(isConfiguredApiRequest(unrelatedRequest, target), false);
  });

  it("uses native HTTP only for desktop API requests", () => {
    assert.match(securityFetch, /@tauri-apps\/plugin-http/);
    assert.match(securityFetch, /options\.credentials = "omit"/);
    assert.match(securityFetch, /withDesktopAuthorization/);
    assert.match(
      securityFetch,
      /const transport = desktop \? await getDesktopHttpFetch\(\) : browserFetch/,
    );
    assert.match(
      securityFetch,
      /isDesktopApiRequest\(desktopRuntime, url, apiTarget\)/,
    );
  });

  it("scopes native presigned uploads to the configured R2 account", async () => {
    const generator = await import("node:fs/promises").then(({ readFile }) =>
      readFile(
        new URL("../scripts/generate-tauri-capabilities.mjs", import.meta.url),
        "utf8",
      ),
    );
    assert.match(generator, /CF_R2_ACCOUNT_ID/);
    assert.match(generator, /r2\.cloudflarestorage\.com/);
    assert.match(generator, /\$\{r2Origin\}\/\*\*/);
  });

  it("attaches the Supabase bearer to native API requests", () => {
    const init = withDesktopAuthorization(
      "https://dspeak.darelisme.my.id/api/rooms",
      { method: "GET", headers: { "X-Device-Id": "device-id" } },
      "test-token",
    );
    const headers = new Headers(init.headers);

    assert.equal(headers.get("Authorization"), "Bearer test-token");
    assert.equal(headers.get("X-Device-Id"), "device-id");
    assert.equal(init.credentials, "omit");
  });

  it("keeps the checked-in native scopes narrow and production-specific", () => {
    const permissions = defaultCapability.permissions.flatMap((permission) => {
      const record = parseExternalRecord(permission);
      return record ? [record] : [];
    });
    const httpPermission = permissions.find(
      (permission) =>
        parseExternalString(permission.identifier) === "http:default",
    );
    const openerPermission = permissions.find(
      (permission) =>
        parseExternalString(permission.identifier) === "opener:allow-open-url",
    );

    assert.ok(httpPermission);
    assert.deepEqual(httpPermission.allow, [
      { url: "https://dspeak.darelisme.my.id/api/**" },
    ]);
    assert.ok(openerPermission);
    assert.deepEqual(openerPermission.allow, [
      { url: "https://dspeak.darelisme.my.id/terms" },
      { url: "https://dspeak.darelisme.my.id/privacy" },
      { url: "https://crmucqnebwlssqzthnek.supabase.co/auth/v1/**" },
    ]);
    assert.doesNotMatch(JSON.stringify(defaultCapability), /https?:\/\/\*\*/);
  });
});
