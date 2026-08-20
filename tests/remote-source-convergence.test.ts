import { test } from "node:test";
import assert from "node:assert";
import {
  createRemoteSourceIncarnation,
  createRemoteSourceConvergenceState,
  advancePhase,
  checkRtpProgression,
  checkAudioRtpProgression,
  canBecomeRenderable,
  canBecomeAudioRenderable,
  retireIncarnation,
  detectStall,
  scheduleRecovery,
  clearStall,
  compareIncarnationAuthority,
  isIncarnationCurrent,
  recordFirstFrameEvidence,
  recordPresentationProgress,
  DEFAULT_REMOTE_SOURCE_FSM_CONFIG,
  type RemoteSourceIncarnation,
  type RemoteSourceConvergenceState,
} from "../app/shared/remote-source-convergence.ts";

const TEST_INCARNATION: RemoteSourceIncarnation = {
  receiverIncarnationId: "receiver:test-feed-key:p2p:1:1",
  stableFeedKey: "test-feed-key",
  provider: "p2p",
  peerId: "peer-1",
  userId: "user-1",
  source: "camera",
  connectionEpoch: 1,
  sourceGeneration: 1,
};

function createState(
  source = TEST_INCARNATION.source,
): RemoteSourceConvergenceState {
  return createRemoteSourceConvergenceState({ ...TEST_INCARNATION, source });
}

test("Remote Source Convergence FSM - should start in not-announced phase", () => {
  const state = createState();
  assert.strictEqual(state.phase, "not-announced");
  assert.strictEqual(state.previousPhase, null);
  assert.strictEqual(state.retired, false);
  assert.strictEqual(state.failed, false);
});

test("Remote Source Convergence FSM - should advance through valid phase transitions", () => {
  const state = createState();
  assert.ok(advancePhase(state, "announced"));
  assert.strictEqual(state.phase, "announced");

  assert.ok(advancePhase(state, "publication-discovered"));
  assert.strictEqual(state.phase, "publication-discovered");

  assert.ok(advancePhase(state, "subscription-requested"));
  assert.strictEqual(state.phase, "subscription-requested");

  assert.ok(advancePhase(state, "consumer-created"));
  assert.strictEqual(state.phase, "consumer-created");

  assert.ok(advancePhase(state, "transport-connected"));
  assert.strictEqual(state.phase, "transport-connected");

  assert.ok(advancePhase(state, "rtp-flowing"));
  assert.strictEqual(state.phase, "rtp-flowing");

  assert.ok(advancePhase(state, "first-frame"));
  assert.strictEqual(state.phase, "first-frame");

  assert.ok(advancePhase(state, "renderable"));
  assert.strictEqual(state.phase, "renderable");
});

test("Remote Source Convergence FSM - should reject invalid phase transitions", () => {
  const state = createState();
  assert.ok(advancePhase(state, "announced"));
  assert.ok(!advancePhase(state, "rtp-flowing"));
  assert.strictEqual(state.phase, "announced");
});

test("Remote Source Convergence FSM - should allow retirement from any phase", () => {
  const state = createState();
  advancePhase(state, "announced");
  advancePhase(state, "publication-discovered");
  advancePhase(state, "subscription-requested");
  advancePhase(state, "consumer-created");
  advancePhase(state, "transport-connected");
  advancePhase(state, "rtp-flowing");

  assert.ok(advancePhase(state, "retired"));
  assert.strictEqual(state.phase, "retired");
  assert.strictEqual(state.retired, true);
});

test("Remote Source Convergence FSM - should allow failure from any phase", () => {
  const state = createState();
  advancePhase(state, "announced");
  advancePhase(state, "publication-discovered");

  assert.ok(advancePhase(state, "failed"));
  assert.strictEqual(state.phase, "failed");
  assert.strictEqual(state.failed, true);
});

test("Remote Source Convergence FSM - should track RTP progression with video stats", () => {
  const state = createState();
  advancePhase(state, "announced");
  advancePhase(state, "publication-discovered");
  advancePhase(state, "subscription-requested");
  advancePhase(state, "consumer-created");
  advancePhase(state, "transport-connected");

  let progression = checkRtpProgression(state, {
    bytesReceived: 1000,
    packetsReceived: 10,
    framesDecoded: 5,
    framesRendered: 5,
  });
  assert.ok(!progression);
  assert.ok(!state.rtpEvidence.rtpFlowingConfirmed);

  progression = checkRtpProgression(state, {
    bytesReceived: 2000,
    packetsReceived: 20,
    framesDecoded: 10,
    framesRendered: 10,
  });
  assert.ok(progression);
  assert.ok(state.rtpEvidence.rtpFlowingConfirmed);
  assert.ok(state.rtpEvidence.rtpFlowingConfirmedAt !== null);
});

