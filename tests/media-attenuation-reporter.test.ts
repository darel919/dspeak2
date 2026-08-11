import assert from "node:assert/strict";
import test from "node:test";
import {
  createMediaAttenuationReporter,
  summarizeMediaAttenuation,
} from "../app/shared/media-attenuation-reporter.ts";

test("listener reports effective screen audio gain once per state", () => {
  const sent = [];
  let reports = new Map();
  const reporter = createMediaAttenuationReporter({
    getLocalPeerId: () => "listener-1",
    getPeers: () => [
      { peerId: "listener-1", userId: "user-1" },
      { peerId: "sharer-1", userId: "user-2" },
    ],
    onReportsChange: (next) => {
      reports = next;
    },
    send: (message) => {
      sent.push(message);
      return true;
    },
  });
  const state = {
    active: true,
    baseVolume: 0.8,
    effectiveVolume: 0,
    entry: { peerId: "sharer-1" },
  };
  reporter.report(state);
  reporter.report(state);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].data.effectivePercent, 0);

  reporter.receive({
    active: true,
    effectivePercent: 0,
    fromPeerId: "listener-2",
    source: "screen-audio",
  });
  assert.deepEqual(
    summarizeMediaAttenuation(
      reports,
      [{ peerId: "sharer-1" }, { peerId: "listener-2" }],
      "sharer-1",
    ),
    {
      active: true,
      effectivePercent: 0,
      expectedListeners: 1,
      reportingListeners: 1,
    },
  );
});
