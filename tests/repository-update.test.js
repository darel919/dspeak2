import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createBuildIdentity,
  normalizeBranch,
  normalizeCommit,
  normalizeRepository,
} from "../shared/app-build.js";

const [
  buildInfo,
  nuxtConfig,
  desktopNuxtConfig,
  route,
  repositoryUpdate,
  repositoryComposable,
  details,
  init,
  pwaPrompt,
  desktopPrompt,
  tauriConfig,
  tauriMain,
  workflow,
  manifestScript,
  settings,
  releaseVersionScript,
] = await Promise.all(
  [
    "../shared/app-build.js",
    "../nuxt.config.ts",
    "../desktop/nuxt.desktop.config.ts",
    "../server/routes/api/update.get.js",
    "../server/utils/repository-update.js",
    "../app/composables/useRepositoryUpdate.js",
    "../app/components/UpdateDetails.vue",
    "../app/components/Init.vue",
    "../app/components/PwaUpdatePrompt.vue",
    "../app/components/DesktopUpdatePrompt.vue",
    "../desktop/src-tauri/tauri.conf.json",
    "../desktop/src-tauri/src/desktop/updates.rs",
    "../.github/workflows/desktop-build.yml",
    "../scripts/create-tauri-update-manifest.mjs",
    "../app/pages/settings.vue",
    "../scripts/sync-release-version.mjs",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
);

test("build identity normalizes source metadata without exposing arbitrary values", () => {
  assert.equal(normalizeCommit("C".repeat(40)), "c".repeat(40));
  assert.equal(normalizeCommit("not-a-commit"), null);
  assert.equal(normalizeCommit("1234567", { short: true }), "1234567");
  assert.equal(normalizeBranch("feature/updates"), "feature/updates");
  assert.equal(normalizeBranch("bad branch"), "next");
  assert.equal(
    normalizeRepository("https://github.com/darel919/dspeak2.git"),
    "darel919/dspeak2",
  );
  assert.equal(
    normalizeRepository("https://example.com/repo"),
    "darel919/dspeak2",
  );
  assert.deepEqual(
    createBuildIdentity({
      version: "2.7.0-alpha12",
      commit: "A".repeat(40),
      branch: "next",
      builtAt: "2026-08-09T00:00:00.000Z",
      repository: "darel919/dspeak2",
      updateBranch: "next",
    }),
    {
      version: "2.7.0-alpha12",
      commit: "a".repeat(40),
      shortCommit: "a".repeat(7),
      branch: "next",
      builtAt: "2026-08-09T00:00:00.000Z",
      repository: "darel919/dspeak2",
      updateBranch: "next",
    },
  );
});

test("web and desktop builds embed the same commit-aware identity", () => {
  assert.match(nuxtConfig, /createBuildIdentity/);
  assert.match(nuxtConfig, /VERCEL_GIT_COMMIT_SHA/);
  assert.match(nuxtConfig, /GITHUB_SHA/);
  assert.match(nuxtConfig, /appBuild: buildIdentity/);
  assert.match(desktopNuxtConfig, /createBuildIdentity/);
  assert.match(desktopNuxtConfig, /appBuild: buildIdentity/);
  assert.match(settings, /commit\s+\{\{\s*appBuild\.shortCommit/);
});

test("repository comparison reports deployment and source update states", () => {
  assert.match(route, /getRepositoryUpdate/);
  assert.match(route, /query\.commit/);
  assert.match(repositoryUpdate, /commits\//);
  assert.match(repositoryUpdate, /compare\//);
  assert.match(repositoryUpdate, /aheadBy/);
  assert.match(repositoryUpdate, /filesTruncated/);
  assert.match(repositoryUpdate, /deployedUpdateAvailable/);
  assert.match(repositoryUpdate, /sourceUpdateAvailable/);
  assert.match(repositoryUpdate, /MAX_CACHE_ENTRIES = 12/);
  assert.match(repositoryUpdate, /AbortSignal\.timeout\(5000\)/);
});

test("startup and prompts expose pending commit and file details", () => {
  assert.match(init, /checkRepositoryUpdate/);
  assert.match(init, /Promise\.all/);
  assert.match(repositoryComposable, /apiPath/);
  assert.match(repositoryComposable, /\/update/);
  assert.match(repositoryComposable, /startMonitoring/);
  assert.match(repositoryComposable, /60 \* 60 \* 1000/);
  assert.match(details, /View changes/);
  assert.match(details, /Files changed/);
  assert.match(details, /packageUpdate/);
  assert.match(details, /snapshot\.comparison/);
  assert.match(pwaPrompt, /deployedUpdateAvailable/);
  assert.match(pwaPrompt, /!desktopRuntime && updateAvailable/);
  assert.match(pwaPrompt, /window\.location\.reload/);
  assert.match(init, /startDesktopUpdateMonitoring/);
  assert.match(desktopPrompt, /repositoryUpdateAvailable/);
  assert.match(
    desktopPrompt,
    /desktop package has not been[\s\S]*published yet/,
  );
});

test("desktop release updates are signed, published as latest.json, and restart after installation", () => {
  assert.match(tauriConfig, /releases\/latest\/download\/latest\.json/);
  assert.match(tauriMain, /download_and_install/);
  assert.match(tauriMain, /app\.restart\(\)/);
  assert.match(tauriMain, /raw_json/);
  assert.match(tauriMain, /DSPEAK_TAURI_PUBLIC_KEY/);
  assert.match(workflow, /Configure signed updater artifacts/);
  assert.match(workflow, /TAURI_SIGNING_PRIVATE_KEY/);
  assert.match(workflow, /create-tauri-update-manifest\.mjs/);
  assert.match(workflow, /release:check/);
  assert.match(workflow, /DSPEAK_RELEASE_TAG/);
  assert.match(workflow, /DSPEAK_RELEASE_COMMIT/);
  assert.match(workflow, /\.app\.tar\.gz\.sig/);
  assert.match(workflow, /\.nsis\.zip\.sig/);
  assert.match(workflow, /windows-arm64/);
  assert.match(manifestScript, /platforms/);
  assert.match(manifestScript, /packageMetadata/);
  assert.match(manifestScript, /releaseVersionFromTag/);
  assert.match(manifestScript, /commit/);
  assert.match(manifestScript, /signature/);
  assert.match(manifestScript, /windows-aarch64/);
  assert.match(releaseVersionScript, /normalizeVersion/);
  assert.match(releaseVersionScript, /findVersionMismatches/);
});
