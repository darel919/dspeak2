import {
  VIDEO_CODEC_NAMES,
  efficientDecodeCodecs,
  efficientEncodeCodecs,
  emergencyDecodeCodecs,
  emergencyEncodeCodecs,
  efficiencyRank,
  isEmergencyUsable,
  isRealtimeEfficient,
  maxConcurrentHardwareEncodeSessions,
  normalizeVideoCodecName,
  normalizeParticipantMediaCapabilities,
} from "./types/video-codec-capabilities.ts";
import type {
  CodecDirectionCapability,
  ParticipantMediaCapabilities,
  VideoCodecName,
} from "./types/video-codec-capabilities.ts";

export interface CodecRoutingParticipant {
  participantId: string;
  mediaCapabilities: ParticipantMediaCapabilities;
}

export interface CodecRoutingPublisher extends CodecRoutingParticipant {
  logicalStreamId: string;
  source?: string;
}

export interface CodecVariantPlan {
  codec: VideoCodecName;
  receivers: string[];
  score: number;
  hardwareEncode: boolean;
  estimatedBitrateBps?: number;
  target?: CodecRoutingTarget;
  targetAdjusted?: boolean;
  emergency?: boolean;
  generation?: number;
  variantId?: string;
}

export interface CodecRoutingPlan {
  publisher: string;
  logicalStreamId: string;
  source?: string;
  desiredVariants: CodecVariantPlan[];
  uncoveredReceivers: string[];
  emergencyReceivers: string[];
  variantCount: number;
  createdAt: number;
  estimatedUploadBitrateBps?: number;
  target?: CodecRoutingTarget;
}

export interface CodecRoutingOptions {
  sfuSupportedCodecs?: Iterable<string>;
  allowEmergencySoftware?: boolean;
  allowTargetAdaptation?: boolean;
  maxVariants?: number;
  maxUploadBitrateBps?: number;
  target?: CodecRoutingTarget;
}

export interface CodecRoutingTarget {
  width?: number;
  height?: number;
  fps?: number;
  bitrate?: number;
}

const CODEC_BASE_COST: Record<VideoCodecName, number> = {
  H264: 1.1,
  H265: 1.35,
  VP8: 1.6,
  VP9: 1.85,
  AV1: 2.2,
};

const CODEC_QUALITY_BENEFIT: Record<VideoCodecName, number> = {
  H264: 0.45,
  H265: 0.7,
  VP8: 0.15,
  VP9: 0.55,
  AV1: 0.85,
};

function directionCost(
  codec: VideoCodecName,
  capability: CodecDirectionCapability,
  direction: "encode" | "decode",
) {
  const accelerationPenalty =
    capability.acceleration === "hardware"
      ? 0
      : direction === "encode"
        ? 1.4
        : 1.2;
  const efficiencyPenalty =
    Math.max(0, 4 - efficiencyRank(capability.realtimeEfficiency)) * 1.4;
  const powerPenalty =
    capability.powerClass === "high"
      ? 0.5
      : capability.powerClass === "medium"
        ? 0.2
        : 0;
  return (
    CODEC_BASE_COST[codec] +
    accelerationPenalty +
    efficiencyPenalty +
    powerPenalty
  );
}

export function codecVariantCost(
  codec: VideoCodecName,
  publisher: CodecRoutingPublisher,
  receivers: CodecRoutingParticipant[],
) {
  const encode = publisher.mediaCapabilities.videoCodecs[codec].encode;
  const encodeCost = directionCost(codec, encode, "encode");
  const receiverCost = receivers.reduce((total, receiver) => {
    const decode = receiver.mediaCapabilities.videoCodecs[codec].decode;
    return total + directionCost(codec, decode, "decode") * 0.35;
  }, 0);
  const qualityBenefit = CODEC_QUALITY_BENEFIT[codec] * 0.7;
  return encodeCost + receiverCost - qualityBenefit;
}

function comparePlans(left: CodecVariantPlan[], right: CodecVariantPlan[]) {
  if (left.length !== right.length) return left.length - right.length;
  const leftScore = left.reduce((sum, variant) => sum + variant.score, 0);
  const rightScore = right.reduce((sum, variant) => sum + variant.score, 0);
  if (leftScore !== rightScore) return leftScore - rightScore;
  return left
    .map((variant) => variant.codec)
    .join(",")
    .localeCompare(right.map((variant) => variant.codec).join(","));
}

