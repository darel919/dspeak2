import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  profileAssetUrl,
  profileInitials,
} from "../app/shared/profile-assets.js";

test("profileAssetUrl normalizes protected avatar paths", () => {
  assert.equal(
    profileAssetUrl(
      "auth/assets/avatar?userId=one&fileName=face.jpg",
      "https://api.example.com/",
    ),
    "https://api.example.com/auth/assets/avatar?userId=one&fileName=face.jpg",
  );
  assert.equal(
    profileAssetUrl("assets/avatar?userId=one", "https://api.example.com"),
    "https://api.example.com/auth/assets/avatar?userId=one",
  );
  assert.equal(
    profileAssetUrl("face.jpg", "https://api.example.com"),
    "https://api.example.com/files/face.jpg",
  );
});

test("profileAssetUrl preserves absolute and local paths", () => {
  assert.equal(
    profileAssetUrl("https://cdn.example.com/avatar.webp", ""),
    "https://cdn.example.com/avatar.webp",
  );
  assert.equal(
    profileAssetUrl("/images/avatar.webp", ""),
    "/images/avatar.webp",
  );
  assert.equal(
    profileAssetUrl(
      "/api/assets/avatar?userId=one&fileName=face.jpg",
      "https://api.example.com",
    ),
    "/api/assets/avatar?userId=one&fileName=face.jpg",
  );
  assert.equal(profileAssetUrl("", "https://api.example.com"), null);
});

test("profileInitials derives a stable fallback", () => {
  assert.equal(profileInitials(" Mas Yoga "), "MY");
  assert.equal(profileInitials(""), "");
});

test("voice participant tiles use the shared avatar fallback", () => {
  const source = readFileSync(
    new URL("../app/components/VoiceChannel.vue", import.meta.url),
    "utf8",
  );

  assert.match(source, /<ProfileAvatar/);
  assert.match(source, /:src="userAvatarSource\(tile\.user\)"/);
  assert.match(source, /return currentUser\.avatar \|\| ""/);
  assert.doesNotMatch(source, /function getUserAvatar/);
});

test("channel participant avatars prefer the current auth profile", () => {
  const source = readFileSync(
    new URL("../app/components/ChannelList.vue", import.meta.url),
    "utf8",
  );

  assert.match(source, /return currentUser\.avatar \|\| null/);
  assert.equal(source.match(/<ProfileAvatar/g)?.length, 2);
});
