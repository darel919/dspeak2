import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createCodecRoutingPlan,
  selectBestPairCodec,
  validateCodecRoutingPlan,
} from "../app/shared/video-codec-routing.ts";
import {
  emptyVideoCodecCapabilities,
  efficientDecodeCodecs,
  normalizeParticipantMediaCapabilities,
} from "../app/shared/types/video-codec-capabilities.ts";
import type {
  CodecDirectionCapability,
  ParticipantMediaCapabilities,
} from "../app/shared/types/video-codec-capabilities.ts";

function direction(
  acceleration: "hardware" | "software",
  realtimeEfficiency: CodecDirectionCapability["realtimeEfficiency"],
): CodecDirectionCapability {
  return {
    supported: true,
    acceleration,
    realtimeEfficiency,
    implementation:
      acceleration === "hardware" ? "test-hardware" : "test-software",
  };
}

function capabilities(
  codecs: Record<
    string,
    Partial<{
      encode: CodecDirectionCapability;
      decode: CodecDirectionCapability;
    }>
  >,
  maxHardwareSessions = 2,
): ParticipantMediaCapabilities {
  const videoCodecs = emptyVideoCodecCapabilities();
  for (const [codec, value] of Object.entries(codecs)) {
    if (!(codec in videoCodecs)) continue;
    /* SAFETY: The preceding membership check proves this runtime key belongs to the complete codec capability object. */
    const name = codec as keyof typeof videoCodecs;
    videoCodecs[name] = {
      encode: value.encode || videoCodecs[name].encode,
      decode: value.decode || videoCodecs[name].decode,
    };
  }
  return {
    videoCodecs,
    concurrentEncode: {
      supported: maxHardwareSessions > 0,
      maxHardwareSessions,
      confidence: "tested",
    },
    source: "native-runtime-probe",
  };
}

