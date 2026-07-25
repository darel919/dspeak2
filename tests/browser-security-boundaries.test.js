import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);

test("browser application source contains no executable HTML sinks", async () => {
  const { stdout } = await execute("rg", [
    "--files",
    "app",
    "shared",
    "-g",
    "*.js",
    "-g",
    "*.vue",
  ]);
  const files = stdout.trim().split("\n").filter(Boolean);
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
