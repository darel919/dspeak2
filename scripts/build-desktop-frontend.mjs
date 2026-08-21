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
const desktopPublicOrigin =
  process.env.DSPEAK_PUBLIC_ORIGIN || rootEnvValue("DSPEAK_PUBLIC_ORIGIN");
const desktopSupabaseUrl =
  process.env.SUPABASE_URL || rootEnvValue("SUPABASE_URL");
const desktopSupabaseAnonKey =
  process.env.SUPABASE_ANON_KEY || rootEnvValue("SUPABASE_ANON_KEY");

if (!existsSync(nuxi)) {
  throw new Error(`Nuxt CLI is missing at ${nuxi}`);
}

const supabaseProjectRef = desktopSupabaseUrl
  ? new URL(desktopSupabaseUrl).hostname.split(".")[0]
  : "";

console.info("[DesktopBuild] API origin:", desktopApiOrigin);
console.info("[DesktopBuild] Public origin:", desktopPublicOrigin);
console.info("[DesktopBuild] Supabase project:", supabaseProjectRef);

const apiUrl = new URL(desktopApiOrigin);
if (apiUrl.protocol !== "https:") {
  throw new Error("Desktop production API origin must use HTTPS");
}

rmSync(desktopOutput, { force: true, recursive: true });

const buildEnv = {
  ...process.env,
  DSPEAK_DESKTOP: "1",
  NITRO_PRESET: "static",
};
if (desktopApiOrigin) buildEnv.VITE_DSPEAK_API_PATH = desktopApiOrigin;
if (desktopPublicOrigin) buildEnv.DSPEAK_PUBLIC_ORIGIN = desktopPublicOrigin;
if (desktopSupabaseUrl) buildEnv.SUPABASE_URL = desktopSupabaseUrl;
if (desktopSupabaseAnonKey) buildEnv.SUPABASE_ANON_KEY = desktopSupabaseAnonKey;

const result = spawnSync(process.execPath, [nuxi, "generate"], {
  cwd: desktopRoot,
  env: buildEnv,
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
