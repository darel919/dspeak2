import assert from "node:assert/strict";
import test from "node:test";
import { applyRtpSenderSettings } from "../app/shared/rtp-sender-settings.js";

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
