import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeDisplayName,
  normalizeHandle,
  normalizeNickname,
  profileIdentityLine,
  publicDisplayName,
} from "../shared/user-profile.js";

test("public profile names are normalized and bounded", () => {
  assert.equal(normalizeDisplayName("  Darel   Isme  "), "Darel Isme");
  assert.throws(() => normalizeDisplayName("D"), /2–32 characters/);
  assert.throws(() => normalizeDisplayName("x".repeat(33)), /2–32 characters/);
});

test("user handles are canonical and accept only stable URL-safe characters", () => {
  assert.equal(normalizeHandle("  Darel_Isme  "), "darel_isme");
  assert.equal(normalizeHandle("user123"), "user123");
  assert.throws(() => normalizeHandle("ab"), /3–32 characters/);
  assert.throws(() => normalizeHandle("Darel Isme"), /only lowercase letters/);
  assert.throws(() => normalizeHandle("darel-isme"), /only lowercase letters/);
});

test("personal nicknames can be cleared and remain bounded", () => {
  assert.equal(normalizeNickname("  Game   Night  "), "Game Night");
  assert.equal(normalizeNickname("  "), "");
  assert.throws(() => normalizeNickname("x".repeat(33)), /32 characters/);
});

test("public display names prefer the dSpeak override", () => {
  assert.equal(
    publicDisplayName({ display_name: "dSpeak name", name: "Google name" }),
    "dSpeak name",
  );
  assert.equal(publicDisplayName({ name: "Google name" }), "Google name");
});

test("profile identity lines show nicknames alongside original display names", () => {
  const profile = {
    display_name: "Alfito Yoga",
    handle: "alfito_yoga",
  };

  assert.equal(profileIdentityLine(profile, "Al"), "Al AKA Alfito Yoga");
  assert.equal(profileIdentityLine(profile, ""), "Alfito Yoga");
  assert.equal(
    profileIdentityLine({ display_name: "Alfito Yoga" }, "Al"),
    "Al AKA Alfito Yoga",
  );
  assert.equal(profileIdentityLine(profile, "Alfito Yoga"), "Alfito Yoga");
});