function hardwarePairKey(left: VideoCodecName, right: VideoCodecName) {
  return [left, right].sort().join(":");
}

export function supportsConcurrentHardwareVariants(
  capabilities: ParticipantMediaCapabilities,
  codecs: VideoCodecName[],
) {
  const hardwareCodecs = [
    ...new Set(
      codecs.filter(
        (codec) =>
          capabilities.videoCodecs[codec]?.encode.acceleration === "hardware",
      ),
    ),
  ];
  if (hardwareCodecs.length < 2) return true;
  const testedPairs = capabilities.concurrentEncode.testedCodecPairs || [];
  if (
    !testedPairs.length &&
    capabilities.concurrentEncode.confidence !== "tested"
  )
    return false;
  if (!testedPairs.length) return true;
  const tested = new Set(
    testedPairs.map(([left, right]) => hardwarePairKey(left, right)),
  );
  for (let index = 0; index < hardwareCodecs.length; index += 1)
    for (let next = index + 1; next < hardwareCodecs.length; next += 1) {
      const left = hardwareCodecs[index];
      const right = hardwareCodecs[next];
      if (left && right && !tested.has(hardwarePairKey(left, right)))
        return false;
    }
  return true;
}

function subsets<T>(values: T[], maxSize: number) {
  const result: T[][] = [];
  const walk = (index: number, current: T[]) => {
    if (current.length > 0) result.push([...current]);
    if (current.length >= maxSize) return;
    for (let offset = index; offset < values.length; offset += 1) {
      const value = values[offset];
      if (value === undefined) continue;
      current.push(value);
      walk(offset + 1, current);
      current.pop();
    }
  };
  walk(0, []);
  return result;
}

function supportedSet(values: Iterable<string>) {
  const requested = new Set(
    [...values].map((value) => String(value).toUpperCase()),
  );
  return VIDEO_CODEC_NAMES.filter((codec) => requested.has(codec));
}

function supportsTarget(
  capability: CodecDirectionCapability,
  target: CodecRoutingTarget | undefined,
) {
  if (!target) return true;
  const width = Number(target.width);
  const height = Number(target.height);
  const fps = Number(target.fps);
  if (
    Number.isFinite(width) &&
    capability.maxWidth !== undefined &&
    width > capability.maxWidth
  )
    return false;
  if (
    Number.isFinite(height) &&
    capability.maxHeight !== undefined &&
    height > capability.maxHeight
  )
    return false;
  if (
    Number.isFinite(fps) &&
    capability.maxFps !== undefined &&
    fps > capability.maxFps
  )
    return false;
  return true;
}

function constrainedTarget(
  target: CodecRoutingTarget | undefined,
  capabilities: CodecDirectionCapability[],
) {
  if (!target) return undefined;
  const result: CodecRoutingTarget = { ...target };
  const capabilityKey: Record<
    "width" | "height" | "fps",
    keyof CodecDirectionCapability
  > = {
    width: "maxWidth",
    height: "maxHeight",
    fps: "maxFps",
  };
  for (const key of ["width", "height", "fps"] as const) {
    const requested = Number(target[key]);
    if (!Number.isFinite(requested) || requested <= 0) continue;
    const limits = capabilities
      .map((capability) => Number(capability[capabilityKey[key]]))
      .filter((limit) => Number.isFinite(limit) && limit > 0);
    if (limits.length) result[key] = Math.min(requested, ...limits);
  }
  return Object.keys(result).length ? result : undefined;
}

function targetWasConstrained(
  target: CodecRoutingTarget | undefined,
  constrained: CodecRoutingTarget | undefined,
) {
  if (!target || !constrained) return false;
  return (["width", "height", "fps"] as const).some((key) => {
    const requested = Number(target[key]);
    const selected = Number(constrained[key]);
    return (
      Number.isFinite(requested) &&
      Number.isFinite(selected) &&
      selected > 0 &&
      selected < requested
    );
  });
}

export function supportsCodecDirectionTarget(
  capability: CodecDirectionCapability,
  target: CodecRoutingTarget | undefined,
) {
  return supportsTarget(capability, target);
}

export function codecTargetForPath(
  publisher: CodecRoutingPublisher,
  receiver: CodecRoutingParticipant,
  codec: VideoCodecName,
  target: CodecRoutingTarget | undefined,
) {
  return constrainedTarget(target, [
    publisher.mediaCapabilities.videoCodecs[codec].encode,
    receiver.mediaCapabilities.videoCodecs[codec].decode,
  ]);
}

