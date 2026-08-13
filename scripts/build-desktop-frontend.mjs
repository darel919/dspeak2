import { existsSync, readFileSync, rmSync } from "node:fs";
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

function rootEnvValue(name) {
  try {
    const line = readFileSync(join(repositoryRoot, ".env"), "utf8")
      .split(/\r?\n/)
      .map((value) => value.trim())
      .find(
        (value) =>
          value.startsWith(`${name}=`) || value.startsWith(`export ${name}=`),
      );
    if (!line) return "";
    const value = line.slice(line.indexOf("=") + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"'))
      return value.slice(1, -1);
    if (value.length >= 2 && value.startsWith("'") && value.endsWith("'"))
      return value.slice(1, -1);
    return value;
  } catch {
    return "";
  }
}

const desktopApiOrigin =
  process.env.VITE_DSPEAK_API_PATH ||
  process.env.DSPEAK_PUBLIC_ORIGIN ||
  rootEnvValue("VITE_DSPEAK_API_PATH") ||
  rootEnvValue("DSPEAK_PUBLIC_ORIGIN");

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
    ...(desktopApiOrigin ? { VITE_DSPEAK_API_PATH: desktopApiOrigin } : {}),
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
