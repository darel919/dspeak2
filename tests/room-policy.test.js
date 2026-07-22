import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canManageRole,
  getEffectivePermissions,
  normalizeAttenuation,
  normalizeRoomAccent,
} from "../shared/room-policy.js";

test("room permissions combine multiple roles without duplicates", () => {
  assert.deepEqual(
    getEffectivePermissions([
      { permissions: ["channel.create", "channel.update"] },
      { permissions: ["channel.update", "message.moderate"] },
    ]),
    ["channel.create", "channel.update", "message.moderate"],
  );
});

test("role hierarchy protects system and equal roles", () => {
  const actor = [{ position: 500, permissions: ["room.manage_roles"] }];
  assert.equal(canManageRole(actor, { position: 100, system: false }), true);
  assert.equal(canManageRole(actor, { position: 500, system: false }), false);
  assert.equal(canManageRole(actor, { position: 1, system: true }), false);
});

test("room appearance and attenuation use safe defaults", () => {
  assert.equal(normalizeRoomAccent("unknown"), "cobalt");
  assert.deepEqual(normalizeAttenuation({ reductionPercent: 80 }), {
    enabled: true,
    reductionPercent: 80,
    attackMs: 120,
    releaseMs: 650,
  });
});

test("legacy rooms with null attenuation receive safe defaults", () => {
  assert.deepEqual(normalizeAttenuation(null), {
    enabled: true,
    reductionPercent: 65,
    attackMs: 120,
    releaseMs: 650,
  });
});