test("Remote Source Convergence FSM - should track RTP progression with audio stats", () => {
  const state = createState("audio");
  advancePhase(state, "transport-connected");

  let progression = checkAudioRtpProgression(state, {
    bytesReceived: 1000,
    packetsReceived: 10,
    totalAudioEnergy: 100,
    totalSamplesReceived: 48000,
    jitterBufferEmittedCount: 100,
  });
  assert.ok(!progression);
  assert.ok(!state.rtpEvidence.rtpFlowingConfirmed);

  progression = checkAudioRtpProgression(state, {
    bytesReceived: 2000,
    packetsReceived: 20,
    totalAudioEnergy: 200,
    totalSamplesReceived: 96000,
    jitterBufferEmittedCount: 200,
  });
  assert.ok(progression);
  assert.ok(state.rtpEvidence.rtpFlowingConfirmed);
});

test("Remote Source Convergence FSM - should become renderable for video when RTP flowing and first frame received", () => {
  const state = createState();
  advancePhase(state, "announced");
  advancePhase(state, "publication-discovered");
  advancePhase(state, "subscription-requested");
  advancePhase(state, "consumer-created");
  advancePhase(state, "transport-connected");

  checkRtpProgression(state, { bytesReceived: 1000, packetsReceived: 10 });
  checkRtpProgression(state, { bytesReceived: 2000, packetsReceived: 20 });

  assert.ok(state.rtpEvidence.rtpFlowingConfirmed);
  assert.ok(!canBecomeRenderable(state));

  state.firstFrameEvidence.received = true;
  state.firstFrameEvidence.receivedAt = Date.now();
  state.phase = "first-frame";

  assert.ok(canBecomeRenderable(state));
});

test("Remote Source Convergence FSM - should become renderable for audio when RTP flowing", () => {
  const state = createState("audio");
  advancePhase(state, "announced");
  advancePhase(state, "publication-discovered");
  advancePhase(state, "subscription-requested");
  advancePhase(state, "consumer-created");
  advancePhase(state, "transport-connected");

  checkAudioRtpProgression(state, {
    bytesReceived: 1000,
    packetsReceived: 10,
  });
  checkAudioRtpProgression(state, {
    bytesReceived: 2000,
    packetsReceived: 20,
  });

  assert.ok(state.rtpEvidence.rtpFlowingConfirmed);
  assert.ok(canBecomeAudioRenderable(state));
});

test("Remote Source Convergence FSM - should detect stall in transport-connected phase without RTP", () => {
  const state = createState();
  advancePhase(state, "announced");
  advancePhase(state, "publication-discovered");
  advancePhase(state, "subscription-requested");
  advancePhase(state, "consumer-created");
  advancePhase(state, "transport-connected");
  state.phaseEnteredAt = Date.now() - 5000;

  const stalled = detectStall(state, DEFAULT_REMOTE_SOURCE_FSM_CONFIG);
  assert.ok(stalled);
  assert.ok(state.stallState.detected);
});

test("Remote Source Convergence FSM - should not detect stall when RTP is flowing", () => {
  const state = createState();
  advancePhase(state, "announced");
  advancePhase(state, "publication-discovered");
  advancePhase(state, "subscription-requested");
  advancePhase(state, "consumer-created");
  advancePhase(state, "transport-connected");
  checkRtpProgression(state, { bytesReceived: 1000, packetsReceived: 10 });
  checkRtpProgression(state, { bytesReceived: 2000, packetsReceived: 20 });
  state.phaseEnteredAt = Date.now() - 5000;

  const stalled = detectStall(state, DEFAULT_REMOTE_SOURCE_FSM_CONFIG);
  assert.ok(!stalled);
});

