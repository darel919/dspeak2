import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectSourceFiles(path)));
    else if (/\.(?:vue|ts|js)$/.test(entry.name)) files.push(path);
  }
  return files;
}

test("app actions do not call blocking browser dialogs", async () => {
  const files = await collectSourceFiles("app");
  for (const file of files) {
    if (file.endsWith("app/composables/useConfirmDialog.ts")) continue;
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /window\.(?:alert|confirm|prompt)\s*\(/, file);
    assert.doesNotMatch(
      source,
      /(?<![\w.])(?:alert|confirm|prompt)\s*\(/,
      file,
    );
  }
});

test("PWA installation remains browser-event gated", async () => {
  const source = await readFile("app/components/PwaInstallPrompt.vue", "utf8");
  assert.match(source, /beforeinstallprompt/);
  assert.match(source, /deferredPrompt\.prompt\(\)/);
  assert.doesNotMatch(source, /window\.(?:alert|confirm|prompt)\s*\(/);
});