function codecTargetForCohort(
  publisher: CodecRoutingPublisher,
  receivers: CodecRoutingParticipant[],
  codec: VideoCodecName,
  target: CodecRoutingTarget | undefined,
) {
  return constrainedTarget(target, [
    publisher.mediaCapabilities.videoCodecs[codec].encode,
    ...receivers.map(
      (receiver) => receiver.mediaCapabilities.videoCodecs[codec].decode,
    ),
  ]);
}

function supportsCodecTarget(
  publisher: CodecRoutingPublisher,
  receiver: CodecRoutingParticipant,
  codec: VideoCodecName,
  target: CodecRoutingTarget | undefined,
  allowTargetAdaptation = false,
) {
  const capabilities = [
    publisher.mediaCapabilities.videoCodecs[codec].encode,
    receiver.mediaCapabilities.videoCodecs[codec].decode,
  ];
  if (capabilities.every((capability) => supportsTarget(capability, target)))
    return true;
  return Boolean(
    allowTargetAdaptation &&
    constrainedTarget(target, capabilities) &&
    targetWasConstrained(target, constrainedTarget(target, capabilities)),
  );
}

const CODEC_BITRATE_FACTOR: Record<VideoCodecName, number> = {
  H264: 1,
  H265: 0.85,
  VP8: 1.15,
  VP9: 0.9,
  AV1: 0.75,
};

function estimatedVariantBitrate(
  codec: VideoCodecName,
  target: CodecRoutingTarget | undefined,
) {
  const bitrate = Number(target?.bitrate);
  if (!Number.isFinite(bitrate) || bitrate <= 0) return null;
  return Math.max(1, Math.floor(bitrate * CODEC_BITRATE_FACTOR[codec]));
}

export function compatibleCodecs(
  publisher: CodecRoutingPublisher,
  receiver: CodecRoutingParticipant,
  options: CodecRoutingOptions = {},
) {
  const sfu = supportedSet(options.sfuSupportedCodecs || VIDEO_CODEC_NAMES);
  const encode = new Set(efficientEncodeCodecs(publisher.mediaCapabilities));
  const decode = new Set(efficientDecodeCodecs(receiver.mediaCapabilities));
  const efficient = sfu.filter(
    (codec) =>
      encode.has(codec) &&
      decode.has(codec) &&
      supportsCodecTarget(
        publisher,
        receiver,
        codec,
        options.target,
        options.allowTargetAdaptation === true,
      ),
  );
  if (efficient.length || options.allowEmergencySoftware !== true)
    return efficient;
  const emergencyEncode = new Set(
    emergencyEncodeCodecs(publisher.mediaCapabilities),
  );
  const emergencyDecode = new Set(
    emergencyDecodeCodecs(receiver.mediaCapabilities),
  );
  return sfu.filter(
    (codec) =>
      emergencyEncode.has(codec) &&
      emergencyDecode.has(codec) &&
      supportsCodecTarget(
        publisher,
        receiver,
        codec,
        options.target,
        options.allowTargetAdaptation === true,
      ),
  );
}

export function selectBestPairCodec(
  publisher: CodecRoutingPublisher,
  receiver: CodecRoutingParticipant,
  options: CodecRoutingOptions = {},
) {
  const candidates = compatibleCodecs(publisher, receiver, options);
  if (!candidates.length) return null;
  return [...candidates].sort((left, right) => {
    const leftScore = codecVariantCost(left, publisher, [receiver]);
    const rightScore = codecVariantCost(right, publisher, [receiver]);
    return leftScore - rightScore || left.localeCompare(right);
  })[0];
}