test("Remote Source Convergence FSM - should detect stall in rtp-flowing phase without first frame", () => {
  const state = createState();
  advancePhase(state, "announced");
  advancePhase(state, "publication-discovered");
  advancePhase(state, "subscription-requested");
  advancePhase(state, "consumer-created");
  advancePhase(state, "transport-connected");
  advancePhase(state, "rtp-flowing");
  checkRtpProgression(state, { bytesReceived: 1000, packetsReceived: 10 });
  checkRtpProgression(state, { bytesReceived: 2000, packetsReceived: 20 });
  state.rtpEvidence.lastRtpProgressAt = Date.now() - 5000;
  state.phaseEnteredAt = Date.now() - 6000;

  const stalled = detectStall(state, DEFAULT_REMOTE_SOURCE_FSM_CONFIG);
  assert.ok(stalled);
});

test("Remote Source Convergence FSM - should detect a frame timeout while RTP flows", () => {
  const state = createState();
  advancePhase(state, "announced");
  advancePhase(state, "publication-discovered");
  advancePhase(state, "subscription-requested");
  advancePhase(state, "consumer-created");
  advancePhase(state, "transport-connected");
  checkRtpProgression(state, { bytesReceived: 1000, packetsReceived: 10 });
  checkRtpProgression(state, { bytesReceived: 2000, packetsReceived: 20 });
  state.rtpEvidence.rtpFlowingConfirmedAt =
    Date.now() - DEFAULT_REMOTE_SOURCE_FSM_CONFIG.firstFrameTimeoutMs;
  state.rtpEvidence.lastRtpProgressAt = Date.now();

  assert.equal(detectStall(state, DEFAULT_REMOTE_SOURCE_FSM_CONFIG), true);
  assert.equal(state.stallState.detected, true);
});

test("Remote Source Convergence FSM - detects decoder stall while packets and frames arrive", () => {
  const state = createState();
  advancePhase(state, "transport-connected");
  checkRtpProgression(
    state,
    {
      bytesReceived: 1000,
      packetsReceived: 10,
      framesReceived: 1,
      framesDecoded: 1,
    },
    1000,
  );
  checkRtpProgression(
    state,
    {
      bytesReceived: 2000,
      packetsReceived: 20,
      framesReceived: 2,
      framesDecoded: 2,
    },
    2000,
  );
  recordFirstFrameEvidence(state, 2000);
  recordPresentationProgress(state, 2000, "rvfc");
  if (state.rtpEvidence.kind === "video")
    state.rtpEvidence.observedPresentationProgressCount =
      state.rtpEvidence.presentationProgressCount;
  state.phase = "renderable";
  checkRtpProgression(
    state,
    {
      bytesReceived: 3000,
      packetsReceived: 30,
      framesReceived: 3,
      framesDecoded: 2,
    },
    3000,
  );
  checkRtpProgression(
    state,
    {
      bytesReceived: 4000,
      packetsReceived: 40,
      framesReceived: 4,
      framesDecoded: 2,
    },
    4000,
  );

  assert.equal(
    detectStall(state, DEFAULT_REMOTE_SOURCE_FSM_CONFIG, 4000),
    true,
  );
  assert.equal(state.stallState.cause, "decoder-stall");
});

test("Remote Source Convergence FSM - detects render stall when decode continues", () => {
  const state = createState();
  advancePhase(state, "transport-connected");
  checkRtpProgression(
    state,
    {
      bytesReceived: 1000,
      packetsReceived: 10,
      framesReceived: 1,
      framesDecoded: 1,
    },
    1000,
  );
  checkRtpProgression(
    state,
    {
      bytesReceived: 2000,
      packetsReceived: 20,
      framesReceived: 2,
      framesDecoded: 2,
    },
    2000,
  );
  recordFirstFrameEvidence(state, 2000);
  recordPresentationProgress(state, 2000, "rvfc");
  if (state.rtpEvidence.kind === "video")
    state.rtpEvidence.observedPresentationProgressCount =
      state.rtpEvidence.presentationProgressCount;
  state.phase = "renderable";
  checkRtpProgression(
    state,
    {
      bytesReceived: 3000,
      packetsReceived: 30,
      framesReceived: 3,
      framesDecoded: 3,
    },
    3000,
  );
  checkRtpProgression(
    state,
    {
      bytesReceived: 4000,
      packetsReceived: 40,
      framesReceived: 4,
      framesDecoded: 4,
    },
    4000,
  );

  assert.equal(
    detectStall(state, DEFAULT_REMOTE_SOURCE_FSM_CONFIG, 4000),
    true,
  );
  assert.equal(state.stallState.cause, "render-stall");
});

