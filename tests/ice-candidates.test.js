import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPublicIceCandidates,
  buildWebRtcListenInfos,
} from "../server/utils/ice-candidates.js";

const serverCandidates = [
  {
    foundation: "udpfoundation",
    priority: 1_076_302_079,
    ip: "0.0.0.0",
    protocol: "udp",
    port: 9988,
    type: "host",
  },
];

test("creates native IPv6 candidates before IPv4 fallback candidates", () => {
  const infos = buildWebRtcListenInfos({
    listenIp: "0.0.0.0",
    rtcPort: 9988,
    announcedAddress: "vote-minds.gl.at.ply.gg",
    directAddress: "rtc.dspeak.example.com",
  });

  assert.deepEqual(infos, [
    {
      ip: "::",
      port: 9988,
      announcedAddress: "rtc.dspeak.example.com",
      flags: { ipv6Only: true },
      protocol: "udp",
    },
    {
      ip: "::",
      port: 9988,
      announcedAddress: "rtc.dspeak.example.com",
      flags: { ipv6Only: true },
      protocol: "tcp",
    },
    {
      ip: "0.0.0.0",
      port: 9988,
      announcedAddress: "vote-minds.gl.at.ply.gg",
      protocol: "udp",
    },
    {
      ip: "0.0.0.0",
      port: 9988,
      announcedAddress: "vote-minds.gl.at.ply.gg",
      protocol: "tcp",
    },
  ]);
});

test("resolves direct DDNS and advertises each configured external port", async () => {
  const candidates = await buildPublicIceCandidates(
    [
      {
        ...serverCandidates[0],
        ip: "rtc.dspeak.example.com",
      },
      {
        ...serverCandidates[0],
        ip: "vote-minds.gl.at.ply.gg",
        priority: serverCandidates[0].priority - 100,
      },
    ],
    {
      announcedAddress: "vote-minds.gl.at.ply.gg",
      announcedPort: 57554,
      directAddress: "rtc.dspeak.example.com",
      directPort: 40001,
    },
    async () => ["2001:448a:1041:9065:2a0:98ff:fe3b:e46"],
  );

  assert.equal(candidates[0].ip, "2001:448a:1041:9065:2a0:98ff:fe3b:e46");
  assert.equal(candidates[0].port, 40001);
  assert.equal(candidates[1].port, 57554);
  assert.ok(candidates[0].priority > candidates[1].priority);
});

test("keeps the existing single public candidate when direct access is disabled", async () => {
  const candidates = await buildPublicIceCandidates(
    [
      {
        ...serverCandidates[0],
        ip: "vote-minds.gl.at.ply.gg",
      },
    ],
    {
      announcedAddress: "vote-minds.gl.at.ply.gg",
      announcedPort: 57554,
    },
  );

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].ip, "vote-minds.gl.at.ply.gg");
  assert.equal(candidates[0].port, 57554);
  assert.equal(candidates[0].priority, serverCandidates[0].priority);
});

test("drops only the direct candidate when its DDNS lookup fails", async () => {
  const candidates = await buildPublicIceCandidates(
    [
      { ...serverCandidates[0], ip: "rtc.dspeak.example.com" },
      { ...serverCandidates[0], ip: "vote-minds.gl.at.ply.gg" },
    ],
    {
      announcedAddress: "vote-minds.gl.at.ply.gg",
      announcedPort: 57554,
      directAddress: "rtc.dspeak.example.com",
    },
    async () => {
      throw new Error("DNS unavailable");
    },
  );

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].ip, "vote-minds.gl.at.ply.gg");
  assert.equal(candidates[0].port, 57554);
});

test("forces native IPv6 candidate priority above the Playit fallback", async () => {
  const candidates = await buildPublicIceCandidates(
    [
      {
        ...serverCandidates[0],
        ip: "rtc.dspeak.example.com",
        priority: 100,
      },
      { ...serverCandidates[0], ip: "vote-minds.gl.at.ply.gg", priority: 100 },
    ],
    {
      announcedAddress: "vote-minds.gl.at.ply.gg",
      announcedPort: 57554,
      directAddress: "rtc.dspeak.example.com",
    },
    async () => ["2001:db8::10"],
  );

  assert.ok(candidates[0].priority > candidates[1].priority);
});