export function createCodecRoutingPlan(
  publisherInput: CodecRoutingPublisher,
  receiverInputs: CodecRoutingParticipant[],
  options: CodecRoutingOptions = {},
): CodecRoutingPlan {
  const publisher = {
    ...publisherInput,
    mediaCapabilities: normalizeParticipantMediaCapabilities(
      publisherInput.mediaCapabilities,
    ),
  };
  const receivers = receiverInputs.map((receiver) => ({
    ...receiver,
    mediaCapabilities: normalizeParticipantMediaCapabilities(
      receiver.mediaCapabilities,
    ),
  }));
  if (!receivers.length) {
    return {
      publisher: publisher.participantId,
      logicalStreamId: publisher.logicalStreamId,
      source: publisher.source,
      desiredVariants: [],
      uncoveredReceivers: [],
      emergencyReceivers: [],
      variantCount: 0,
      createdAt: Date.now(),
      ...(options.target ? { target: { ...options.target } } : {}),
    };
  }
  const sfu = supportedSet(options.sfuSupportedCodecs || VIDEO_CODEC_NAMES);
  const efficientPublisher = new Set(
    efficientEncodeCodecs(publisher.mediaCapabilities),
  );
  let candidateCodecs = sfu.filter((codec) => efficientPublisher.has(codec));
  const emergencyReceivers = new Set<string>();
  const compatible = new Map<string, VideoCodecName[]>();
  for (const receiver of receivers) {
    let codecs = compatibleCodecs(publisher, receiver, {
      ...options,
      allowEmergencySoftware: false,
    });
    if (!codecs.length && options.allowEmergencySoftware === true) {
      codecs = compatibleCodecs(publisher, receiver, {
        ...options,
        allowEmergencySoftware: true,
      });
      if (codecs.length) emergencyReceivers.add(receiver.participantId);
    }
    compatible.set(receiver.participantId, codecs);
    for (const codec of codecs)
      if (!candidateCodecs.includes(codec)) candidateCodecs.push(codec);
  }
  const maxVariants = Math.max(
    1,
    Math.min(
      options.maxVariants || candidateCodecs.length || 1,
      candidateCodecs.length || 1,
    ),
  );
  let best: CodecVariantPlan[] = [];
  for (const candidateSet of subsets(candidateCodecs, maxVariants)) {
    const assignments = new Map<VideoCodecName, string[]>();
    for (const codec of candidateSet) assignments.set(codec, []);
    for (const receiver of receivers) {
      const receiverCodecs = candidateSet.filter((codec) =>
        compatible.get(receiver.participantId)?.includes(codec),
      );
      const selectedCodec = [...receiverCodecs].sort((left, right) => {
        const leftScore = codecVariantCost(left, publisher, [receiver]);
        const rightScore = codecVariantCost(right, publisher, [receiver]);
        return leftScore - rightScore || left.localeCompare(right);
      })[0];
      if (selectedCodec)
        assignments.get(selectedCodec)?.push(receiver.participantId);
    }
    const variants = candidateSet
      .map((codec) => {
        const assignedReceivers = new Set(assignments.get(codec) || []);
        const covered = receivers.filter((receiver) =>
          assignedReceivers.has(receiver.participantId),
        );
        const target = codecTargetForCohort(
          publisher,
          covered,
          codec,
          options.target,
        );
        const estimatedBitrateBps = estimatedVariantBitrate(codec, target);
        const score =
          codecVariantCost(codec, publisher, covered) +
          (estimatedBitrateBps || 0) / 1_000_000;
        return {
          codec,
          receivers: covered.map((receiver) => receiver.participantId),
          score,
          ...(estimatedBitrateBps ? { estimatedBitrateBps } : {}),
          ...(target ? { target } : {}),
          ...(targetWasConstrained(options.target, target)
            ? { targetAdjusted: true }
            : {}),
          hardwareEncode:
            publisher.mediaCapabilities.videoCodecs[codec].encode
              .acceleration === "hardware",
          emergency: covered.some((receiver) =>
            emergencyReceivers.has(receiver.participantId),
          ),
        };
      })
      .filter((variant) => variant.receivers.length > 0);
    const estimatedUploadBitrateBps = variants.reduce(
      (total, variant) => total + (variant.estimatedBitrateBps || 0),
      0,
    );
    if (
      Number.isFinite(Number(options.maxUploadBitrateBps)) &&
      options.maxUploadBitrateBps !== undefined &&
      variants.some((variant) => variant.estimatedBitrateBps === undefined)
    )
      continue;
    if (
      Number.isFinite(Number(options.maxUploadBitrateBps)) &&
      estimatedUploadBitrateBps > Number(options.maxUploadBitrateBps)
    )
      continue;
    const maxHardwareSessions = maxConcurrentHardwareEncodeSessions(
      publisher.mediaCapabilities,
    );
    if (
      maxHardwareSessions &&
      variants.filter((variant) => variant.hardwareEncode).length >
        maxHardwareSessions
    )
      continue;
    if (
      !supportsConcurrentHardwareVariants(
        publisher.mediaCapabilities,
        variants.map((variant) => variant.codec),
      )
    )
      continue;
    const covered = new Set(variants.flatMap((variant) => variant.receivers));
    if (covered.size !== receivers.length) continue;
    if (!best.length || comparePlans(variants, best) < 0) best = variants;
  }
  const uncoveredReceivers = receivers
    .filter(
      (receiver) =>
        !best.some((variant) =>
          variant.receivers.includes(receiver.participantId),
        ),
    )
    .map((receiver) => receiver.participantId);
  return {
    publisher: publisher.participantId,
    logicalStreamId: publisher.logicalStreamId,
    source: publisher.source,
    desiredVariants: best.map((variant) => ({
      ...variant,
      variantId: `${publisher.logicalStreamId}:${variant.codec.toLowerCase()}`,
      generation: 1,
      receivers: [...variant.receivers].sort(),
      score: Number(variant.score.toFixed(4)),
    })),
    uncoveredReceivers,
    emergencyReceivers: [...emergencyReceivers].filter(
      (id) => !uncoveredReceivers.includes(id),
    ),
    variantCount: best.length,
    createdAt: Date.now(),
    ...(best.some((variant) => variant.estimatedBitrateBps !== undefined)
      ? {
          estimatedUploadBitrateBps: best.reduce(
            (total, variant) => total + (variant.estimatedBitrateBps || 0),
            0,
          ),
        }
      : {}),
    ...(options.target ? { target: { ...options.target } } : {}),
  };
}

