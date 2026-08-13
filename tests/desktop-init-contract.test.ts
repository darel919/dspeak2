import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

async function read(path) {
  return readFile(path, "utf8");
}

describe("desktop initialization contract", () => {
  it("uses one visible Nuxt startup surface", async () => {
    const [tauriConfig, desktopConfig, initComponent, frontendBuild] =
      await Promise.all([
        read("desktop/src-tauri/tauri.conf.json"),
        read("desktop/nuxt.desktop.config.ts"),
        read("app/components/Init.vue"),
        read("scripts/build-desktop-frontend.mjs"),
      ]);
    const rootConfig = await read("nuxt.config.ts");

    assert.match(tauriConfig, /"label": "main"[\s\S]*"visible": true/);
    assert.doesNotMatch(tauriConfig, /"label": "init"/);
    assert.match(
      tauriConfig,
      /"beforeBuildCommand": "node \.\.\/scripts\/build-desktop-frontend\.mjs"/,
    );
    assert.doesNotMatch(tauriConfig, /NITRO_PRESET=|rm -rf|cp -R/);
    assert.match(frontendBuild, /spawnSync\(process\.execPath/);
    assert.match(frontendBuild, /NITRO_PRESET: "static"/);
    assert.match(frontendBuild, /DSPEAK_DESKTOP: "1"/);
    assert.match(frontendBuild, /rootEnvValue/);
    assert.match(frontendBuild, /VITE_DSPEAK_API_PATH: desktopApiOrigin/);
    assert.match(frontendBuild, /rmSync/);
    assert.match(frontendBuild, /cwd: desktopRoot/);
    assert.match(frontendBuild, /desktopEntry/);
    assert.match(desktopConfig, /public: resolve\(desktopDir, "public"\)/);
    assert.match(desktopConfig, /serverDir: resolve\(desktopDir, "server"\)/);
    assert.match(desktopConfig, /process\.env\.DSPEAK_PUBLIC_ORIGIN/);
    assert.match(desktopConfig, /apiPath: `\$\{apiBasePath\.replace/);
    assert.match(desktopConfig, /Desktop API origin is required/);
    assert.doesNotMatch(
      desktopConfig,
      /serverDir: resolve\(rootDir, "server"\)/,
    );
    assert.match(desktopConfig, /modules: \["@pinia\/nuxt", "@nuxt\/icon"\]/);
    assert.match(desktopConfig, /provider: "server"/);
    assert.match(desktopConfig, /pwa: false/);
    assert.match(
      rootConfig,
      /optimizeDeps: isDesktop \? \{ include: desktopOptimizeDeps \}/,
    );
    for (const dependency of [
      "@supabase/supabase-js",
      "@tauri-apps/api/core",
      "@tauri-apps/api/event",
      "@tauri-apps/plugin-shell",
    ]) {
      assert.match(rootConfig, new RegExp(dependency.replace("/", "\\/")));
    }
    assert.match(initComponent, /STARTUP_TIMEOUT_MS = 15000/);
    assert.match(initComponent, /Promise\.race\(\[/);
    assert.match(initComponent, /<StartupLoader[\s\S]*:visible="true"/);
    assert.match(initComponent, /Starting dSpeak…/);
    await assert.rejects(
      () => read("desktop/.output/public/sw.js"),
      (error) => error?.code === "ENOENT",
    );
  });
});
