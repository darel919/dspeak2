import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NativeMediasoupSfuSession } from "../app/shared/native-mediasoup-session.ts";
import type {
  ParticipantMediaCapabilities,
  VideoCodecName,
} from "../app/shared/types/video-codec-capabilities.ts";
import type { CodecRoutingPlan } from "../app/shared/video-codec-routing.ts";
import {
  parseExternalRecord,
  parseExternalString,
} from "../shared/types/external.ts";

function capabilities(
  encode: VideoCodecName[],
  decode: VideoCodecName[] = encode,
): ParticipantMediaCapabilities {
  const names = ["H264", "H265", "VP8", "VP9", "AV1"] as const;
  return {
    /* SAFETY: The fixed codec tuple supplies every video-codec key with the required direction fields. */
    videoCodecs: Object.fromEntries(
      names.map((codec) => [
        codec,
        {
          encode: encode.includes(codec)
            ? {
                supported: true,
                acceleration: codec === "VP8" ? "software" : "hardware",
                implementation: codec === "VP8" ? "libvpx" : "VideoToolbox",
                realtimeEfficiency:
                  codec === "VP8" ? "acceptable" : "excellent",
              }
            : {
                supported: false,
                acceleration: "unsupported",
                realtimeEfficiency: "unusable",
              },
          decode: decode.includes(codec)
            ? {
                supported: true,
                acceleration: codec === "VP8" ? "software" : "hardware",
                implementation: codec === "VP8" ? "libvpx" : "VideoToolbox",
                realtimeEfficiency:
                  codec === "VP8" ? "acceptable" : "excellent",
              }
            : {
                supported: false,
                acceleration: "unsupported",
                realtimeEfficiency: "unusable",
              },
        },
      ]),
    ) as ParticipantMediaCapabilities["videoCodecs"],
    concurrentEncode: {
      supported: true,
      maxHardwareSessions: 2,
      confidence: "tested",
    },
    source: "native-runtime-probe",
  };
}

function plan(): CodecRoutingPlan {
  return {
    publisher: "alice",
    logicalStreamId: "user:alice/camera",
    source: "camera",
    desiredVariants: [
      {
        codec: "H264",
        receivers: ["bob", "carol"],
        score: 1,
        hardwareEncode: true,
        variantId: "user:alice/camera:h264",
        generation: 2,
      },
      {
        codec: "VP8",
        receivers: ["dave"],
        score: 2,
        hardwareEncode: false,
        variantId: "user:alice/camera:vp8",
        generation: 2,
      },
    ],
    uncoveredReceivers: [],
    emergencyReceivers: [],
    variantCount: 2,
    createdAt: Date.now(),
  };
}

function configureReceivers(
  session: NativeMediasoupSfuSession,
  participantIds: string[],
) {
  const mediaCapabilities = capabilities(["H264", "VP8", "AV1"]);
  session.lastInRoom = participantIds.map((peerId) => ({ peerId }));
  for (const peerId of participantIds)
    session.remoteParticipantCapabilities.set(peerId, mediaCapabilities);
}

