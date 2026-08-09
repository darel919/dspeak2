import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

async function read(path) {
  return readFile(path, "utf8");
}

describe("desktop initialization contract", () => {
  it("uses one visible Nuxt startup surface", async () => {
    const [tauriConfig, desktopConfig, initComponent] = await Promise.all([
      read("desktop/src-tauri/tauri.conf.json"),
      read("desktop/nuxt.desktop.config.ts"),
      read("app/components/Init.vue"),
    ]);

    assert.match(tauriConfig, /"label": "main"[\s\S]*"visible": true/);
    assert.doesNotMatch(tauriConfig, /"label": "init"/);
    assert.match(desktopConfig, /public: resolve\(desktopDir, "public"\)/);
    assert.match(desktopConfig, /modules: \["@pinia\/nuxt", "@nuxt\/icon"\]/);
    assert.match(desktopConfig, /provider: "server"/);
    assert.match(desktopConfig, /pwa: false/);
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