describe("hardware-aware video codec routing", () => {
  it("keeps software AV1 decode separate from hardware support", () => {
    const normalized = normalizeParticipantMediaCapabilities({
      videoCodecDiagnostics: {
        decoders: [
          {
            codec: "AV1",
            supported: true,
            hardware: false,
            implementation: "dav1d",
          },
        ],
      },
    });
    assert.equal(normalized.videoCodecs.AV1.decode.acceleration, "software");
    assert.equal(
      normalized.videoCodecs.AV1.decode.realtimeEfficiency,
      "unusable",
    );
    assert.equal(efficientDecodeCodecs(normalized).includes("AV1"), false);
  });

  it("does not let legacy codec lists override an explicit unsupported direction", () => {
    const normalized = normalizeParticipantMediaCapabilities({
      videoCodecs: {
        AV1: {
          encode: {
            supported: false,
            acceleration: "unsupported",
            realtimeEfficiency: "unusable",
          },
          decode: {
            supported: false,
            acceleration: "unsupported",
            realtimeEfficiency: "unusable",
          },
        },
      },
      videoCodecDiagnostics: {
        encoders: [{ codec: "AV1", hardware: false, implementation: "dav1d" }],
        decoders: [{ codec: "AV1", hardware: false, implementation: "dav1d" }],
      },
    });
    assert.equal(normalized.videoCodecs.AV1.encode.supported, false);
    assert.equal(normalized.videoCodecs.AV1.decode.supported, false);
  });

  it("selects a minimum-cost H264 and VP8 cover instead of an unnecessary AV1 variant", () => {
    const publisher = {
      participantId: "alice",
      logicalStreamId: "user:alice/camera",
      mediaCapabilities: capabilities({
        H264: {
          encode: direction("hardware", "excellent"),
        },
        AV1: {
          encode: direction("hardware", "excellent"),
        },
        VP8: {
          encode: direction("software", "acceptable"),
        },
      }),
    };
    const receivers = [
      {
        participantId: "bob",
        mediaCapabilities: capabilities({
          H264: { decode: direction("hardware", "excellent") },
          AV1: { decode: direction("hardware", "excellent") },
        }),
      },
      {
        participantId: "carol",
        mediaCapabilities: capabilities({
          H264: { decode: direction("hardware", "excellent") },
        }),
      },
      {
        participantId: "dave",
        mediaCapabilities: capabilities({
          VP8: { decode: direction("hardware", "good") },
        }),
      },
    ];
    const plan = createCodecRoutingPlan(publisher, receivers);
    assert.deepEqual(
      plan.desiredVariants.map((variant) => variant.codec).sort(),
      ["H264", "VP8"],
    );
    assert.deepEqual(plan.uncoveredReceivers, []);
    assert.deepEqual(
      plan.desiredVariants.flatMap((variant) => variant.receivers).sort(),
      ["bob", "carol", "dave"],
    );
    assert.equal(
      plan.desiredVariants.some((variant) => variant.codec === "AV1"),
      false,
    );
    assert.deepEqual(validateCodecRoutingPlan(plan, publisher, receivers), {
      valid: true,
      errors: [],
    });
  });

  it("selects the efficient pair intersection for direct P2P", () => {
    const publisher = {
      participantId: "alice",
      logicalStreamId: "user:alice/camera",
      mediaCapabilities: capabilities({
        H264: { encode: direction("hardware", "excellent") },
        VP8: { encode: direction("software", "acceptable") },
      }),
    };
    const receiver = {
      participantId: "dave",
      mediaCapabilities: capabilities({
        VP8: { decode: direction("hardware", "good") },
      }),
    };
    assert.equal(selectBestPairCodec(publisher, receiver), "VP8");
  });

  it("honors measured software resolution and frame-rate ceilings", () => {
    const publisher = {
      participantId: "alice",
      logicalStreamId: "user:alice/camera",
      mediaCapabilities: capabilities({
        VP8: {
          encode: {
            ...direction("software", "acceptable"),
            maxWidth: 640,
            maxHeight: 360,
            maxFps: 15,
          },
        },
      }),
    };
    const receiver = {
      participantId: "dave",
      mediaCapabilities: capabilities({
        VP8: {
          decode: {
            ...direction("software", "acceptable"),
            maxWidth: 640,
            maxHeight: 360,
            maxFps: 15,
          },
        },
      }),
    };
    assert.equal(
      selectBestPairCodec(publisher, receiver, {
        target: { width: 1280, height: 720, fps: 30 },
      }),
      null,
    );
    assert.equal(
      selectBestPairCodec(publisher, receiver, {
        target: { width: 640, height: 360, fps: 15 },
      }),
      "VP8",
    );
  });

  it("adapts a measured software path to a safe target", () => {
    const publisher = {
      participantId: "alice",
      logicalStreamId: "user:alice/camera",
      mediaCapabilities: capabilities({
        VP8: {
          encode: {
            ...direction("software", "acceptable"),
            maxWidth: 640,
            maxHeight: 360,
            maxFps: 15,
          },
        },
      }),
    };
    const receiver = {
      participantId: "dave",
      mediaCapabilities: capabilities({
        VP8: {
          decode: {
            ...direction("software", "acceptable"),
            maxWidth: 640,
            maxHeight: 360,
            maxFps: 15,
          },
        },
      }),
    };
    const plan = createCodecRoutingPlan(publisher, [receiver], {
      target: { width: 1920, height: 1080, fps: 30 },
      allowTargetAdaptation: true,
    });
    assert.equal(plan.desiredVariants[0]?.codec, "VP8");
    assert.deepEqual(plan.desiredVariants[0]?.target, {
      width: 640,
      height: 360,
      fps: 15,
    });
    assert.equal(plan.desiredVariants[0]?.targetAdjusted, true);
    assert.deepEqual(plan.uncoveredReceivers, []);
    assert.deepEqual(
      validateCodecRoutingPlan(plan, publisher, [receiver], {
        target: { width: 1920, height: 1080, fps: 30 },
        allowTargetAdaptation: true,
      }),
      { valid: true, errors: [] },
    );
  });

  it("does not select a poor software path without explicit emergency mode", () => {
    const publisher = {
      participantId: "alice",
      logicalStreamId: "user:alice/camera",
      mediaCapabilities: capabilities({
        VP9: { encode: direction("software", "poor") },
      }),
    };
    const receiver = {
      participantId: "dave",
      mediaCapabilities: capabilities({
        VP9: { decode: direction("software", "poor") },
      }),
    };
    const stablePlan = createCodecRoutingPlan(publisher, [receiver]);
    assert.deepEqual(stablePlan.desiredVariants, []);
    assert.deepEqual(stablePlan.uncoveredReceivers, ["dave"]);
    const emergencyPlan = createCodecRoutingPlan(publisher, [receiver], {
      allowEmergencySoftware: true,
    });
    assert.equal(emergencyPlan.desiredVariants[0]?.codec, "VP9");
    assert.deepEqual(emergencyPlan.emergencyReceivers, ["dave"]);
    assert.equal(emergencyPlan.desiredVariants[0]?.emergency, true);
  });

  it("does not produce an invalid two-hardware-session plan", () => {
    const publisher = {
      participantId: "alice",
      logicalStreamId: "user:alice/camera",
      mediaCapabilities: capabilities(
        {
          H264: { encode: direction("hardware", "excellent") },
          AV1: { encode: direction("hardware", "excellent") },
        },
        1,
      ),
    };
    const receivers = [
      {
        participantId: "bob",
        mediaCapabilities: capabilities({
          H264: { decode: direction("hardware", "excellent") },
        }),
      },
      {
        participantId: "carol",
        mediaCapabilities: capabilities({
          AV1: { decode: direction("hardware", "excellent") },
        }),
      },
    ];
    const plan = createCodecRoutingPlan(publisher, receivers);
    assert.equal(plan.variantCount, 0);
    assert.deepEqual(plan.uncoveredReceivers.sort(), ["bob", "carol"]);
  });

  it("assumes one hardware session when concurrent capacity is unknown", () => {
    const publisher = {
      participantId: "alice",
      logicalStreamId: "user:alice/camera",
      mediaCapabilities: {
        ...capabilities({
          H264: { encode: direction("hardware", "excellent") },
          AV1: { encode: direction("hardware", "excellent") },
        }),
        concurrentEncode: {
          supported: false,
          confidence: "unknown" as const,
        },
      },
    };
    const receivers = [
      {
        participantId: "bob",
        mediaCapabilities: capabilities({
          H264: { decode: direction("hardware", "excellent") },
        }),
      },
      {
        participantId: "carol",
        mediaCapabilities: capabilities({
          AV1: { decode: direction("hardware", "excellent") },
        }),
      },
    ];
    const plan = createCodecRoutingPlan(publisher, receivers);
    assert.equal(plan.variantCount, 0);
    assert.deepEqual(plan.uncoveredReceivers.sort(), ["bob", "carol"]);
  });

  it("rejects an untested hardware codec pair", () => {
    const publisher = {
      participantId: "alice",
      logicalStreamId: "user:alice/camera",
      mediaCapabilities: {
        ...capabilities({
          H264: { encode: direction("hardware", "excellent") },
          AV1: { encode: direction("hardware", "excellent") },
        }),
        concurrentEncode: {
          supported: true,
          maxHardwareSessions: 2,
          confidence: "tested" as const,
          testedCodecPairs: [["H264", "VP8"]],
        },
      },
    };
    const receivers = [
      {
        participantId: "bob",
        mediaCapabilities: capabilities({
          H264: { decode: direction("hardware", "excellent") },
        }),
      },
      {
        participantId: "carol",
        mediaCapabilities: capabilities({
          AV1: { decode: direction("hardware", "excellent") },
        }),
      },
    ];
    const plan = createCodecRoutingPlan(publisher, receivers);
    assert.equal(plan.variantCount, 0);
    assert.deepEqual(plan.uncoveredReceivers.sort(), ["bob", "carol"]);
  });

  it("rejects a plan that claims coverage without listing every receiver", () => {
    const publisher = {
      participantId: "alice",
      logicalStreamId: "user:alice/camera",
      mediaCapabilities: capabilities({
        H264: { encode: direction("hardware", "excellent") },
      }),
    };
    const receivers = [
      {
        participantId: "bob",
        mediaCapabilities: capabilities({
          H264: { decode: direction("hardware", "excellent") },
        }),
      },
      {
        participantId: "carol",
        mediaCapabilities: capabilities({
          H264: { decode: direction("hardware", "excellent") },
        }),
      },
    ];
    const plan = createCodecRoutingPlan(publisher, receivers);
    plan.desiredVariants[0].receivers = ["bob"];
    plan.uncoveredReceivers = [];
    assert.equal(
      validateCodecRoutingPlan(plan, publisher, receivers).valid,
      false,
    );
    assert.match(
      validateCodecRoutingPlan(plan, publisher, receivers).errors.join(","),
      /uncovered-receiver-carol/,
    );
  });

  it("keeps a multi-variant plan within an explicit upload budget", () => {
    const publisher = {
      participantId: "alice",
      logicalStreamId: "user:alice/camera",
      mediaCapabilities: capabilities({
        H264: { encode: direction("hardware", "excellent") },
        VP8: { encode: direction("software", "acceptable") },
      }),
    };
    const receivers = [
      {
        participantId: "bob",
        mediaCapabilities: capabilities({
          H264: { decode: direction("hardware", "excellent") },
        }),
      },
      {
        participantId: "dave",
        mediaCapabilities: capabilities({
          VP8: { decode: direction("hardware", "good") },
        }),
      },
    ];
    const target = { width: 1280, height: 720, fps: 30, bitrate: 1_000_000 };
    const rejected = createCodecRoutingPlan(publisher, receivers, {
      target,
      maxUploadBitrateBps: 2_000_000,
    });
    assert.equal(rejected.variantCount, 0);
    const accepted = createCodecRoutingPlan(publisher, receivers, {
      target,
      maxUploadBitrateBps: 2_200_000,
    });
    assert.deepEqual(
      accepted.desiredVariants.map((variant) => variant.estimatedBitrateBps),
      [1_000_000, 1_150_000],
    );
    assert.equal(accepted.estimatedUploadBitrateBps, 2_150_000);
    assert.deepEqual(
      validateCodecRoutingPlan(accepted, publisher, receivers, {
        target,
        maxUploadBitrateBps: 2_200_000,
      }),
      { valid: true, errors: [] },
    );
  });
});
