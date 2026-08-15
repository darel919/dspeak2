import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { cwd } from "node:process";

const desktopRoot = cwd();
const rustc = spawnSync("rustc", ["-vV"], { encoding: "utf8" });
if (rustc.status !== 0) throw new Error(rustc.stderr || "rustc is unavailable");
const host = rustc.stdout
  .split(/\r?\n/)
  .find((line) => line.startsWith("host: "))
  ?.slice("host: ".length)
  .trim();
const target = process.env.TAURI_ENV_TARGET_TRIPLE || host;
if (!target) throw new Error("Unable to determine the desktop target triple");

const extension = target.includes("windows") ? ".exe" : "";
const binariesDirectory = join(desktopRoot, "src-tauri", "binaries");
mkdirSync(binariesDirectory, { recursive: true });
const sidecarPath = join(
  binariesDirectory,
  "dspeak-media-" + target + extension,
);
if (!existsSync(sidecarPath)) writeFileSync(sidecarPath, "");

const args = [
  "build",
  "--release",
  "--target",
  target,
  "--features",
  "media-worker",
  "--bin",
  "dspeak-media",
];
const result = spawnSync("cargo", args, {
  cwd: join(desktopRoot, "src-tauri"),
  env: { ...process.env, NATIVE_MEDIA_WORKER_BUILD: "1" },
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);

const workerPath = join(
  desktopRoot,
  "src-tauri",
  "target",
  target,
  "release",
  "dspeak-media" + extension,
);
mkdirSync(binariesDirectory, { recursive: true });
copyFileSync(
  workerPath,
  join(binariesDirectory, "dspeak-media-" + target + extension),
);
