import { existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const desktopRoot = join(repositoryRoot, "desktop");
const nuxi = join(
  repositoryRoot,
  "node_modules",
  "@nuxt",
  "cli",
  "bin",
  "nuxi.mjs",
);
const desktopOutput = join(repositoryRoot, "desktop", ".output");
const desktopEntry = join(desktopOutput, "public", "index.html");

if (!existsSync(nuxi)) {
  throw new Error(`Nuxt CLI is missing at ${nuxi}`);
}

rmSync(desktopOutput, { force: true, recursive: true });

const result = spawnSync(process.execPath, [nuxi, "generate"], {
  cwd: desktopRoot,
  env: {
    ...process.env,
    DSPEAK_DESKTOP: "1",
    NITRO_PRESET: "static",
  },
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (!existsSync(desktopEntry)) {
  throw new Error(`Desktop frontend generation did not create ${desktopEntry}`);
}
