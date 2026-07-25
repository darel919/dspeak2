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
const updateCoordinator = await readFile(
  new URL("../app/composables/usePwaUpdate.js", import.meta.url),
  "utf8",
);
const init = await readFile(
  new URL("../app/components/Init.vue", import.meta.url),
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

test("startup updates activate automatically before application bootstrap", () => {
  assert.match(nuxtConfig, /registerType: "prompt"/);
  assert.doesNotMatch(serviceWorker, /\.then\(\(\) => self\.skipWaiting/);
  assert.match(serviceWorker, /event\.data\.type === "SKIP_WAITING"/);
  assert.match(init, /await runStartupUpdate\(\)/);
  assert.match(init, /Checking for updates/);
  assert.match(updateCoordinator, /activateWaitingWorker\("startup"\)/);
  assert.match(updateCoordinator, /worker\.postMessage/);
  assert.match(updateCoordinator, /controllerchange/);
  assert.match(updateCoordinator, /window\.location\.reload/);
});

test("startup activation is bounded and guarded against reload loops", () => {
  assert.match(updateCoordinator, /STARTUP_RESTART_GUARD/);
  assert.match(updateCoordinator, /startupRestartGuard/);
  assert.match(updateCoordinator, /setStartupRestartGuard/);
  assert.match(updateCoordinator, /clearStartupRestartGuard/);
  assert.match(updateCoordinator, /storedGuard === "attempted"/);
  assert.match(updateCoordinator, /guardedVersion !== updateIdentity/);
  assert.match(updateCoordinator, /workerVersion/);
  assert.match(updateCoordinator, /INSTALL_WAIT_MS = 10000/);
  assert.match(updateCoordinator, /ACTIVATION_WAIT_MS = 5000/);
  assert.match(updateCoordinator, /reloadStarted/);
  assert.match(updateCoordinator, /startupFinished\.value = true/);
});

test("a controller handoff during startup always completes the reload", () => {
  assert.match(
    updateCoordinator,
    /if \(!activeRuntime\.startupFinished\.value\) \{\s*reloadApplication\(activeRuntime\)/,
  );
  assert.doesNotMatch(
    updateCoordinator,
    /!activeRuntime\.startupFinished\.value &&\s*!startupRestartGuard/,
  );
  assert.doesNotMatch(
    updateCoordinator,
    /guardedVersion === updateIdentity[\s\S]{0,100}return/,
  );
});

test("a worker discovered during startup can never arm the session prompt", () => {
  assert.match(updateCoordinator, /startupWorker: null/);
  assert.match(
    updateCoordinator,
    /!activeRuntime\.startupFinished\.value\)\s*activeRuntime\.startupWorker = worker/,
  );
  assert.match(
    updateCoordinator,
    /activeRuntime\.registration\.waiting !== activeRuntime\.startupWorker/,
  );
  assert.match(
    updateCoordinator,
    /activeRuntime\.startupWorker = activeRuntime\.registration\.waiting/,
  );
  assert.match(
    updateCoordinator,
    /activeRuntime\.updateAvailable\.value = false/,
  );
  assert.match(
    updateCoordinator,
    /activeRuntime\.registration\?\.active === activeRuntime\.startupWorker[\s\S]{0,100}reloadApplication\(activeRuntime\)/,
  );
});

test("service worker exposes its exact precache version to the startup guard", () => {
  assert.match(serviceWorker, /event\.data\.type === "GET_VERSION"/);
  assert.match(serviceWorker, /version: PRECACHE_NAME/);
  assert.match(updateCoordinator, /new MessageChannel\(\)/);
  assert.match(updateCoordinator, /type: "GET_VERSION"/);
  assert.match(init, /Updating dSpeak/);
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
  assert.match(updateCoordinator, /registration\.update\(\)/);
  assert.match(updateCoordinator, /visibilitychange/);
  assert.match(updateCoordinator, /window\.addEventListener\("online"/);
  assert.match(updateCoordinator, /60 \* 60 \* 1000/);
  assert.match(updatePrompt, /startActiveMonitoring/);
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
  assert.match(
    serviceWorkerRegistration,
    /createPolicy\(\s*TRUSTED_TYPES_POLICY_NAME/,
  );
  assert.match(serviceWorkerRegistration, /value !== SERVICE_WORKER_URL/);
  assert.match(
    serviceWorkerRegistration,
    /\.register\(serviceWorkerScriptUrl\(\), SERVICE_WORKER_OPTIONS\)/,
  );
  assert.match(updateCoordinator, /registerServiceWorker/);
  assert.match(updateCoordinator, /if \(\s*import\.meta\.dev/);
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
  assert.match(updateCoordinator, /reloadRequired\.value = true/);
  assert.match(
    updateCoordinator,
    /if \(reloadRequired\.value\) \{\s*reloadApplication\(activeRuntime\)/,
  );
});

test("settings displays the package application version", () => {
  assert.match(nuxtConfig, /appVersion: packageMetadata\.version/);
  assert.match(settings, /dSpeak v\{\{ appVersion \}\}/);
});
