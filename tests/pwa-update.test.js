import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const updatePrompt = await readFile(
  new URL("../app/components/PwaUpdatePrompt.vue", import.meta.url),
  "utf8",
);
const serviceWorker = await readFile(
  new URL("../public/sw.js", import.meta.url),
  "utf8",
);
const nuxtConfig = await readFile(
  new URL("../nuxt.config.ts", import.meta.url),
  "utf8",
);
const serviceWorkerRegistration = await readFile(
  new URL("../app/shared/service-worker-registration.js", import.meta.url),
  "utf8",
);
const settings = await readFile(
  new URL("../app/pages/settings.vue", import.meta.url),
  "utf8",
);
const installPrompt = await readFile(
  new URL("../app/components/PwaInstallPrompt.vue", import.meta.url),
  "utf8",
);

test("service worker updates remain waiting for explicit user activation", () => {
  assert.match(nuxtConfig, /registerType: "prompt"/);
  assert.doesNotMatch(serviceWorker, /\.then\(\(\) => self\.skipWaiting/);
  assert.match(serviceWorker, /event\.data\.type === "SKIP_WAITING"/);
  assert.match(updatePrompt, /activationWorker\.postMessage/);
  assert.match(updatePrompt, /controllerchange/);
  assert.match(updatePrompt, /window\.location\.reload/);
  assert.match(updatePrompt, /registration\.waiting\.state === "installed"/);
  assert.match(updatePrompt, /updateAvailable\.value = false/);
});

test("each deployment receives an isolated precache", () => {
  assert.match(serviceWorker, /new Map\(/);
  assert.match(serviceWorker, /new URL\(url, self\.location\.origin\)\.href/);
  assert.doesNotMatch(nuxtConfig, /woff2,webmanifest/);
  assert.match(serviceWorker, /PRECACHE_SIGNATURE/);
  assert.match(serviceWorker, /const PRECACHE_NAME = `dspeak-precache-\$\{/);
  assert.match(serviceWorker, /name\.startsWith\("dspeak-precache-"\)/);
  assert.match(serviceWorker, /request\.mode === "navigate"/);
  assert.match(serviceWorker, /PAGE_CACHE_NAME/);
  assert.match(serviceWorker, /cache\.put\(request, responseToCache\)/);
});

test("clients check for updates across long-lived tab lifecycles", () => {
  assert.match(updatePrompt, /registration\.update\(\)/);
  assert.match(updatePrompt, /visibilitychange/);
  assert.match(updatePrompt, /window\.addEventListener\("online"/);
  assert.match(updatePrompt, /60 \* 60 \* 1000/);
});

test("service worker source and registration consistently use modules", () => {
  assert.match(nuxtConfig, /injectRegister: false/);
  assert.match(nuxtConfig, /rollupFormat: "es"/);
  assert.match(nuxtConfig, /type: "module"/);
  assert.match(serviceWorkerRegistration, /type: "module"/);
  assert.match(serviceWorkerRegistration, /updateViaCache: "none"/);
  assert.match(serviceWorkerRegistration, /"\/dev-sw\.js\?dev-sw"/);
  assert.match(serviceWorkerRegistration, /: "\/sw\.js"/);
  assert.doesNotMatch(serviceWorkerRegistration, /sw\.js\?build=/);
  assert.match(serviceWorkerRegistration, /let registrationRequest = null/);
  assert.match(updatePrompt, /registerServiceWorker/);
  assert.match(updatePrompt, /if \(import\.meta\.dev/);
});

test("service worker responses cannot be reused across deployments", () => {
  assert.match(nuxtConfig, /"Cache-Control": "no-cache"/);
  assert.match(nuxtConfig, /"CDN-Cache-Control": "no-store"/);
  assert.match(nuxtConfig, /"Cloudflare-CDN-Cache-Control": "no-store"/);
});

test("only the application-owned service worker registrar is enabled", () => {
  assert.match(nuxtConfig, /registerPlugin: false/);
  assert.doesNotMatch(
    serviceWorkerRegistration,
    /navigator\.serviceWorker\.getRegistrations\(\)/,
  );
  assert.doesNotMatch(
    serviceWorkerRegistration,
    /registration\.unregister\(\)/,
  );
  assert.doesNotMatch(installPrompt, /\$pwa/);
  assert.match(installPrompt, /beforeinstallprompt/);
});

test("tabs already controlled by an activated update require one reload", () => {
  assert.match(updatePrompt, /reloadRequired\.value = true/);
  assert.match(
    updatePrompt,
    /if \(reloadRequired\.value\) \{\s*window\.location\.reload\(\)/,
  );
});

test("settings displays the package application version", () => {
  assert.match(nuxtConfig, /appVersion: packageMetadata\.version/);
  assert.match(settings, /dSpeak v\{\{ appVersion \}\}/);
});
