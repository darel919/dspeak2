import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { resolveAutomaticPresence } from "../shared/presence-status.ts";

describe("automatic presence", () => {
  it("keeps a manual idle status idle during activity and inactivity", () => {
    assert.equal(resolveAutomaticPresence("idle", "online"), "idle");
    assert.equal(resolveAutomaticPresence("idle", "idle"), "idle");
  });

  it("allows an online user to become idle and return online", () => {
    assert.equal(resolveAutomaticPresence(null, "idle"), "idle");
    assert.equal(resolveAutomaticPresence(null, "online"), "online");
  });

  it("never exposes a manual offline user as online or idle", () => {
    assert.equal(resolveAutomaticPresence("offline", "online"), "offline");
    assert.equal(resolveAutomaticPresence("offline", "idle"), "offline");
  });

  it("keeps automatic transitions separate from persisted manual choices", () => {
    const store = readFileSync(
      new URL("../app/stores/presenceStatus.ts", import.meta.url),
      "utf8",
    );
    const idleDetection = readFileSync(
      new URL("../app/composables/useIdleDetection.ts", import.meta.url),
      "utf8",
    );
    assert.match(store, /function setAutomaticStatus\(status: unknown\)/);
    assert.match(store, /if \(presenceOverride\.value\) return/);
    assert.match(idleDetection, /setAutomaticStatus\("idle"\)/);
    assert.match(idleDetection, /setAutomaticStatus\("online"\)/);
    assert.doesNotMatch(idleDetection, /setStatus\("idle"\)/);
  });

  it("keeps persisted presence state through Pinia SSR hydration", () => {
    const store = readFileSync(
      new URL("../app/stores/presenceStatus.ts", import.meta.url),
      "utf8",
    );
    assert.match(store, /defineStore, skipHydrate/);
    assert.match(store, /const presenceOverride = skipHydrate\(/);
    assert.match(store, /const idleTimeout = skipHydrate\(/);
    assert.match(store, /const effectiveStatus = skipHydrate\(/);
    assert.match(
      store,
      /resolveAutomaticPresence\(presenceOverride\.value, "online"\)/,
    );
  });

  it("registers long-lived client composables while the component scope is active", () => {
    const init = readFileSync(
      new URL("../app/components/Init.vue", import.meta.url),
      "utf8",
    );
    const idleDetection = readFileSync(
      new URL("../app/composables/useIdleDetection.ts", import.meta.url),
      "utf8",
    );
    assert.ok(
      init.indexOf("useIdleDetection()") < init.indexOf("onMounted(async"),
    );
    assert.ok(
      init.indexOf("useGlobalKeyboardShortcuts()") <
        init.indexOf("onMounted(async"),
    );
    assert.doesNotMatch(idleDetection, /onScopeDispose\(\(\) => \{/);
  });
});
