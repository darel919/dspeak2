import assert from "node:assert/strict";
import test from "node:test";
import {
  MEDIA_CONTROL_MESSAGE_TYPES,
  MEDIA_SIGNALING_CLIENT_HELLO,
  MEDIA_SIGNALING_CONTRACT_REVISION,
  MEDIA_SIGNALING_PROTOCOL_VERSION,
  MEDIA_SIGNALING_SERVER_HELLO,
} from "../shared/media-signaling-protocol.ts";

const EXPECTED_MESSAGE_TYPES = [
  "hello919",
  "p2p-signal",
  "p2p-ready",
  "media-sources",
  "participant-voice-state",
  "media-capabilities",
  "codec-migration-state",
  "participant-capabilities",
  "p2p-qualified",
  "p2p-failed",
  "provider-ready",
  "provider-failure",
  "provider-recovering",
  "topology-ready",
  "topology-failed",
  "cloudflare-request",
  "cloudflare-publication",
  "media-qoe",
  "client-sfu-rtt",
  "heartbeat",
  "resume",
  "state-nack",
  "room-snapshot",
  "leave",
  "request-snapshot",
  "receiver-evidence",
  "hi919",
  "topology-state",
  "p2p-signal-relay",
  "route-commit",
  "heartbeat-ack",
  "operation-ack",
  "error919",
  "provider-ticket",
  "cloudflare-response",
  "cloudflare-publication-available",
  "participant-sfu-rtt",
];

test("client media-control contract uses the 919 rev-5 wire family", () => {
  assert.equal(MEDIA_SIGNALING_PROTOCOL_VERSION, 919);
  assert.equal(MEDIA_SIGNALING_CONTRACT_REVISION, 5);
  assert.equal(MEDIA_SIGNALING_CLIENT_HELLO, "hello919");
  assert.equal(MEDIA_SIGNALING_SERVER_HELLO, "hi919");
  assert.deepEqual(
    Object.values(MEDIA_CONTROL_MESSAGE_TYPES),
    EXPECTED_MESSAGE_TYPES,
  );
});
