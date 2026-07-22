import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeCollectionFields } from "../server/utils/pocketbase-migrations.js";

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
