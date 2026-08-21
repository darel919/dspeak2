import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../app/components/VideoFeed.vue", import.meta.url),
  "utf8",
);

test("local screen preview attaches after its video element mounts", () => {
  const start = source.indexOf("function enablePreview()");
  const end = source.indexOf("\n}\n\nfunction notifyPreviewDemand", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const enablePreview = source.slice(start, end);
  assert.match(enablePreview, /previewEnabled\.value = true/);
  assert.match(enablePreview, /void nextTick\(\(\) => attachStream\(\)\)/);
  assert.doesNotMatch(
    enablePreview,
    /previewEnabled\.value = true;\s*attachStream\(\);/,
  );
});

test("local screen previews still start paused until explicitly enabled", () => {
  assert.match(
    source,
    /const previewEnabled = ref\(!\(props\.local && props\.source === "screen"\)\);/,
  );
  assert.match(
    source,
    /if \(props\.local && props\.source === "screen"\) previewEnabled\.value = false;/,
  );
});