test("Remote Source Convergence FSM - disables render stall without ongoing presentation evidence", () => {
  const state = createState();
  advancePhase(state, "transport-connected");
  checkRtpProgression(
    state,
    {
      bytesReceived: 1000,
      packetsReceived: 10,
      framesReceived: 1,
      framesDecoded: 1,
    },
    1000,
  );
  checkRtpProgression(
    state,
    {
      bytesReceived: 2000,
      packetsReceived: 20,
      framesReceived: 2,
      framesDecoded: 2,
    },
    2000,
  );
  recordFirstFrameEvidence(state, 2000);
  state.phase = "renderable";
  checkRtpProgression(
    state,
    {
      bytesReceived: 3000,
      packetsReceived: 30,
      framesReceived: 3,
      framesDecoded: 3,
    },
    3000,
  );
  checkRtpProgression(
    state,
    {
      bytesReceived: 4000,
      packetsReceived: 40,
      framesReceived: 4,
      framesDecoded: 4,
    },
    4000,
  );

  assert.equal(state.presentationObservationMode, "unavailable");
  assert.equal(
    detectStall(state, DEFAULT_REMOTE_SOURCE_FSM_CONFIG, 4000),
    false,
  );
});

test("Remote Source Convergence FSM - static screen sharing does not false-stall", () => {
  const state = createState("screen");
  advancePhase(state, "transport-connected");
  checkRtpProgression(
    state,
    {
      bytesReceived: 1000,
      packetsReceived: 10,
      framesReceived: 1,
      framesDecoded: 1,
    },
    1000,
  );
  checkRtpProgression(
    state,
    {
      bytesReceived: 2000,
      packetsReceived: 20,
      framesReceived: 2,
      framesDecoded: 2,
    },
    2000,
  );
  recordFirstFrameEvidence(state, 2000);
  recordPresentationProgress(state, 2000, "rvfc");
  if (state.rtpEvidence.kind === "video")
    state.rtpEvidence.observedPresentationProgressCount =
      state.rtpEvidence.presentationProgressCount;
  state.phase = "renderable";
  checkRtpProgression(
    state,
    {
      bytesReceived: 3000,
      packetsReceived: 30,
      framesReceived: 2,
      framesDecoded: 2,
    },
    3000,
  );
  checkRtpProgression(
    state,
    {
      bytesReceived: 4000,
      packetsReceived: 40,
      framesReceived: 2,
      framesDecoded: 2,
    },
    4000,
  );

  assert.equal(
    detectStall(state, DEFAULT_REMOTE_SOURCE_FSM_CONFIG, 4000),
    false,
  );
});

test("Remote Source Convergence FSM - should not detect stall when intentional receiving is disabled", () => {
  const state = createState();
  advancePhase(state, "transport-connected");
  state.intentionalReceivingDisabled = true;
  state.phaseEnteredAt = Date.now() - 5000;

  const stalled = detectStall(state, DEFAULT_REMOTE_SOURCE_FSM_CONFIG);
  assert.ok(!stalled);
});

test("Remote Source Convergence FSM - should schedule recovery with exponential backoff", () => {
  const state = createState();
  advancePhase(state, "transport-connected");
  state.phaseEnteredAt = Date.now() - 5000;
  detectStall(state, DEFAULT_REMOTE_SOURCE_FSM_CONFIG);

  scheduleRecovery(state, DEFAULT_REMOTE_SOURCE_FSM_CONFIG, () => {});

  assert.strictEqual(state.phase, "recovering");
  assert.strictEqual(state.stallState.recoveryAttempt, 1);
  assert.ok(state.stallState.recoveryTimer !== null);

  if (state.stallState.recoveryTimer) {
    clearTimeout(state.stallState.recoveryTimer);
    state.stallState.recoveryTimer = null;
  }
});

