import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { configureNativeControl } from "../app/composables/media/native-media-engine-runtime.ts";

const runtimeSource = await readFile(
  new URL(
    "../app/composables/media/native-media-engine-runtime.ts",
    import.meta.url,
  ),
  "utf8",
);

describe("native media authentication", () => {
  it("uses the active WebView Supabase session for native API calls", () => {
    assert.match(runtimeSource, /utils\/supabase-client/);
    assert.match(runtimeSource, /auth\.getSession\(\)/);
    assert.match(runtimeSource, /Authorization: `Bearer \$\{authToken\}`/);
    assert.match(
      runtimeSource,
      /const bootstrapEndpoint = \/\^https\?:\\\/\\\//,
    );
    assert.doesNotMatch(runtimeSource, /get_credential/);
  });

  it("does not duplicate the absolute API base during bootstrap", async () => {
    const originalFetch = globalThis.fetch;
    let request;
    let configured;
    globalThis.fetch = async (input, init) => {
      request = { input, init };
      return {
        ok: true,
        json: async () => ({ ticket: "ticket" }),
      };
    };

    try {
      await configureNativeControl(
        {
          nativeConfig: {
            serverUrl: "https://api.example.test",
            apiPath: "https://api.example.test/api",
          },
          nativeAuthToken: "access-token",
          nativeSession: {
            configureControl(value) {
              configured = value;
            },
          },
        },
        "channel-id",
        "room-id",
      );
      await assert.doesNotReject(() => configured.refreshControl());
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(request.input, "https://api.example.test/api/media/bootstrap");
    assert.equal(request.init.headers.Authorization, "Bearer access-token");
  });
});
