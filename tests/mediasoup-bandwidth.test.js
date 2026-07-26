import assert from "node:assert/strict";
import test from "node:test";
import { queueSfuBandwidthRebalance } from "../server/utils/mediasoup-bandwidth.js";

test("SFU bandwidth rebalance ignores closed and send transports", async () => {
  const applied = [];
  const transport = (id, direction, closed = false) => ({
    id,
    closed,
    appData: { direction },
    async setMaxOutgoingBitrate(bitrate) {
      applied.push([id, bitrate]);
    },
  });
  const state = {
    bandwidthRebalance: Promise.resolve(),
    config: {
      maxClientOutgoingBitrate: 4_500_000,
      maxServerOutgoingBitrate: 40_000_000,
    },
    sessions: new Map([
      [
        "peer-1",
        {
          transports: new Map([
            ["recv", transport("recv", "recv")],
            ["send", transport("send", "send")],
            ["closed", transport("closed", "recv", true)],
          ]),
        },
      ],
    ]),
  };

  await queueSfuBandwidthRebalance(state);
  assert.deepEqual(applied, [["recv", 4_500_000]]);
});