test("Remote Source Convergence FSM - should fail after max recovery attempts", () => {
  const state = createState();
  advancePhase(state, "announced");
  advancePhase(state, "publication-discovered");
  advancePhase(state, "subscription-requested");
  advancePhase(state, "consumer-created");
  advancePhase(state, "transport-connected");
  state.phaseEnteredAt = Date.now() - 5000;
  detectStall(state, DEFAULT_REMOTE_SOURCE_FSM_CONFIG);

  for (
    let i = 0;
    i <= DEFAULT_REMOTE_SOURCE_FSM_CONFIG.maxRecoveryAttempts;
    i++
  ) {
    scheduleRecovery(state, DEFAULT_REMOTE_SOURCE_FSM_CONFIG, () => {});
    if (state.stallState.recoveryTimer) {
      clearTimeout(state.stallState.recoveryTimer);
      state.stallState.recoveryTimer = null;
    }
  }

  assert.ok(state.failed);
});

test("Remote Source Convergence FSM - should clear stall and return to rtp-flowing", () => {
  const state = createState();
  advancePhase(state, "announced");
  advancePhase(state, "publication-discovered");
  advancePhase(state, "subscription-requested");
  advancePhase(state, "consumer-created");
  advancePhase(state, "transport-connected");
  advancePhase(state, "rtp-flowing");
  checkRtpProgression(state, { bytesReceived: 1000, packetsReceived: 10 });
  checkRtpProgression(state, { bytesReceived: 2000, packetsReceived: 20 });
  state.rtpEvidence.lastRtpProgressAt = Date.now() - 5000;
  state.phaseEnteredAt = Date.now() - 5000;
  detectStall(state, DEFAULT_REMOTE_SOURCE_FSM_CONFIG);
  assert.ok(state.stallState.detected);

  clearStall(state);
  assert.ok(!state.stallState.detected);
  assert.strictEqual(state.stallState.recoveryAttempt, 0);
  assert.strictEqual(state.phase, "rtp-flowing");
});

test("Remote Source Convergence FSM - should retire incarnation and abort controller", () => {
  const state = createState();
  advancePhase(state, "renderable");
  retireIncarnation(state);
  assert.ok(state.retired);
  assert.ok(state.abortController.signal.aborted);
});

test("Remote Source Convergence FSM - should compare incarnation authority correctly", () => {
  const inc1 = createRemoteSourceIncarnation({
    ...TEST_INCARNATION,
    connectionEpoch: 1,
    sourceGeneration: 1,
  });
  const inc2 = createRemoteSourceIncarnation({
    ...TEST_INCARNATION,
    connectionEpoch: 2,
    sourceGeneration: 1,
  });
  const inc3 = createRemoteSourceIncarnation({
    ...TEST_INCARNATION,
    connectionEpoch: 1,
    sourceGeneration: 2,
  });

  const compare1 = compareIncarnationAuthority(inc1, inc2);
  assert.ok(compare1 < 0);

  const compare2 = compareIncarnationAuthority(inc1, inc3);
  assert.ok(compare2 < 0);

  const compare3 = compareIncarnationAuthority(inc1, inc1);
  assert.strictEqual(compare3, 0);
});

test("Remote Source Convergence FSM - keeps equal authority separate from receiver identity", () => {
  const current = createRemoteSourceIncarnation({
    ...TEST_INCARNATION,
    receiverIncarnationId: "receiver-a",
    connectionEpoch: 1,
    sourceGeneration: 1,
  });
  const replacement = createRemoteSourceIncarnation({
    ...TEST_INCARNATION,
    receiverIncarnationId: "receiver-b",
    connectionEpoch: 1,
    sourceGeneration: 1,
  });

  assert.equal(compareIncarnationAuthority(current, replacement), 0);
  assert.equal(compareIncarnationAuthority(replacement, current), 0);
  assert.equal(isIncarnationCurrent(current, replacement), false);
  assert.equal(isIncarnationCurrent(current, current), true);
});

test("Remote Source Convergence FSM - should identify current incarnation correctly", () => {
  const current = createRemoteSourceIncarnation({
    ...TEST_INCARNATION,
    connectionEpoch: 1,
    sourceGeneration: 1,
  });
  const same = createRemoteSourceIncarnation({
    ...TEST_INCARNATION,
    connectionEpoch: 1,
    sourceGeneration: 1,
  });
  const different = createRemoteSourceIncarnation({
    ...TEST_INCARNATION,
    connectionEpoch: 2,
    sourceGeneration: 1,
  });

  assert.ok(isIncarnationCurrent(current, same));
  assert.ok(!isIncarnationCurrent(current, different));
  assert.ok(!isIncarnationCurrent(null, current));
});
