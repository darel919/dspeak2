import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyP2pPath,
  directIceServers,
  isAllowedP2pPair,
  isDirectP2pPair,
  isViableP2pPair,
  normalizeIceServers,
  normalizeP2pIcePolicy,
  p2pIcePolicyAllowsRelay,
  qualificationUsesRelay,
} from "../app/shared/native-p2p-common.ts";

type CandidateType = "host" | "srflx" | "prflx" | "relay";

function pair(local: CandidateType, remote: CandidateType) {
  return {
    state: "succeeded",
    local: { candidateType: local },
    remote: { candidateType: remote },
  };
}

function directOnlyUrls(servers: Array<{ urls: unknown }>): string[] {
  return directIceServers(servers).flatMap((server) =>
    Array.isArray(server.urls) ? server.urls : [String(server.urls)],
  );
}

test("isViableP2pPair no longer equates viability with direct-only", () => {
  assert.equal(isViableP2pPair(pair("host", "host")), true);
  assert.equal(isViableP2pPair(pair("srflx", "prflx")), true);
  assert.equal(isViableP2pPair(pair("relay", "host")), true);
  assert.equal(isViableP2pPair(pair("relay", "relay")), true);
  assert.equal(isViableP2pPair(pair("host", "relay")), true);
  assert.equal(
    isViableP2pPair({ state: "failed", local: {}, remote: {} }),
    false,
  );
  assert.equal(isViableP2pPair(pair("host", "host").local), false);
});

test("classifyP2pPath separates direct from relay", () => {
  assert.equal(classifyP2pPath(pair("host", "host")), "direct");
  assert.equal(classifyP2pPath(pair("host", "srflx")), "direct");
  assert.equal(classifyP2pPath(pair("srflx", "srflx")), "direct");
  assert.equal(classifyP2pPath(pair("prflx", "host")), "direct");
  assert.equal(classifyP2pPath(pair("relay", "host")), "relay");
  assert.equal(classifyP2pPath(pair("host", "relay")), "relay");
  assert.equal(classifyP2pPath(pair("relay", "relay")), "relay");
  assert.equal(classifyP2pPath(null), null);
  assert.equal(classifyP2pPath({ state: "succeeded" }), null);
  assert.equal(classifyP2pPath({ state: "succeeded", local: {} }), null);
});

test("isDirectP2pPair mirrors classifyP2pPath", () => {
  assert.equal(isDirectP2pPair(pair("host", "host")), true);
  assert.equal(isDirectP2pPair(pair("relay", "host")), false);
  assert.equal(isDirectP2pPair(null), false);
});

test("p2p ICE policy controls relay allowance", () => {
  assert.equal(p2pIcePolicyAllowsRelay("direct-only"), false);
  assert.equal(p2pIcePolicyAllowsRelay("direct-or-relay"), true);
  assert.equal(normalizeP2pIcePolicy("direct-or-relay"), "direct-or-relay");
  assert.equal(normalizeP2pIcePolicy("relay"), "direct-only");
  assert.equal(normalizeP2pIcePolicy(null), "direct-only");
});

test("isAllowedP2pPair honors the ICE policy", () => {
  assert.equal(isAllowedP2pPair(pair("host", "host"), "direct-only"), true);
  assert.equal(isAllowedP2pPair(pair("relay", "host"), "direct-only"), false);
  assert.equal(
    isAllowedP2pPair(pair("relay", "host"), "direct-or-relay"),
    true,
  );
  assert.equal(isAllowedP2pPair({ state: "failed" }, "direct-or-relay"), false);
});

test("direct-only ICE servers strip TURN but keep STUN", () => {
  const servers = [
    { urls: "stun:example.com:3478" },
    { urls: "turn:example.com:3478", username: "u", credential: "c" },
    { urls: ["turn:example.com:3478?transport=tcp", "turn:example.com:3479"] },
  ];
  /* SAFETY: directIceServers returns RTCIceServer entries built from the input above. */
  const direct = directIceServers(servers) as Array<{ urls: unknown }>;
  assert.equal(direct.length, 1);
  assert.equal(direct[0].urls, "stun:example.com:3478");
});

test("direct-or-relay ICE servers retain TURN with credentials", () => {
  const servers = [
    { urls: "stun:example.com:3478" },
    { urls: "turn:example.com:3478", username: "u", credential: "c" },
  ];
  /* SAFETY: normalizeIceServers returns RTCIceServer entries built from the input above. */
  const normalized = normalizeIceServers(servers) as Array<{
    urls: unknown;
    username?: string;
    credential?: string;
  }>;
  assert.equal(normalized.length, 2);
  const turn = normalized.find((entry) =>
    (Array.isArray(entry.urls) ? entry.urls[0] : entry.urls)
      ?.toString()
      .startsWith("turn:"),
  );
  assert.ok(turn, "TURN server must survive normalization");
  assert.equal(turn?.username, "u");
  assert.equal(turn?.credential, "c");
  assert.equal(directOnlyUrls(servers).length, 1);
  assert.ok(
    !directOnlyUrls(servers)[0].startsWith("turn:"),
    "direct-only must not leak TURN",
  );
});

test("qualificationUsesRelay derives path from candidate evidence", () => {
  assert.equal(
    qualificationUsesRelay([
      {
        peerId: "a",
        path: "direct",
        localCandidateType: "host",
        remoteCandidateType: "host",
      },
    ]),
    false,
  );
  assert.equal(
    qualificationUsesRelay([
      {
        peerId: "a",
        path: "relay",
        localCandidateType: "relay",
        remoteCandidateType: "host",
      },
    ]),
    true,
  );
  assert.equal(
    qualificationUsesRelay([
      {
        peerId: "a",
        localCandidateType: "srflx",
        remoteCandidateType: "relay",
      },
    ]),
    true,
  );
  assert.equal(qualificationUsesRelay([]), false);
  assert.equal(qualificationUsesRelay(null), false);
});
