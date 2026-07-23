import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("browser video preferences are not replaced by the SSR Pinia snapshot", async () => {
  const source = await readFile("app/stores/settings.js", "utf8");

  assert.match(source, /import \{ defineStore, skipHydrate \} from "pinia"/);
  assert.match(
    source,
    /const cameraVideo = skipHydrate\([\s\S]*?cameraVideoSettings/,
  );
  assert.match(
    source,
    /const screenVideo = skipHydrate\([\s\S]*?screenVideoSettings/,
  );
});
