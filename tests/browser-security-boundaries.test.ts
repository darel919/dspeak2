import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { listSourceFiles } from "./helpers/source-files.ts";

test("browser application source contains no executable HTML sinks", async () => {
  const files = await listSourceFiles(["app", "shared"], [".ts", ".vue"]);
  const prohibited = [
    /\bv-html\b/,
    /\.innerHTML\b/,
    /\.outerHTML\b/,
    /\.insertAdjacentHTML\b/,
    /\bdocument\.write\b/,
    /\beval\s*\(/,
    /\bnew\s+Function\b/,
    /\bjavascript\s*:/i,
  ];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const pattern of prohibited)
      assert.doesNotMatch(source, pattern, `${file} contains ${pattern}`);
  }
});
