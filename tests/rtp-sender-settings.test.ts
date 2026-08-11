import assert from "node:assert/strict";
import test from "node:test";
import { applyRtpSenderSettings } from "../app/shared/rtp-sender-settings.ts";

test("sender updates do not create a browser encoding", async () => {
  let setCalls = 0;
  const sender = {
    getParameters: () => ({
      encodings: [],
      transactionId: "browser-owned",
    }),
    async setParameters() {
      setCalls += 1;
    },
  };

  const applied = await applyRtpSenderSettings(sender, {
    encodings: [{ maxBitrate: 48000 }],
  });

  assert.equal(applied, false);
  assert.equal(setCalls, 0);
});

test("optional sender tuning rejection does not abort publication", async () => {
  const sender = {
    getParameters: () => ({ encodings: [{}] }),
    async setParameters() {
      throw new DOMException(
        "Read-only field modified in setParameters().",
        "InvalidModificationError",
      );
    },
  };

  const applied = await applyRtpSenderSettings(sender, {
    encodings: [{ maxBitrate: 48000 }],
  });

  assert.equal(applied, false);
});

test("sender updates preserve browser-owned DTX parameters", async () => {
  const parameters = {
    encodings: [{ dtx: "disabled" }],
    transactionId: "transaction-1",
  };
  let applied = null;
  const sender = {
    getParameters: () => parameters,
    async setParameters(next) {
      if (next.encodings[0].dtx !== "disabled")
        throw new DOMException(
          "Read-only field modified in setParameters().",
          "InvalidModificationError",
        );
      applied = next;
    },
  };

  await applyRtpSenderSettings(sender, {
    dtx: "enabled",
    encodings: [{ maxBitrate: 48000, priority: "high" }],
  });

  assert.equal(applied.encodings[0].dtx, "disabled");
  assert.equal(applied.encodings[0].maxBitrate, 48000);
  assert.equal(applied.encodings[0].priority, "high");
});
