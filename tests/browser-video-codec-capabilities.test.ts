import assert from "node:assert/strict";
import test from "node:test";
import { probeBrowserVideoCodecCapabilities } from "../app/shared/browser-video-codec-capabilities.ts";

function codec(mimeType: string, sdpFmtpLine = "") {
  return { mimeType, sdpFmtpLine };
}

test("browser codec probing keeps encode and decode evidence independent", async () => {
  const capabilities = await probeBrowserVideoCodecCapabilities({
    sender: {
      getCapabilities: () => ({
        codecs: [codec("video/H264", "packetization-mode=1")],
      }),
    },
    receiver: {
      getCapabilities: () => ({
        codecs: [codec("video/VP8")],
      }),
    },
    mediaCapabilities: {
      encodingInfo: async () => ({
        supported: true,
        smooth: true,
        powerEfficient: true,
      }),
      decodingInfo: async () => ({
        supported: true,
        smooth: true,
        powerEfficient: false,
      }),
    },
  });

  assert.equal(capabilities.source, "browser-probe");
  assert.equal(capabilities.videoCodecs.H264.encode.supported, true);
  assert.equal(capabilities.videoCodecs.H264.encode.acceleration, "hardware");
  assert.equal(capabilities.videoCodecs.H264.decode.supported, false);
  assert.equal(capabilities.videoCodecs.VP8.encode.supported, false);
  assert.equal(capabilities.videoCodecs.VP8.decode.supported, true);
  assert.equal(capabilities.videoCodecs.VP8.decode.acceleration, "software");
  assert.equal(
    capabilities.videoCodecs.VP8.decode.realtimeEfficiency,
    "acceptable",
  );
  assert.equal(capabilities.concurrentEncode.maxHardwareSessions, 1);
  assert.equal(
    capabilities.concurrentEncode.confidence,
    "conservative-default",
  );
});

test("browser codec probing fails closed when browser codec APIs are absent", async () => {
  const capabilities = await probeBrowserVideoCodecCapabilities({});

  for (const codec of Object.values(capabilities.videoCodecs)) {
    assert.equal(codec.encode.supported, false);
    assert.equal(codec.decode.supported, false);
  }
  assert.equal(capabilities.concurrentEncode.supported, false);
  assert.equal(capabilities.source, "browser-probe");
});

test("browser codec probing honors an explicit MediaCapabilities rejection", async () => {
  const capabilities = await probeBrowserVideoCodecCapabilities({
    sender: {
      getCapabilities: () => ({
        codecs: [codec("video/AV1")],
      }),
    },
    receiver: {
      getCapabilities: () => ({
        codecs: [codec("video/AV1")],
      }),
    },
    mediaCapabilities: {
      encodingInfo: async () => ({
        supported: false,
        smooth: false,
        powerEfficient: false,
      }),
      decodingInfo: async () => ({
        supported: false,
        smooth: false,
        powerEfficient: false,
      }),
    },
  });

  assert.equal(capabilities.videoCodecs.AV1.encode.supported, false);
  assert.equal(capabilities.videoCodecs.AV1.decode.supported, false);
});