export function validateCodecRoutingPlan(
  plan: CodecRoutingPlan,
  publisherInput: CodecRoutingPublisher,
  receiverInputs: CodecRoutingParticipant[],
  options: CodecRoutingOptions = {},
) {
  if (!plan || typeof plan !== "object")
    return { valid: false, errors: ["invalid-plan"] };
  const publisher = {
    ...publisherInput,
    mediaCapabilities: normalizeParticipantMediaCapabilities(
      publisherInput.mediaCapabilities,
    ),
  };
  const receivers = new Map(
    (Array.isArray(receiverInputs) ? receiverInputs : []).map((receiver) => [
      receiver.participantId,
      {
        ...receiver,
        mediaCapabilities: normalizeParticipantMediaCapabilities(
          receiver.mediaCapabilities,
        ),
      },
    ]),
  );
  const sfu = new Set(
    supportedSet(options.sfuSupportedCodecs || VIDEO_CODEC_NAMES),
  );
  const errors: string[] = [];
  if (!plan.logicalStreamId) errors.push("missing-logical-stream");
  if (
    plan.publisher &&
    String(plan.publisher) !== String(publisher.participantId)
  )
    errors.push("publisher-mismatch");
  if (
    plan.logicalStreamId &&
    String(plan.logicalStreamId) !== String(publisher.logicalStreamId)
  )
    errors.push("logical-stream-mismatch");
  if (!Array.isArray(plan.desiredVariants)) errors.push("missing-variants");
  if (!Array.isArray(plan.uncoveredReceivers))
    errors.push("missing-uncovered-receivers");
  const seenVariants = new Set<string>();
  const seenCodecs = new Set<VideoCodecName>();
  const coveredReceivers = new Set<string>();
  let estimatedUploadBitrateBps = 0;
  let missingBitrateEstimate = false;
  let hardwareVariants = 0;
  const hardwareCodecs: VideoCodecName[] = [];
  for (const variant of Array.isArray(plan.desiredVariants)
    ? plan.desiredVariants
    : []) {
    const codec = normalizeVideoCodecName(variant?.codec);
    if (!codec) {
      errors.push(`invalid-codec-${String(variant?.codec || "")}`);
      continue;
    }
    const variantId = String(
      variant?.variantId || `${plan.logicalStreamId}:${codec.toLowerCase()}`,
    );
    if (seenVariants.has(variantId))
      errors.push(`duplicate-variant-${variantId}`);
    seenVariants.add(variantId);
    if (seenCodecs.has(codec)) errors.push(`duplicate-codec-${codec}`);
    seenCodecs.add(codec);
    if (
      publisher.mediaCapabilities.videoCodecs[codec].encode.acceleration ===
      "hardware"
    ) {
      hardwareVariants += 1;
      hardwareCodecs.push(codec);
    }
    const estimatedBitrateBps = estimatedVariantBitrate(
      codec,
      variant.target || options.target || plan.target,
    );
    if (estimatedBitrateBps === null) missingBitrateEstimate = true;
    else estimatedUploadBitrateBps += estimatedBitrateBps;
  }
  const maxHardwareSessions = maxConcurrentHardwareEncodeSessions(
    publisher.mediaCapabilities,
  );
  if (maxHardwareSessions && hardwareVariants > maxHardwareSessions)
    errors.push("concurrent-hardware-encoder-limit");
  if (
    !supportsConcurrentHardwareVariants(
      publisher.mediaCapabilities,
      hardwareCodecs,
    )
  )
    errors.push("concurrent-hardware-codec-pair-not-tested");
  for (const variant of Array.isArray(plan.desiredVariants)
    ? plan.desiredVariants
    : []) {
    const codec = normalizeVideoCodecName(variant?.codec);
    if (!codec) continue;
    if (!variant || !Array.isArray(variant.receivers)) {
      errors.push(`missing-receivers-${codec}`);
      continue;
    }
    if (!sfu.has(codec)) errors.push(`sfu-codec-${codec}`);
    const emergency = variant.emergency === true;
    if (
      !isRealtimeEfficient(
        publisher.mediaCapabilities.videoCodecs[codec].encode,
      ) &&
      !(
        emergency &&
        isEmergencyUsable(publisher.mediaCapabilities.videoCodecs[codec].encode)
      )
    )
      errors.push(`publisher-encode-${codec}`);
    const variantReceivers = new Set<string>();
    for (const receiverId of variant.receivers) {
      if (variantReceivers.has(receiverId)) {
        errors.push(`duplicate-receiver-${receiverId}`);
        continue;
      }
      variantReceivers.add(receiverId);
      const receiver = receivers.get(receiverId);
      if (!receiver) {
        errors.push(`unknown-receiver-${receiverId}`);
        continue;
      }
      if (coveredReceivers.has(receiverId)) {
        errors.push(`duplicate-receiver-${receiverId}`);
        continue;
      }
      coveredReceivers.add(receiverId);
      if (
        !supportsCodecTarget(
          publisher,
          receiver,
          codec,
          variant.target || options.target || plan.target,
          options.allowTargetAdaptation === true,
        )
      )
        errors.push(`codec-target-${receiverId}-${codec}`);
      if (
        !isRealtimeEfficient(
          receiver.mediaCapabilities.videoCodecs[codec].decode,
        ) &&
        !(
          emergency &&
          isEmergencyUsable(
            receiver.mediaCapabilities.videoCodecs[codec].decode,
          )
        )
      )
        errors.push(`receiver-decode-${receiverId}-${codec}`);
    }
  }
  for (const receiverId of receivers.keys())
    if (!coveredReceivers.has(receiverId))
      errors.push(`uncovered-receiver-${receiverId}`);
  if (Array.isArray(plan.uncoveredReceivers) && plan.uncoveredReceivers.length)
    errors.push("uncovered-receiver");
  if (
    Number.isFinite(Number(plan.variantCount)) &&
    Array.isArray(plan.desiredVariants) &&
    Number(plan.variantCount) !== plan.desiredVariants.length
  )
    errors.push("variant-count-mismatch");
  if (
    Number.isFinite(Number(options.maxUploadBitrateBps)) &&
    (missingBitrateEstimate ||
      estimatedUploadBitrateBps > Number(options.maxUploadBitrateBps))
  )
    errors.push(
      missingBitrateEstimate
        ? "missing-upload-bandwidth-estimate"
        : "upload-bandwidth-limit",
    );
  if (
    Number.isFinite(Number(plan.estimatedUploadBitrateBps)) &&
    Number(plan.estimatedUploadBitrateBps) !== estimatedUploadBitrateBps
  )
    errors.push("upload-bandwidth-estimate-mismatch");
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

export function codecVariantMetadata(
  plan: CodecRoutingPlan,
  codec: VideoCodecName,
  generation: number,
) {
  const variant = plan.desiredVariants.find(
    (candidate) => candidate.codec === codec,
  );
  return {
    logicalStreamId: plan.logicalStreamId,
    generation,
    codec,
    variantId:
      variant?.variantId || `${plan.logicalStreamId}:${codec.toLowerCase()}`,
    ...(variant?.estimatedBitrateBps
      ? { estimatedBitrateBps: variant.estimatedBitrateBps }
      : {}),
    ...(variant?.target ? { target: { ...variant.target } } : {}),
    ...(variant?.targetAdjusted ? { targetAdjusted: true } : {}),
    receivers: variant?.receivers || [],
  };
}
