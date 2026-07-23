import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeCollectionFields } from "../server/utils/pocketbase-migrations.js";
import { readFileSync } from "node:fs";

test("PocketBase migration field merging is idempotent and preserves IDs", () => {
  const current = [
    { id: "existing", name: "accent", type: "text", required: false },
    { id: "untouched", name: "name", type: "text", required: true },
  ];
  const additions = [
    { name: "accent", type: "select", values: ["cobalt"] },
    { name: "header_image", type: "file", maxSelect: 1 },
  ];
  const first = mergeCollectionFields(current, additions);
  const second = mergeCollectionFields(first, additions);
  assert.deepEqual(second, first);
  assert.equal(first[0].id, "existing");
  assert.equal(first[1].id, "untouched");
  assert.equal(first[2].name, "header_image");
});

test("PocketBase migrations enforce case-insensitive unique user handles", () => {
  const source = readFileSync(
    new URL("../server/utils/pocketbase-migrations.js", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /CREATE UNIQUE INDEX idx_users_handle_unique ON users \(handle COLLATE NOCASE\) WHERE handle != ''/,
  );
});

test("PocketBase migrations add soundboard timestamps used for stable sorting", () => {
  const source = readFileSync(
    new URL("../server/utils/pocketbase-migrations.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /field\("created", "autodate"/);
  assert.match(source, /field\("updated", "autodate"/);
  assert.match(source, /20260723_soundboard_timestamps_v1/);
});

test("PocketBase permits the first soundboard clip to use display order zero", () => {
  const source = readFileSync(
    new URL("../server/utils/pocketbase-migrations.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /field\("display_order", "number", \{ min: 0 \}\)/);
  assert.doesNotMatch(
    source,
    /field\("display_order", "number", \{ required: true, min: 0 \}\)/,
  );
  assert.match(source, /20260723_soundboard_display_order_v1/);
});

test("PocketBase permits soundboard clips up to ten seconds", () => {
  const source = readFileSync(
    new URL("../server/utils/pocketbase-migrations.js", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /field\("duration", "number", \{ required: true, min: 0, max: 10 \}\)/,
  );
  assert.doesNotMatch(source, /duration.*max: 5/);
  assert.match(source, /20260723_soundboard_duration_10s_v1/);
});

test("PocketBase grants voice moderation to existing room admins", () => {
  const source = readFileSync(
    new URL("../server/utils/pocketbase-migrations.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /20260723_voice_moderation_permission_v1/);
  assert.match(source, /"channel\.moderate_voice"/);
});

test("PocketBase permits a new push job to start with zero attempts", () => {
  const source = readFileSync(
    new URL("../server/utils/pocketbase-migrations.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /field\("attempts", "number", \{ min: 0, max: 20 \}\)/);
  assert.doesNotMatch(
    source,
    /field\("attempts", "number", \{ required: true, min: 0, max: 20 \}\)/,
  );
  assert.match(source, /20260723_push_job_zero_attempts_v1/);
});
