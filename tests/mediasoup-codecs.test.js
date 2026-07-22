import test from "node:test";
import assert from "node:assert/strict";
import { mediaCodecs } from "../server/utils/mediasoup-codecs.js";

test("H264 router capabilities offer hardware-efficient profiles with a compatibility fallback", () => {
  const h264 = mediaCodecs.filter((codec) => codec.mimeType === "video/H264");

  assert.deepEqual(
    h264.map((codec) => codec.parameters["profile-level-id"]),
    ["42001f", "4d001f", "42e01f"],
  );
  assert.ok(
    h264.every((codec) => codec.parameters["level-asymmetry-allowed"] === 1),
  );
  assert.ok(
    h264.every((codec) => codec.parameters["packetization-mode"] === 1),
  );
});

test("router offers interoperable VP9 profile 0", () => {
  const vp9 = mediaCodecs.find((codec) => codec.mimeType === "video/VP9");

  assert.ok(vp9);
  assert.equal(vp9.clockRate, 90000);
  assert.equal(vp9.parameters["profile-id"], 0);
});
