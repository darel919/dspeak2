import { readdir } from "node:fs/promises";
import { join } from "node:path";

const SKIPPED_DIRECTORIES = new Set(["node_modules", ".nuxt", ".output"]);

export async function listSourceFiles(
  roots: string[],
  extensions: string[],
): Promise<string[]> {
  const files: string[] = [];

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name) && !entry.name.startsWith("."))
          await walk(path);
      } else if (
        extensions.some((extension) => entry.name.endsWith(extension))
      ) {
        files.push(path);
      }
    }
  }

  await Promise.all(roots.map(walk));
  return files.sort();
}
