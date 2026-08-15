import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  desktopUpdatePromptTitle,
  shouldShowDesktopUpdatePrompt,
} from "../app/shared/desktop-update-state.ts";

const prompt = await readFile(
  new URL("../app/components/DesktopUpdatePrompt.vue", import.meta.url),
  "utf8",
);
const update = await readFile(
  new URL("../app/composables/useDesktopUpdate.ts", import.meta.url),
  "utf8",
);

test("desktop updater does not query release updates during dev startup", () => {
  assert.match(update, /function isDesktopDevelopment\(\)/);
  assert.match(update, /localhost.*127\.0\.0\.1.*::1/);
  assert.match(
    update,
    /if \(!runtimeStore\.isTauri \|\| isDesktopDevelopment\(\)\)/,
  );
  assert.match(update, /startMonitoring\(\)/);
  assert.match(update, /60 \* 60 \* 1000/);
});

test("desktop update prompt does not turn a failed check into an update", () => {
  assert.match(prompt, /deferred\.value/);
  assert.match(prompt, /status === ['"]error['"]/);
  assert.match(prompt, /desktopRuntime = computed/);
  assert.match(prompt, /shouldShowDesktopUpdatePrompt/);
  assert.match(prompt, /desktopUpdatePromptTitle/);
  assert.doesNotMatch(prompt, /A dSpeak update is ready/);
  assert.equal(
    shouldShowDesktopUpdatePrompt({
      desktopRuntime: true,
      deferred: false,
      status: "complete",
      update: null,
    }),
    false,
  );
  assert.equal(
    shouldShowDesktopUpdatePrompt({
      desktopRuntime: true,
      deferred: false,
      status: "complete",
      update: { version: "3.0.2" },
    }),
    true,
  );
  assert.equal(
    shouldShowDesktopUpdatePrompt({
      desktopRuntime: true,
      deferred: false,
      status: "error",
      update: null,
    }),
    false,
  );
  assert.equal(
    desktopUpdatePromptTitle("error", null),
    "Unable to check for dSpeak updates",
  );
});