describe("native publisher codec variants", () => {
  it("publishes one producer per planned codec variant with stable metadata", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const session = new NativeMediasoupSfuSession({
      invoke: async (operation, payload) => {
        calls.push([operation, payload || {}]);
        if (operation === "media_create_capture_producer")
          return { id: `producer-${String(payload?.producerKey || "base")}` };
        return {};
      },
      mediaCapabilities: capabilities(["H264", "VP8"]),
    });
    session.closed = false;
    session.sendTransport = {
      id: "send",
      handle: 1,
      direction: "send",
      closed: false,
    };
    session.device = {
      handle: "device",
      rtpCapabilities: {
        codecs: [
          { mimeType: "video/H264", clockRate: 90000 },
          { mimeType: "video/VP8", clockRate: 90000 },
        ],
      },
    };
    session.sources.set("camera", {
      source: "camera",
      kind: "video",
      logicalStreamId: "user:alice/camera",
      generation: 1,
      track: { kind: "video" },
    });
    configureReceivers(session, ["bob", "carol", "dave"]);

    assert.equal(await session.applyCodecRoutingPlan(plan()), true);
    assert.deepEqual(
      [...session.producerVariants.values()].map((producer) => [
        producer.entry.variantId,
        producer.entry.codec,
      ]),
      [
        ["user:alice/camera:h264", "H264"],
        ["user:alice/camera:vp8", "VP8"],
      ],
    );
    const createCalls = calls.filter(
      ([operation]) => operation === "media_create_capture_producer",
    );
    assert.equal(createCalls.length, 2);
    assert.equal(
      createCalls[0][1].appData.codecParameters.mimeType,
      "video/H264",
    );
    assert.equal(
      createCalls[1][1].appData.codecParameters.mimeType,
      "video/VP8",
    );
  });

  it("stages the routing plan before a candidate can acknowledge readiness", async () => {
    const session = new NativeMediasoupSfuSession({
      invoke: async (operation, payload) => {
        if (operation === "media_create_capture_producer") {
          const variantId = String(payload?.producerKey || "");
          session.handleCodecMigrationState({
            receiverId: "bob",
            logicalStreamId: "user:alice/camera",
            variantId,
            generation: 1,
            state: "stable",
          });
          return { id: `producer-${variantId}` };
        }
        return {};
      },
      mediaCapabilities: capabilities(["H264"]),
    });
    session.closed = false;
    session.localPeerId = "alice";
    session.sendTransport = {
      id: "send",
      handle: 1,
      direction: "send",
      closed: false,
    };
    session.device = {
      handle: "device",
      rtpCapabilities: {
        codecs: [{ mimeType: "video/H264", clockRate: 90000 }],
      },
    };
    session.sources.set("camera", {
      source: "camera",
      kind: "video",
      logicalStreamId: "user:alice/camera",
      track: { kind: "video" },
    });
    configureReceivers(session, ["bob"]);

    const result = await session.applyCodecRoutingPlan({
      ...plan(),
      desiredVariants: [
        {
          ...plan().desiredVariants[0],
          receivers: ["bob"],
          generation: 1,
        },
      ],
      variantCount: 1,
    });

    assert.equal(result, true);
    assert.equal(
      session.codecMigrationAcks.get("user:alice/camera")?.get("bob")?.state,
      "stable",
    );
  });

  it("retains stable routing when the hardware session limit would be exceeded", async () => {
    const calls: string[] = [];
    const session = new NativeMediasoupSfuSession({
      invoke: async (operation) => {
        calls.push(operation);
        return { id: "producer" };
      },
      mediaCapabilities: {
        ...capabilities(["H264", "AV1"]),
        concurrentEncode: {
          supported: true,
          maxHardwareSessions: 1,
          confidence: "conservative-default",
        },
      },
    });
    session.closed = false;
    session.sendTransport = {
      id: "send",
      handle: 1,
      direction: "send",
      closed: false,
    };
    session.sources.set("camera", {
      source: "camera",
      kind: "video",
      logicalStreamId: "user:alice/camera",
      track: { kind: "video" },
    });
    configureReceivers(session, ["bob", "carol"]);
    const rejected = await session.applyCodecRoutingPlan({
      ...plan(),
      desiredVariants: [
        {
          ...plan().desiredVariants[0],
          codec: "H264",
          receivers: ["bob"],
        },
        {
          ...plan().desiredVariants[0],
          codec: "AV1",
          variantId: "user:alice/camera:av1",
          receivers: ["carol"],
        },
      ],
    });
    assert.equal(rejected, false);
    assert.equal(session.producerVariants.size, 0);
    assert.deepEqual(calls, []);
  });

  it("reuses the stable base variant instead of duplicating its encoder", async () => {
    const calls: string[] = [];
    const session = new NativeMediasoupSfuSession({
      invoke: async (operation) => {
        calls.push(operation);
        return { id: "variant-producer" };
      },
      mediaCapabilities: {
        ...capabilities(["H264", "VP8"]),
        concurrentEncode: {
          supported: true,
          maxHardwareSessions: 1,
          confidence: "conservative-default",
        },
      },
    });
    session.closed = false;
    session.sendTransport = {
      id: "send",
      handle: 1,
      direction: "send",
      closed: false,
    };
    session.sources.set("camera", {
      source: "camera",
      kind: "video",
      logicalStreamId: "user:alice/camera",
      generation: 1,
      codec: "H264",
      variantId: "user:alice/camera:h264",
    });
    session.producers.set("camera", {
      id: "base-producer",
      source: "camera",
      kind: "video",
      /* SAFETY: The source was inserted immediately above and remains present until this producer fixture is constructed. */
      entry: session.sources.get("camera") as NonNullable<
        ReturnType<typeof session.sources.get>
      >,
      paused: false,
      producerKey: "camera",
    });
    configureReceivers(session, ["bob", "carol", "dave"]);

    assert.equal(await session.applyCodecRoutingPlan(plan()), true);
    assert.deepEqual(
      [...session.producerVariants.values()].map(
        (producer) => producer.entry.codec,
      ),
      ["VP8"],
    );
    assert.deepEqual(calls, ["media_create_capture_producer"]);
  });

  it("does not retire a variant that the active routing plan still needs", async () => {
    const session = new NativeMediasoupSfuSession({
      invoke: async (operation, payload) =>
        operation === "media_create_capture_producer"
          ? { id: `producer-${String(payload?.producerKey || "variant")}` }
          : {},
      mediaCapabilities: capabilities(["H264", "VP8"]),
    });
    session.closed = false;
    session.sendTransport = {
      id: "send",
      handle: 1,
      direction: "send",
      closed: false,
    };
    session.sources.set("camera", {
      source: "camera",
      kind: "video",
      logicalStreamId: "user:alice/camera",
      track: { kind: "video" },
    });
    configureReceivers(session, ["bob", "carol", "dave"]);

    const activePlan = plan();
    assert.equal(await session.applyCodecRoutingPlan(activePlan), true);
    assert.equal(await session.removeVariant("user:alice/camera:vp8"), false);
    assert.equal(session.producerVariants.size, 2);
  });

  it("keeps stable routing when a live receiver capability is missing", async () => {
    const session = new NativeMediasoupSfuSession({
      invoke: async () => ({ id: "unexpected-producer" }),
      mediaCapabilities: capabilities(["H264"]),
    });
    session.closed = false;
    session.localPeerId = "alice";
    session.sendTransport = {
      id: "send",
      handle: 1,
      direction: "send",
      closed: false,
    };
    session.sources.set("camera", {
      source: "camera",
      kind: "video",
      logicalStreamId: "user:alice/camera",
      track: { kind: "video" },
    });
    session.lastInRoom = [{ peerId: "bob" }];

    const result = await session.applyCodecRoutingPlan({
      ...plan(),
      desiredVariants: [
        {
          ...plan().desiredVariants[0],
          receivers: ["bob"],
        },
      ],
      variantCount: 1,
    });
    assert.equal(result, false);
    assert.equal(session.producerVariants.size, 0);
    assert.equal(session.codecRoutingPlans.size, 0);
  });

  it("uses the planned base codec when a source is published after routing", async () => {
    const session = new NativeMediasoupSfuSession({
      invoke: async (operation, payload) =>
        operation === "media_create_capture_producer"
          ? { id: `producer-${String(payload?.producerKey || "base")}` }
          : {},
      mediaCapabilities: capabilities(["H264", "VP8"]),
    });
    session.closed = false;
    session.sendTransport = {
      id: "send",
      handle: 1,
      direction: "send",
      closed: false,
    };
    session.device = {
      handle: "device",
      rtpCapabilities: {
        codecs: [
          { mimeType: "video/H264", clockRate: 90000 },
          { mimeType: "video/VP8", clockRate: 90000 },
        ],
      },
    };
    const routedPlan = {
      ...plan(),
      desiredVariants: [
        {
          ...plan().desiredVariants[1],
          receivers: ["dave"],
          variantId: "user:alice/camera:vp8",
        },
      ],
      variantCount: 1,
    };
    configureReceivers(session, ["dave"]);

    assert.equal(await session.applyCodecRoutingPlan(routedPlan), true);
    const producer = await session.addSource({
      source: "camera",
      kind: "video",
      logicalStreamId: "user:alice/camera",
    });

    assert.equal(producer.entry.codec, "VP8");
    assert.equal(producer.entry.variantId, "user:alice/camera:vp8");
    assert.equal(session.producerVariants.size, 0);
  });

  it("waits for a changed routing plan to remain stable before applying it", async () => {
    const session = new NativeMediasoupSfuSession({
      invoke: async (operation, payload) =>
        operation === "media_create_capture_producer"
          ? { id: `producer-${String(payload?.producerKey || "variant")}` }
          : {},
      mediaCapabilities: capabilities(["H264", "VP8"]),
    });
    session.closed = false;
    session.localPeerId = "alice";
    session.sendTransport = {
      id: "send",
      handle: 1,
      direction: "send",
      closed: false,
    };
    session.device = {
      handle: "device",
      rtpCapabilities: {
        codecs: [
          { mimeType: "video/H264", clockRate: 90000 },
          { mimeType: "video/VP8", clockRate: 90000 },
        ],
      },
    };
    session.sources.set("camera", {
      source: "camera",
      kind: "video",
      logicalStreamId: "user:alice/camera",
      track: { kind: "video" },
    });
    configureReceivers(session, ["bob", "carol"]);
    assert.equal(
      await session.applyCodecRoutingPlan({
        ...plan(),
        desiredVariants: [
          {
            ...plan().desiredVariants[0],
            receivers: ["bob", "carol"],
          },
        ],
        variantCount: 1,
      }),
      true,
    );

    const originalNow = Date.now;
    let now = 1000;
    Date.now = () => now;
    try {
      session.remoteParticipantCapabilities.set("carol", capabilities(["VP8"]));
      assert.equal(await session.evaluateCodecRoutingPlans(), false);
      assert.equal(
        session.codecRoutingCandidatePlans.has("user:alice/camera"),
        true,
      );
      now += 751;
      assert.equal(await session.evaluateCodecRoutingPlans(), true);
      assert.equal(
        session.codecRoutingCandidatePlans.has("user:alice/camera"),
        false,
      );
    } finally {
      Date.now = originalNow;
    }
    await session.disconnect();
  });

  it("retries a stable routing change after the capability window", async () => {
    const session = new NativeMediasoupSfuSession({
      invoke: async (operation, payload) =>
        operation === "media_create_capture_producer"
          ? { id: `producer-${String(payload?.producerKey || "variant")}` }
          : {},
      mediaCapabilities: capabilities(["H264", "VP8"]),
    });
    session.closed = false;
    session.localPeerId = "alice";
    session.selectedProvider = "mediasoup";
    session.sendTransport = {
      id: "send",
      handle: 1,
      direction: "send",
      closed: false,
    };
    session.device = {
      handle: "device",
      rtpCapabilities: {
        codecs: [
          { mimeType: "video/H264", clockRate: 90000 },
          { mimeType: "video/VP8", clockRate: 90000 },
        ],
      },
    };
    session.sources.set("camera", {
      source: "camera",
      kind: "video",
      logicalStreamId: "user:alice/camera",
      track: { kind: "video" },
    });
    configureReceivers(session, ["bob"]);
    assert.equal(await session.evaluateCodecRoutingPlans(), true);
    session.remoteParticipantCapabilities.set("bob", capabilities(["VP8"]));
    session.lastInRoom = [
      { peerId: "bob", mediaCapabilities: capabilities(["VP8"]) },
    ];
    assert.equal(await session.evaluateCodecRoutingPlans(), false);
    assert.equal(session.codecRoutingEvaluationTimer !== null, true);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert.equal(
      session.codecRoutingPlans.get("user:alice/camera")?.desiredVariants[0]
        ?.codec,
      "VP8",
    );
    await session.disconnect();
  });

  it("schedules variant retirement when the last receiver leaves", async () => {
    const session = new NativeMediasoupSfuSession({
      invoke: async (operation, payload) =>
        operation === "media_create_capture_producer"
          ? { id: `producer-${String(payload?.producerKey || "variant")}` }
          : {},
      mediaCapabilities: capabilities(["H264", "VP8"]),
    });
    session.closed = false;
    session.localPeerId = "alice";
    session.selectedProvider = "mediasoup";
    session.sendTransport = {
      id: "send",
      handle: 1,
      direction: "send",
      closed: false,
    };
    session.device = {
      handle: "device",
      rtpCapabilities: {
        codecs: [
          { mimeType: "video/H264", clockRate: 90000 },
          { mimeType: "video/VP8", clockRate: 90000 },
        ],
      },
    };
    session.sources.set("camera", {
      source: "camera",
      kind: "video",
      logicalStreamId: "user:alice/camera",
      track: { kind: "video" },
    });
    configureReceivers(session, ["bob", "carol", "dave"]);
    assert.equal(await session.evaluateCodecRoutingPlans(), true);
    session.lastInRoom = [];
    assert.equal(session.scheduleCodecRoutingEvaluation(), true);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(session.producerVariants.size, 0);
    assert.equal(session.codecRoutingPlans.size, 0);
    await session.disconnect();
  });

  it("publishes a software candidate while retaining the stable base producer", async () => {
    const calls = [];
    const session = new NativeMediasoupSfuSession({
      invoke: async (operation, payload) => {
        calls.push([operation, payload]);
        return { id: "new-producer" };
      },
      mediaCapabilities: capabilities(["H264", "VP8"]),
    });
    session.closed = false;
    session.sendTransport = {
      id: "send",
      handle: 1,
      direction: "send",
      closed: false,
    };
    const source = {
      source: "camera",
      kind: "video" as const,
      logicalStreamId: "user:alice/camera",
      codec: "H264",
      variantId: "user:alice/camera:h264",
      receivers: ["dave"],
    };
    session.sources.set("camera", source);
    session.producers.set("camera", {
      id: "stable-h264",
      source: "camera",
      kind: "video",
      entry: source,
      paused: false,
      producerKey: "camera",
    });
    configureReceivers(session, ["dave"]);

    const unsafePlan = {
      ...plan(),
      desiredVariants: [
        {
          ...plan().desiredVariants[1],
          receivers: ["dave"],
          variantId: "user:alice/camera:vp8",
        },
      ],
      variantCount: 1,
    };
    assert.equal(await session.applyCodecRoutingPlan(unsafePlan), true);
    assert.equal(session.producers.get("camera").id, "stable-h264");
    assert.equal(session.producerVariants.size, 1);
    assert.equal(
      calls.filter(
        ([operation]) => operation === "media_create_capture_producer",
      ).length,
      1,
    );
  });

  it("retires the old base only after every assigned receiver commits", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const providerMessages: Record<string, unknown>[] = [];
    const session = new NativeMediasoupSfuSession({
      invoke: async (operation, payload) => {
        calls.push([operation, payload || {}]);
        return operation === "media_create_capture_producer"
          ? { id: `producer-${String(payload?.producerKey || "base")}` }
          : {};
      },
      mediaCapabilities: capabilities(["H264", "VP8"]),
    });
    session.closed = false;
    session.localPeerId = "alice";
    session.sendTransport = {
      id: "send",
      handle: 1,
      direction: "send",
      closed: false,
    };
    session.device = {
      handle: "device",
      rtpCapabilities: {
        codecs: [
          { mimeType: "video/H264", clockRate: 90000 },
          { mimeType: "video/VP8", clockRate: 90000 },
        ],
      },
    };
    session.providerSignaling = {
      send: (message) => {
        const record = parseExternalRecord(message);
        if (record) providerMessages.push(record);
        return true;
      },
      close: () => {},
      connect: async () => {},
    };
    const source = {
      source: "camera",
      kind: "video" as const,
      logicalStreamId: "user:alice/camera",
      codec: "H264",
      variantId: "user:alice/camera:h264",
      receivers: ["dave"],
    };
    session.sources.set("camera", source);
    session.producers.set("camera", {
      id: "stable-h264",
      source: "camera",
      kind: "video",
      entry: source,
      paused: false,
      producerKey: "camera",
    });
    configureReceivers(session, ["dave"]);
    const routedPlan = {
      ...plan(),
      desiredVariants: [
        {
          ...plan().desiredVariants[1],
          receivers: ["dave"],
          variantId: "user:alice/camera:vp8",
        },
      ],
      variantCount: 1,
    };
    assert.equal(await session.applyCodecRoutingPlan(routedPlan), true);
    assert.equal(session.producers.get("camera")?.id, "stable-h264");
    const updateMessage = providerMessages.find(
      (message) => message.type === "update-producer-metadata",
    );
    const updateData = parseExternalRecord(updateMessage?.data);
    assert.deepEqual(updateData?.receivers, ["dave"]);

    assert.equal(
      session.handleCodecMigrationState({
        receiverId: "dave",
        logicalStreamId: "user:alice/camera",
        variantId: "user:alice/camera:vp8",
        generation: 2,
        state: "stable",
      }),
      true,
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(session.producers.get("camera")?.entry.codec, "VP8");
    assert.equal(session.producerVariants.size, 0);
    assert.ok(
      calls.some(
        ([operation, payload]) =>
          operation === "media_remove_capture_producer" &&
          payload.source === "camera",
      ),
    );
    const closeMessage = providerMessages.find(
      (message) => message.type === "close-producer",
    );
    assert.equal(
      parseExternalString(parseExternalRecord(closeMessage?.data)?.producerId),
      "stable-h264",
    );
  });

  it("updates an existing variant cohort without creating another encoder", async () => {
    const providerMessages: Record<string, unknown>[] = [];
    const session = new NativeMediasoupSfuSession({
      invoke: async (operation, payload) =>
        operation === "media_create_capture_producer"
          ? { id: `producer-${String(payload?.producerKey || "variant")}` }
          : {},
      mediaCapabilities: capabilities(["H264", "VP8"]),
    });
    session.closed = false;
    session.sendTransport = {
      id: "send",
      handle: 1,
      direction: "send",
      closed: false,
    };
    session.providerSignaling = {
      send: (message) => {
        const record = parseExternalRecord(message);
        if (record) providerMessages.push(record);
        return true;
      },
      close: () => {},
      connect: async () => {},
    };
    session.sources.set("camera", {
      source: "camera",
      kind: "video",
      logicalStreamId: "user:alice/camera",
      track: { kind: "video" },
    });
    configureReceivers(session, ["bob", "carol", "dave"]);

    const initial = plan();
    assert.equal(await session.applyCodecRoutingPlan(initial), true);
    const updated = {
      ...initial,
      desiredVariants: initial.desiredVariants.map((variant) =>
        variant.codec === "H264"
          ? { ...variant, receivers: ["bob"] }
          : { ...variant, receivers: ["carol", "dave"] },
      ),
    };
    assert.equal(await session.applyCodecRoutingPlan(updated), true);
    assert.equal(session.producerVariants.size, 2);
    assert.deepEqual(
      session.producerVariants.get("user:alice/camera:h264")?.entry.receivers,
      ["bob"],
    );
    assert.deepEqual(
      session.producerVariants.get("user:alice/camera:vp8")?.entry.receivers,
      ["carol", "dave"],
    );
    assert.ok(
      providerMessages.some(
        (message) => message.type === "update-producer-metadata",
      ),
    );
  });

  it("evaluates the room capability registry into a per-receiver SFU plan", async () => {
    const session = new NativeMediasoupSfuSession({
      invoke: async (operation, payload) =>
        operation === "media_create_capture_producer"
          ? { id: `producer-${String(payload?.producerKey || "variant")}` }
          : {},
      mediaCapabilities: capabilities(["H264", "VP8"]),
    });
    session.closed = false;
    session.localPeerId = "alice";
    session.sendTransport = {
      id: "send",
      handle: 1,
      direction: "send",
      closed: false,
    };
    session.device = {
      handle: "device",
      rtpCapabilities: {
        codecs: [
          { mimeType: "video/H264", clockRate: 90000 },
          { mimeType: "video/VP8", clockRate: 90000 },
        ],
      },
    };
    session.sources.set("camera", {
      source: "camera",
      kind: "video",
      logicalStreamId: "user:alice/camera",
      track: { kind: "video" },
    });
    session.lastInRoom = [
      {
        peerId: "bob",
        mediaCapabilities: capabilities(["VP8"], ["VP8"]),
      },
      {
        peerId: "dave",
        mediaCapabilities: capabilities(["H264"], ["H264"]),
      },
    ];
    session.remoteParticipantCapabilities.set(
      "bob",
      capabilities(["H264"], ["H264"]),
    );
    session.remoteParticipantCapabilities.set(
      "dave",
      capabilities(["VP8"], ["VP8"]),
    );

    assert.equal(await session.evaluateCodecRoutingPlans(), true);
    const routed = session.codecRoutingPlans.get("user:alice/camera");
    assert.deepEqual(
      routed?.desiredVariants.map((variant) => [
        variant.codec,
        variant.receivers,
      ]),
      [
        ["H264", ["bob"]],
        ["VP8", ["dave"]],
      ],
    );
    assert.equal(session.producerVariants.size, 2);
  });

  it("retires obsolete variants after the last receiver leaves", async () => {
    const session = new NativeMediasoupSfuSession({
      invoke: async (operation, payload) =>
        operation === "media_create_capture_producer"
          ? { id: `producer-${String(payload?.producerKey || "variant")}` }
          : {},
      mediaCapabilities: capabilities(["H264", "VP8"]),
    });
    session.closed = false;
    session.localPeerId = "alice";
    session.sendTransport = {
      id: "send",
      handle: 1,
      direction: "send",
      closed: false,
    };
    session.device = {
      handle: "device",
      rtpCapabilities: {
        codecs: [
          { mimeType: "video/H264", clockRate: 90000 },
          { mimeType: "video/VP8", clockRate: 90000 },
        ],
      },
    };
    session.sources.set("camera", {
      source: "camera",
      kind: "video",
      logicalStreamId: "user:alice/camera",
      track: { kind: "video" },
    });
    configureReceivers(session, ["bob", "carol", "dave"]);
    assert.equal(await session.applyCodecRoutingPlan(plan()), true);
    assert.equal(session.producerVariants.size, 2);

    session.lastInRoom = [];
    assert.equal(await session.evaluateCodecRoutingPlans(), true);
    assert.equal(session.producerVariants.size, 0);
    assert.equal(session.codecRoutingPlans.size, 0);
  });
});
