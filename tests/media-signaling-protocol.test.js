import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyMediaSignalingClientHello,
  isMediaSignalingServerHello,
  MEDIA_SIGNALING_CLIENT_HELLO,
  MEDIA_SIGNALING_PROTOCOL_VERSION,
} from "../shared/media-signaling-protocol.js";
import { parseSignalingMessage } from "../server/utils/media-signaling-policy.js";
import {
  activateMediaProtocolSession,
  startMediaProtocolHandshake,
} from "../server/utils/media-protocol-session.js";

const mediaSessionId = "session-919";

test("media signaling accepts the strict 919 handshake", () => {
  const message = parseSignalingMessage(
    JSON.stringify({
      type: MEDIA_SIGNALING_CLIENT_HELLO,
      data: {
        protocolVersion: MEDIA_SIGNALING_PROTOCOL_VERSION,
        mediaSessionId,
      },
    }),
  );
  assert.equal(
    classifyMediaSignalingClientHello({
      data: message.data,
      mediaSessionId,
      protocolReady: false,
      type: message.type,
    }),
    "accept",
  );
});

test("media signaling rejects version and correlation mismatches", () => {
  for (const data of [
    { protocolVersion: 918, mediaSessionId },
    {
      protocolVersion: MEDIA_SIGNALING_PROTOCOL_VERSION,
      mediaSessionId: "another-session",
    },
  ]) {
    assert.equal(
      classifyMediaSignalingClientHello({
        data,
        mediaSessionId,
        protocolReady: false,
        type: MEDIA_SIGNALING_CLIENT_HELLO,
      }),
      "reject",
    );
  }
  assert.equal(
    parseSignalingMessage(
      JSON.stringify({
        type: MEDIA_SIGNALING_CLIENT_HELLO,
        data: { protocolVersion: 918, mediaSessionId },
      }),
    ).data.protocolVersion,
    918,
  );
});

test("media signaling rejects pre-handshake operations and duplicate replies", () => {
  assert.equal(
    classifyMediaSignalingClientHello({
      data: {},
      mediaSessionId,
      protocolReady: false,
      type: "heartbeat",
    }),
    "reject",
  );
  assert.equal(
    classifyMediaSignalingClientHello({
      data: {
        protocolVersion: MEDIA_SIGNALING_PROTOCOL_VERSION,
        mediaSessionId,
      },
      mediaSessionId,
      protocolReady: true,
      type: MEDIA_SIGNALING_CLIENT_HELLO,
    }),
    "duplicate",
  );
});

test("server hello requires bounded negotiated heartbeat settings", () => {
  const hello = {
    protocolVersion: MEDIA_SIGNALING_PROTOCOL_VERSION,
    heartbeatIntervalMs: 5000,
    heartbeatTimeoutMs: 20000,
    serverTime: Date.now(),
    mediaSessionId,
  };
  assert.equal(isMediaSignalingServerHello(hello), true);
  assert.equal(
    isMediaSignalingServerHello({
      ...hello,
      heartbeatTimeoutMs: hello.heartbeatIntervalMs,
    }),
    false,
  );
});

test("server handshake timeout rejects an unnegotiated session", () => {
  let timeoutHandler = null;
  let timedOut = false;
  let closed = null;
  let greeting = null;
  const session = { closed: false, protocolReady: false };
  startMediaProtocolHandshake({
    close: (code, reason) => {
      closed = { code, reason };
    },
    mediaSessionId,
    onTimeout: () => {
      timedOut = true;
    },
    send: (type, data) => {
      greeting = { type, data };
    },
    session,
    setTimer: (handler) => {
      timeoutHandler = handler;
      return { unref() {} };
    },
  });
  assert.equal(greeting.type, "hi919");
  timeoutHandler();
  assert.equal(timedOut, true);
  assert.deepEqual(closed, {
    code: 4002,
    reason: "Media client update required",
  });
});

test("activation replaces predecessors without superseding the new session", async () => {
  const predecessor = { peer: { id: "old-peer" } };
  const room = { sessions: new Map([["old-peer", predecessor]]) };
  const session = {
    activated: false,
    closed: false,
    handshakeTimer: null,
    peer: { id: "new-peer" },
    room,
    roomReservationHeld: false,
  };
  const closed = [];
  await activateMediaProtocolSession({
    closeSuperseded: (candidate) => closed.push(candidate.peer.id),
    createUserState: async () => {},
    persistPresence: async () => {},
    reconcile: () => {},
    releaseReservation: () => {},
    sendConnected: () => {},
    session,
    supersededSessions: () => [...room.sessions.values()],
    synchronizeChannel: () => {},
  });
  assert.deepEqual(closed, ["old-peer"]);
  assert.equal(room.sessions.get("new-peer"), session);
  assert.equal(session.closed, false);
});
