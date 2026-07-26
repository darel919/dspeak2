import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  boundedStorageMap,
  browserStorageMetric,
  updateBoundedStorageMap,
} from "../app/shared/bounded-browser-storage.js";

test("growing preference maps retain only their newest bounded entries", () => {
  const source = Object.fromEntries(
    Array.from({ length: 5 }, (_, index) => [`item-${index}`, index]),
  );
  assert.deepEqual(boundedStorageMap(source, 2), {
    "item-3": 3,
    "item-4": 4,
  });
  assert.deepEqual(updateBoundedStorageMap(source, "item-1", 10, 3), {
    "item-3": 3,
    "item-4": 4,
    "item-1": 10,
  });
});

test("browser storage telemetry exposes size without stored values", () => {
  const metric = browserStorageMetric("preference", { privateId: 50 });
  assert.equal(metric.key, "preference");
  assert.equal(metric.entries, 1);
  assert.equal(metric.bytes, 16);
  assert.equal("value" in metric, false);
});

test("authentication redirects use tab-scoped storage", async () => {
  const auth = await readFile(
    new URL("../app/pages/auth.vue", import.meta.url),
    "utf8",
  );
  const join = await readFile(
    new URL("../app/pages/join/[roomId].vue", import.meta.url),
    "utf8",
  );
  assert.match(auth, /sessionStorage\.getItem/);
  assert.match(auth, /sessionStorage\.removeItem/);
  assert.match(join, /sessionStorage\.setItem/);
  assert.doesNotMatch(`${auth}\n${join}`, /localStorage.*redirectAfterAuth/);
});
