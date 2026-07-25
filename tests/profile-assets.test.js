import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  profileAssetUrl,
  profileInitials,
} from "../app/shared/profile-assets.js";
import { avatarFileName, sameOriginAvatarPath } from "../shared/avatar-path.js";

test("profileAssetUrl normalizes protected avatar paths", () => {
  assert.equal(
    profileAssetUrl(
      "auth/assets/avatar?userId=one&fileName=face.jpg",
      "https://api.example.com/",
    ),
    "/api/assets/avatar?userId=one&fileName=face.jpg",
  );
  assert.equal(
    profileAssetUrl("assets/avatar?userId=one", "https://api.example.com"),
    "/api/assets/avatar?userId=one",
  );
  assert.equal(profileAssetUrl("face.jpg", "https://api.example.com"), null);
});

test("profileAssetUrl localizes account avatars and rejects remote assets", () => {
  assert.equal(
    profileAssetUrl(
      "https://api.example.com/auth/assets/avatar?userId=one&fileName=face.jpg",
    ),
    "/api/assets/avatar?userId=one&fileName=face.jpg",
  );
  assert.equal(
    profileAssetUrl("https://cdn.example.com/avatar.webp", ""),
    null,
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

test("server avatar paths always use the same-origin proxy", () => {
  assert.equal(
    avatarFileName(
      "https://api.example.com/auth/assets/avatar?userId=one&fileName=face.jpg",
    ),
    "face.jpg",
  );
  assert.equal(
    sameOriginAvatarPath({
      id: "one",
      avatar:
        "https://api.example.com/auth/assets/avatar?userId=one&fileName=face.jpg",
    }),
    "/api/assets/avatar?userId=one&fileName=face.jpg",
  );
  assert.equal(
    avatarFileName("https://cdn.example.com/image?fileName=face.jpg"),
    "",
  );
});

test("avatar proxy retains the PocketBase collection metadata needed for file URLs", () => {
  const source = readFileSync(
    new URL("../server/utils/dspeak-api.js", import.meta.url),
    "utf8",
  );
  const avatarHandler = source.slice(
    source.indexOf("async function handleAssets"),
    source.indexOf("export async function handleDspeakApi"),
  );

  assert.match(
    avatarHandler,
    /fields: "id,avatar,collectionId,collectionName"/,
  );
  assert.match(avatarHandler, /pb\.files\.getURL\(user, user\.avatar\)/);
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
