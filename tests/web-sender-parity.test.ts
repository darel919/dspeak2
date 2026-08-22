import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildP2pVideoSenderOptions,
  buildVideoProduceOptions,
} from "../app/shared/video-settings.ts";

describe("cross-path sender policy parity", () => {
  const context = {
    width: 1280,
    height: 720,
    frameRate: 30,
    screen: false,
  };

  it("emits the same degradation preference on the SFU path", () => {
    const sfu = buildVideoProduceOptions({
      ...context,
      qualityPriority: "framerate",
    });
    assert.equal(sfu.degradationPreference, "maintain-framerate");
  });

  it("keeps degradation preference consistent across priorities", () => {
    const resolution = buildVideoProduceOptions({
      ...context,
      qualityPriority: "resolution",
    });
    const p2pResolution = buildP2pVideoSenderOptions({
      ...context,
      qualityPriority: "resolution",
    });
    assert.equal(resolution.degradationPreference, "maintain-resolution");
    assert.equal(p2pResolution.degradationPreference, "maintain-resolution");
  });

  it("caps P2P encodings at the configured frame rate cadence", () => {
    const options = buildP2pVideoSenderOptions({
      ...context,
      qualityPriority: "framerate",
    });
    const encoding = options.encodings[0];
    assert.ok(encoding);
    assert.equal(encoding.maxFramerate, 30);
    assert.equal(encoding.scaleResolutionDownBy, 1);
  });

  it("defaults to framerate preservation when priority is omitted", () => {
    const options = buildP2pVideoSenderOptions({ ...context });
    assert.equal(options.degradationPreference, "maintain-framerate");
  });
});
