import assert from "node:assert/strict";
import test from "node:test";
import { relayMediaAttenuationState } from "../server/utils/media-attenuation-state.js";

test("attenuation state is relayed only to the authenticated room peer", () => {
  const sent = [];
  const target = { peer: { id: "target-socket" } };
  const session = {
    peer: { id: "listener-1" },
    room: { sessions: new Map([["sharer-1", target]]) },
  };
  const relayed = relayMediaAttenuationState(
    session,
    {
      active: true,
      effectivePercent: 0,
      targetPeerId: "sharer-1",
    },
    (peer, type, data) => sent.push({ data, peer, type }),
  );

  assert.equal(relayed, true);
  assert.deepEqual(sent, [
    {
      data: {
        active: true,
        effectivePercent: 0,
        fromPeerId: "listener-1",
        source: "screen-audio",
      },
      peer: target.peer,
      type: "attenuation-state",
    },
  ]);
  assert.equal(
    relayMediaAttenuationState(
      session,
      {
        active: false,
        effectivePercent: 100,
        targetPeerId: "missing",
      },
      () => assert.fail("must not relay"),
    ),
    false,
  );
});
