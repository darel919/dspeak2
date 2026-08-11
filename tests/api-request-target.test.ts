import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isConfiguredApiRequest,
  resolveApiRequestTarget,
} from "../app/shared/api-request-target.ts";

describe("configured API request target", () => {
  it("matches the configured remote API path", () => {
    const target = resolveApiRequestTarget(
      "https://api.example.test/api",
      "tauri://localhost",
    );

    assert.equal(
      isConfiguredApiRequest(
        new URL("https://api.example.test/api/media/bootstrap"),
        target,
      ),
      true,
    );
    assert.equal(
      isConfiguredApiRequest(
        new URL("https://api.example.test/api/activity"),
        target,
      ),
      true,
    );
  });

  it("does not match another origin or a neighboring path", () => {
    const target = resolveApiRequestTarget(
      "https://api.example.test/api",
      "tauri://localhost",
    );

    assert.equal(
      isConfiguredApiRequest(
        new URL("https://attacker.example.test/api/activity"),
        target,
      ),
      false,
    );
    assert.equal(
      isConfiguredApiRequest(
        new URL("https://api.example.test/api-private"),
        target,
      ),
      false,
    );
  });
});
