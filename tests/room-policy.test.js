import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canManageMember,
  canManageRole,
  canModerateVoiceMember,
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

test("member management requires permission and protects equal or system roles", () => {
  const admin = [{ position: 750, permissions: ["room.manage_members"] }];
  assert.equal(canManageMember(admin, [{ position: 100 }]), true);
  assert.equal(canManageMember(admin, [{ position: 750 }]), false);
  assert.equal(canManageMember([], [{ position: 100 }]), false);
  assert.equal(canManageMember(admin, [{ position: 1, system: true }]), false);
  assert.equal(canManageMember([], [{ position: 750 }], true), true);
});

test("voice moderation requires its permission and protects role hierarchy", () => {
  const admin = [{ position: 750, permissions: ["channel.moderate_voice"] }];
  assert.equal(canModerateVoiceMember(admin, [{ position: 100 }]), true);
  assert.equal(canModerateVoiceMember(admin, [{ position: 750 }]), false);
  assert.equal(canModerateVoiceMember([], [{ position: 100 }]), false);
  assert.equal(
    canModerateVoiceMember(admin, [{ position: 1, system: true }]),
    false,
  );
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
