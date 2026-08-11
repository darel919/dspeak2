import assert from "node:assert/strict";
import test from "node:test";
import {
  configuredOutboundHosts,
  createPublicHttpsAgent,
  isPublicOutboundAddress,
  parseOutboundHttpsUrl,
} from "../server/infrastructure/network/outbound-request.ts";

test("outbound address policy rejects local and reserved networks", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.0.1",
    "198.51.100.10",
    "::1",
    "fd00::1",
    "fe80::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
  ])
    assert.equal(isPublicOutboundAddress(address), false, address);
  assert.equal(isPublicOutboundAddress("1.1.1.1"), true);
  assert.equal(isPublicOutboundAddress("2606:4700:4700::1111"), true);
});

test("outbound URLs require HTTPS, standard ports, and allowed hosts", () => {
  const allowedHosts = configuredOutboundHosts(
    "push.example.com, services.mozilla.com",
  );
  assert.equal(
    parseOutboundHttpsUrl("https://updates.push.example.com/path", {
      allowedHosts,
    }).hostname,
    "updates.push.example.com",
  );
  for (const value of [
    "http://push.example.com",
    "https://user:password@push.example.com",
    "https://push.example.com:8443",
    "https://attacker.example.net",
  ])
    assert.throws(() => parseOutboundHttpsUrl(value, { allowedHosts }));
});

function runLookup(agent, hostname, options) {
  return new Promise((resolve, reject) => {
    agent.options.lookup(hostname, options, (error, address, family) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ address, family });
    });
  });
}

test("public HTTPS lookup returns all addresses when requested", async () => {
  const result = await runLookup(createPublicHttpsAgent(), "8.8.8.8", {
    all: true,
  });

  assert.deepEqual(result, {
    address: [{ address: "8.8.8.8", family: 4 }],
    family: undefined,
  });
});

test("public HTTPS lookup returns one address for regular requests", async () => {
  const result = await runLookup(createPublicHttpsAgent(), "8.8.8.8", {
    family: 4,
  });

  assert.deepEqual(result, { address: "8.8.8.8", family: 4 });
});
