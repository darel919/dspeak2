import { describe, it } from "node:test";
import assert from "node:assert";

import {
  DIRECT_AUDIO_ONLY_MAX_PARTICIPANTS,
  DIRECT_VIDEO_MAX_PARTICIPANTS,
  AUTO_P2P_AUDIO_ONLY_MAX_PARTICIPANTS,
  AUTO_P2P_VIDEO_MAX_PARTICIPANTS,
  AUTO_MODE_MAX_PARTICIPANTS,
  isVideoActive,
  getMaxParticipants,
  getP2pMaxParticipants,
  checkEligibility,
  classifyICECandidate,
  getPreferredCandidateType,
} from "../shared/p2p-qualification.ts";

describe("p2p-qualification", () => {
  it("exports capacity constants", () => {
    assert.strictEqual(DIRECT_AUDIO_ONLY_MAX_PARTICIPANTS, 8);
    assert.strictEqual(DIRECT_VIDEO_MAX_PARTICIPANTS, 4);
    assert.strictEqual(AUTO_P2P_AUDIO_ONLY_MAX_PARTICIPANTS, 8);
    assert.strictEqual(AUTO_P2P_VIDEO_MAX_PARTICIPANTS, 4);
    assert.strictEqual(AUTO_MODE_MAX_PARTICIPANTS, 100);
  });

  it("detects video from sources", () => {
    assert.ok(!isVideoActive(["microphone"]));
    assert.ok(isVideoActive(["microphone", "camera"]));
    assert.ok(isVideoActive(["screen"]));
    assert.ok(!isVideoActive(["microphone"]));
    assert.ok(!isVideoActive([]));
  });

  it("returns correct max participants", () => {
    assert.strictEqual(getMaxParticipants("direct", false), 8);
    assert.strictEqual(getMaxParticipants("direct", true), 4);
    assert.strictEqual(getMaxParticipants("auto", false), 100);
    assert.strictEqual(getMaxParticipants("auto", true), 100);
    assert.strictEqual(getP2pMaxParticipants("auto", false), 8);
    assert.strictEqual(getP2pMaxParticipants("auto", true), 4);
  });

  it("checks eligibility for direct mode", () => {
    const healthy = { "cloudflare-realtime": { healthy: true } };

    assert.ok(checkEligibility("direct", 2, false, healthy).eligible);
    assert.ok(checkEligibility("direct", 8, false, healthy).eligible);
    assert.ok(checkEligibility("direct", 4, true, healthy).eligible);
    assert.ok(!checkEligibility("direct", 9, false, healthy).eligible);
    assert.ok(!checkEligibility("direct", 5, true, healthy).eligible);
  });

  it("checks eligibility for auto mode", () => {
    const healthy = { "cloudflare-realtime": { healthy: true } };

    assert.ok(checkEligibility("auto", 2, false, healthy).eligible);
    assert.ok(checkEligibility("auto", 9, false, healthy).eligible);
    assert.ok(checkEligibility("auto", 5, true, healthy).eligible);
    assert.ok(checkEligibility("auto", 100, false, healthy).eligible);
    assert.ok(checkEligibility("auto", 100, true, healthy).eligible);
    assert.ok(!checkEligibility("auto", 101, false, healthy).eligible);
    assert.ok(!checkEligibility("auto", 101, true, healthy).eligible);
  });

  it("rejects server source in direct mode", () => {
    const healthy = { "cloudflare-realtime": { healthy: true } };
    assert.ok(
      !checkEligibility("direct", 2, false, healthy, ["server-dj"]).eligible,
    );
    assert.ok(
      checkEligibility("auto", 2, false, healthy, ["server-dj"]).eligible,
    );
  });

  it("direct mode ignores broken SFU providers", () => {
    const broken = {
      "cloudflare-realtime": { healthy: false },
      mediasoup: { healthy: false },
    };
    assert.ok(checkEligibility("direct", 2, false, broken).eligible);
    assert.ok(checkEligibility("direct", 4, false, broken).eligible);
  });

  it("auto mode rejects routes whose provider is unhealthy", () => {
    const brokenCloudflare = { "cloudflare-realtime": { healthy: false } };
    const brokenMediasoup = { mediasoup: { healthy: false } };
    assert.ok(!checkEligibility("auto", 2, false, brokenCloudflare).eligible);
    assert.ok(!checkEligibility("auto", 6, false, brokenMediasoup).eligible);
  });

  it("empty provider health never blocks a direct route", () => {
    assert.ok(checkEligibility("direct", 2, false, {}).eligible);
    assert.ok(checkEligibility("auto", 2, false, {}).eligible);
  });

  it("classifies ICE candidates", () => {
    assert.strictEqual(classifyICECandidate({ type: "host" }), "host");
    assert.strictEqual(classifyICECandidate({ type: "srflx" }), "srflx");
    assert.strictEqual(classifyICECandidate({ type: "relay" }), "relay");
    assert.strictEqual(classifyICECandidate({ type: "prflx" }), "prflx");
    assert.strictEqual(classifyICECandidate({}), "unknown");
    assert.strictEqual(classifyICECandidate(null), "unknown");
  });

  it("prefers host > srflx > relay", () => {
    assert.strictEqual(
      getPreferredCandidateType([
        { type: "relay" },
        { type: "srflx" },
        { type: "host" },
      ]),
      "host",
    );
    assert.strictEqual(
      getPreferredCandidateType([{ type: "relay" }, { type: "srflx" }]),
      "srflx",
    );
    assert.strictEqual(getPreferredCandidateType([{ type: "relay" }]), "relay");
    assert.strictEqual(getPreferredCandidateType([]), "unknown");
  });
});
