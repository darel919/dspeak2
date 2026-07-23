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
const roomsStore = await readFile(
  new URL("../app/stores/rooms.js", import.meta.url),
  "utf8",
);

test("persistent layout owns NuxtPage while startup keeps its slot mounted", () => {
  assert.match(app, /<NuxtLayout>[\s\S]*<NuxtPage \/>/);
  assert.match(init, /v-show="startupComplete \|\| isAuthPage"/);
  assert.doesNotMatch(init, /<div v-else>/);
});

test("Pinia state remains writable during SSR hydration", () => {
  assert.doesNotMatch(identityStore, /readonly\((nicknames|loadedForUserId)\)/);
  assert.match(
    identityStore,
    /return \{[\s\S]*nicknames,[\s\S]*loadedForUserId,/,
  );
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
