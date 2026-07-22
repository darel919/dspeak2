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
