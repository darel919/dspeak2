import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const prompt = await readFile(
  new URL("../app/components/DesktopUpdatePrompt.vue", import.meta.url),
  "utf8",
);
const update = await readFile(
  new URL("../app/composables/useDesktopUpdate.js", import.meta.url),
  "utf8",
);

test("desktop updater does not query release updates during dev startup", () => {
  assert.match(update, /function isDesktopDevelopment\(\)/);
  assert.match(update, /localhost.*127\.0\.0\.1.*::1/);
  assert.match(
    update,
    /if \(!runtimeStore\.isTauri \|\| isDesktopDevelopment\(\)\)/,
  );
});

test("desktop update prompt can be dismissed after an install error", () => {
  assert.match(prompt, /!deferred\.value/);
  assert.match(prompt, /status\.value === "error"/);
});
