import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isNavigationAccessError,
  navigationErrorStatus,
} from "../app/composables/useNavigationError.ts";

const errorPage = await readFile(
  new URL("../app/error.vue", import.meta.url),
  "utf8",
);
const presence = await readFile(
  new URL("../app/composables/usePresence.ts", import.meta.url),
  "utf8",
);

test("navigation access errors normalize common API error shapes", () => {
  assert.equal(navigationErrorStatus({ statusCode: 403 }), 403);
  assert.equal(navigationErrorStatus({ status: 404 }), 404);
  assert.equal(navigationErrorStatus({ response: { status: 403 } }), 403);
  assert.equal(navigationErrorStatus({ data: { statusCode: 404 } }), 404);
  assert.equal(isNavigationAccessError({ status: 403 }), true);
  assert.equal(isNavigationAccessError({ status: 500 }), false);
});

test("the application error surface owns invalid and unauthorized links", () => {
  assert.match(errorPage, /statusCode\.value === 403/);
  assert.match(errorPage, /statusCode\.value === 404/);
  assert.match(errorPage, /Invalid link/);
  assert.match(errorPage, /clearError\(\{ redirect: "\/" \}\)/);
});

test("global presence channel teardown is idempotent and owned by the composable scope", () => {
  assert.match(presence, /openRealtimeChannel\("global"/);
  assert.match(presence, /closeChannel/);
  assert.match(presence, /onScopeDispose\(\(\) => \{/);
  assert.doesNotMatch(presence, /new WebSocket/);
});
