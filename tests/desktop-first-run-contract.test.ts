import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isConfiguredApiRequest,
  resolveApiRequestTarget,
} from "../app/shared/api-request-target.ts";
import { isDesktopApiRequest } from "../app/shared/desktop-api-fetch.ts";
import { buildPublicUrl } from "../app/shared/desktop-external-url.ts";

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
    assert.match(
      securityFetch,
      /const transport = desktop \? await getDesktopHttpFetch\(\) : browserFetch/,
    );
    assert.match(
      securityFetch,
      /isDesktopApiRequest\(desktopRuntime, url, apiTarget\)/,
    );
  });
});
