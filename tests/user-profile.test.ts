import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeDisplayName,
  normalizeHandle,
  normalizeNickname,
  profileIdentityLine,
  publicDisplayName,
  publicFullName,
} from "../shared/user-profile.ts";

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

test("public display names prefer the dSpeak username", () => {
  assert.equal(
    publicDisplayName({
      handle: "dspeak_user",
      username: "provider_user",
      display_name: "dSpeak name",
      name: "Google name",
    }),
    "dspeak_user",
  );
  assert.equal(
    publicDisplayName({
      username: "provider_user",
      display_name: "dSpeak name",
    }),
    "provider_user",
  );
  assert.equal(
    publicDisplayName({ display_name: "dSpeak name" }),
    "dSpeak name",
  );
  assert.equal(publicDisplayName({ name: "Google name" }), "Google name");
});

test("public profiles expose one distinct full name", () => {
  assert.equal(
    publicFullName({
      handle: "darelisme",
      username: "darelisme",
      display_name: "Darrell C",
      provider_name: "Darrell Cristanto",
      name: "darelisme",
    }),
    "Darrell C",
  );
  assert.equal(
    publicFullName({
      handle: "darelisme",
      provider_name: "Darrell Cristanto",
    }),
    "Darrell Cristanto",
  );
  assert.equal(
    publicFullName({
      handle: "darelisme",
      display_name: "darelisme",
    }),
    "",
  );
});

test("profile identity lines show nicknames alongside original display names", () => {
  const profile = {
    display_name: "Alfito Yoga",
    handle: "alfito_yoga",
  };

  assert.equal(profileIdentityLine(profile, "Al"), "Al AKA alfito_yoga");
  assert.equal(profileIdentityLine(profile, ""), "alfito_yoga");
  assert.equal(
    profileIdentityLine({ display_name: "Alfito Yoga" }, "Al"),
    "Al AKA Alfito Yoga",
  );
  assert.equal(
    profileIdentityLine(profile, "Alfito Yoga"),
    "Alfito Yoga AKA alfito_yoga",
  );
});
