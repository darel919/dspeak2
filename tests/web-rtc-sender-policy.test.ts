import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyBrowserSenderLatencyPolicy,
  buildBrowserSenderPolicyParameters,
} from "../app/shared/web-rtc-sender-policy.ts";
import {
  clearWebRtcLatencyEvents,
  getWebRtcLatencyEvents,
} from "../app/shared/web-rtc-latency-diagnostics.ts";

const context = {
  profile: "ultra-low",
  qualityPriority: "framerate",
  configuredFrameRate: 30,
  configuredWidth: null,
  configuredHeight: null,
} as const;

type SenderParameterPayload = {
  encodings?: unknown[];
  degradationPreference?: string;
};

type SenderStub = {
  getParameters: () => RTCRtpSendParameters;
  setParameters: (parameters: RTCRtpSendParameters) => Promise<void>;
};

function asSender(stub: SenderStub): RTCRtpSender {
  /* SAFETY: The stub supplies the exact two-method sender surface this policy uses. */
  return stub as RTCRtpSender;
}

function payloadAsParameters(
  payload: SenderParameterPayload,
): RTCRtpSendParameters {
  /* SAFETY: Test payloads mirror the send-parameter shape the policy reads and writes. */
  return payload as RTCRtpSendParameters;
}

function senderWith(
  parameters: SenderParameterPayload,
  options: { setThrows?: Error } = {},
): RTCRtpSender {
  return asSender({
    getParameters: () => payloadAsParameters(parameters),
    setParameters: async () => {
      if (options.setThrows) throw options.setThrows;
    },
  });
}

function storingSender(initial: SenderParameterPayload) {
  let stored: RTCRtpSendParameters = payloadAsParameters(
    structuredClone(initial),
  );
  return asSender({
    getParameters: () => structuredClone(stored),
    setParameters: async (next) => {
      stored = structuredClone(next);
    },
  });
}

describe("sender policy parameters", () => {
  it("maps framerate priority to maintain-framerate with a rounded cap", () => {
    const requested = buildBrowserSenderPolicyParameters(context);
    assert.equal(requested.degradationPreference, "maintain-framerate");
    assert.equal(requested.maxFramerate, 30);
  });

  it("maps resolution priority to maintain-resolution", () => {
    const requested = buildBrowserSenderPolicyParameters({
      ...context,
      qualityPriority: "resolution",
      configuredFrameRate: 29.97,
    });
    assert.equal(requested.degradationPreference, "maintain-resolution");
    assert.equal(requested.maxFramerate, 30);
  });
});

describe("applyBrowserSenderLatencyPolicy", () => {
  it("reports not-attempted for senders without parameter access", async () => {
    const sender = asSender({
      getParameters: () => {
        throw new Error("no parameters");
      },
      setParameters: async () => {},
    });
    const result = await applyBrowserSenderLatencyPolicy(sender, context);
    assert.equal(result.attempted, false);
    assert.equal(result.applied, false);
    assert.deepEqual(result.appliedControls, []);
  });

  it("reports not-attempted when parameters carry no encodings", async () => {
    const result = await applyBrowserSenderLatencyPolicy(
      senderWith({ encodings: [] }),
      context,
    );
    assert.equal(result.attempted, false);
  });

  it("reports not-attempted when getParameters returns a malformed payload", async () => {
    const result = await applyBrowserSenderLatencyPolicy(
      senderWith({ encodings: undefined }),
      context,
    );
    assert.equal(result.attempted, false);
    assert.equal(result.applied, false);
  });

  it("applies degradation preference and max framerate then verifies by readback", async () => {
    clearWebRtcLatencyEvents();
    const sender = storingSender({
      encodings: [{ maxBitrate: 1_000_000 }],
    });
    const result = await applyBrowserSenderLatencyPolicy(sender, context);
    assert.equal(result.attempted, true);
    assert.equal(result.applied, true);
    assert.equal(result.verified, true);
    assert.equal(result.effective.degradationPreference, "maintain-framerate");
    assert.equal(result.effective.maxFramerate, 30);
    assert.equal(result.effective.maxBitrate, 1_000_000);
    const events = getWebRtcLatencyEvents();
    assert.ok(events.some((event) => event.kind === "sender-policy-applied"));
  });

  it("tolerates tolerated rejections without throwing and reports them", async () => {
    const sender = senderWith(
      { encodings: [{}] },
      { setThrows: new DOMException("denied", "InvalidModificationError") },
    );
    const result = await applyBrowserSenderLatencyPolicy(sender, context);
    assert.equal(result.applied, false);
    assert.equal(result.errorName, "InvalidModificationError");
    assert.equal(result.rejectedControls.length > 0, true);
  });

  it("throws on unexpected rejection classes", async () => {
    const sender = senderWith(
      { encodings: [{}] },
      { setThrows: new DOMException("nope", "OperationError") },
    );
    await assert.rejects(
      applyBrowserSenderLatencyPolicy(sender, context),
      /OperationError/,
    );
  });

  it("marks controls rejected when readback contradicts the request", async () => {
    const sender = senderWith({
      encodings: [{}],
      degradationPreference: "balanced",
    });
    const result = await applyBrowserSenderLatencyPolicy(sender, context);
    assert.equal(result.verified, false);
    assert.ok(result.rejectedControls.includes("degradationPreference"));
  });
});
