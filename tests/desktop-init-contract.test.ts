import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

async function read(path) {
  return readFile(path, "utf8");
}

describe("desktop initialization contract", () => {
  it("creates Nuxt only when the shell opens the desktop window", async () => {
    const [tauriConfig, desktopConfig, initComponent, frontendBuild] =
      await Promise.all([
        read("desktop/src-tauri/tauri.conf.json"),
        read("desktop/nuxt.desktop.config.ts"),
        read("app/components/Init.vue"),
        read("scripts/build-desktop-frontend.mjs"),
      ]);
    const authStore = await read("app/stores/auth.ts");
    const rootConfig = await read("nuxt.config.ts");

    assert.match(tauriConfig, /"windows": \[\]/);
    assert.doesNotMatch(tauriConfig, /"label": "init"/);
    assert.match(
      tauriConfig,
      /"beforeBuildCommand": "node \.\.\/scripts\/build-desktop-frontend\.mjs && node \.\.\/scripts\/build-desktop-worker\.mjs"/,
    );
    assert.match(
      tauriConfig,
      /"externalBin":\s*\[\s*"binaries\/dspeak-media"\s*\]/,
    );
    assert.doesNotMatch(tauriConfig, /NITRO_PRESET=|rm -rf|cp -R/);
    assert.match(
      await read("desktop/src-tauri/src/desktop/mod.rs"),
      /argument == "--show"/,
    );
    assert.match(
      await read("desktop/src-tauri/src/desktop/mod.rs"),
      /argument == "--minimized"/,
    );
    assert.match(frontendBuild, /spawnSync\(process\.execPath/);
    assert.match(frontendBuild, /NITRO_PRESET: "static"/);
    assert.match(frontendBuild, /DSPEAK_DESKTOP: "1"/);
    assert.match(frontendBuild, /rootEnvValue/);
    assert.match(
      frontendBuild,
      /buildEnv\.VITE_DSPEAK_API_PATH = desktopApiOrigin/,
    );
    assert.match(frontendBuild, /buildEnv\.SUPABASE_URL = desktopSupabaseUrl/);
    assert.match(
      frontendBuild,
      /buildEnv\.SUPABASE_ANON_KEY = desktopSupabaseAnonKey/,
    );
    assert.match(frontendBuild, /rmSync/);
    assert.match(frontendBuild, /cwd: desktopRoot/);
    assert.match(frontendBuild, /desktopEntry/);
    assert.match(desktopConfig, /public: resolve\(desktopDir, "public"\)/);
    assert.match(desktopConfig, /serverDir: resolve\(desktopDir, "server"\)/);
    assert.match(desktopConfig, /process\.env\.DSPEAK_PUBLIC_ORIGIN/);
    assert.match(desktopConfig, /apiPath: `\$\{apiBasePath\.replace/);
    assert.match(desktopConfig, /Desktop API origin is required/);
    assert.match(desktopConfig, /Desktop Supabase configuration is required/);
    assert.doesNotMatch(
      desktopConfig,
      /serverDir: resolve\(rootDir, "server"\)/,
    );
    assert.match(desktopConfig, /modules: \["@pinia\/nuxt", "@nuxt\/icon"\]/);
    assert.match(desktopConfig, /provider: "server"/);
    assert.match(desktopConfig, /pwa: false/);
    assert.match(
      rootConfig,
      /desktopApiBasePath =\s*\n\s*process\.env\.VITE_DSPEAK_API_PATH \|\| process\.env\.DSPEAK_PUBLIC_ORIGIN/,
    );
    assert.match(rootConfig, /isDesktop && desktopApiBasePath/);
    assert.match(
      rootConfig,
      /optimizeDeps: isDesktop \? \{ include: desktopOptimizeDeps \}/,
    );
    assert.match(authStore, /import\.meta\.dev/);
    assert.match(authStore, /parsed\.protocol === "http:"/);
    assert.match(authStore, /localhost.*127\.0\.0\.1.*\[::1\]/s);
    assert.match(
      authStore,
      /parsed\.protocol !== "https:" && !localDevelopmentApi/,
    );
    for (const dependency of [
      "@supabase/supabase-js",
      "@tauri-apps/api/core",
      "@tauri-apps/api/event",
      "@tauri-apps/plugin-http",
      "@tauri-apps/plugin-opener",
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

  it("builds the native media sidecar without a Windows console window", async () => {
    const worker = await read("desktop/src-tauri/src/bin/dspeak-media.rs");
    assert.match(
      worker,
      /#!\[cfg_attr\(windows, windows_subsystem = "windows"\)\]/,
    );
  });
});
