import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("../app/app.vue", import.meta.url), "utf8");
const identityStore = await readFile(
  new URL("../app/stores/identity.js", import.meta.url),
  "utf8",
);
const init = await readFile(
  new URL("../app/components/Init.vue", import.meta.url),
  "utf8",
);
const homePage = await readFile(
  new URL("../app/pages/index.vue", import.meta.url),
  "utf8",
);
const roomsStore = await readFile(
  new URL("../app/stores/rooms.js", import.meta.url),
  "utf8",
);
const authStore = await readFile(
  new URL("../app/stores/auth.js", import.meta.url),
  "utf8",
);
const authMiddleware = await readFile(
  new URL("../app/middleware/auth.global.js", import.meta.url),
  "utf8",
);

test("persistent layout keeps NuxtPage mounted behind global route auth", () => {
  assert.match(app, /<NuxtLayout>[\s\S]*<NuxtPage \/>/);
  assert.match(init, /v-if="startupComplete \|\| isAuthPage"/);
  assert.doesNotMatch(init, /<div v-else>/);
  assert.doesNotMatch(init, /v-if="canMountPage"/);
  assert.match(
    authMiddleware,
    /const authenticated = await authStore\.ensureSession\(\)/,
  );
  assert.match(
    authMiddleware,
    /sessionStorage\.setItem\("redirectAfterAuth", to\.fullPath\)/,
  );
  assert.match(authMiddleware, /navigateTo\("\/auth", \{ replace: true \}\)/);
  assert.match(
    authStore,
    /if \(sessionCheckPromise\) return sessionCheckPromise/,
  );
});

test("Pinia state remains writable during SSR hydration", () => {
  assert.doesNotMatch(identityStore, /readonly\((nicknames|loadedForUserId)\)/);
  assert.match(
    identityStore,
    /return \{[\s\S]*nicknames,[\s\S]*loadedForUserId,/,
  );
});

test("home authentication branches remain stable through hydration", () => {
  assert.match(homePage, /const clientMounted = ref\(false\)/);
  assert.match(
    homePage,
    /Boolean\(clientMounted\.value && authStore\.getUserData\(\)\)/,
  );
  assert.match(homePage, /clientMounted\.value = true/);
});

test("rooms state is isolated inside each SSR Pinia instance", () => {
  const storeStart = roomsStore.indexOf(
    'export const useRoomsStore = defineStore("rooms", () => {',
  );
  for (const declaration of [
    "const rooms = ref([]);",
    "const loading = ref(false);",
    "const error = ref(null);",
  ]) {
    assert.ok(
      roomsStore.indexOf(declaration) > storeStart,
      `${declaration} must be created inside the store`,
    );
  }
});
