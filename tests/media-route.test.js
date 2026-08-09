import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateRouteForMode,
  compareRouteEpoch,
  createLocalRoute,
  createP2PRoute,
  createSFURoute,
  normalizeMediaPathMetrics,
  ConnectionMode,
  MediaRouteKind,
  P2PPath,
  SFUProvider,
} from "../shared/media-route.js";
import { shouldAcceptTopologyEvent } from "../server/utils/media-transition.js";

describe("media-route contracts", () => {
  describe("validateRouteForMode", () => {
    it("allows local route in Direct mode", () => {
      const route = createLocalRoute(1, 1, "test");
      const result = validateRouteForMode(route, ConnectionMode.DIRECT);
      assert.equal(result.valid, true);
    });

    it("allows direct P2P route in Direct mode", () => {
      const route = createP2PRoute(P2PPath.DIRECT, 1, 1, "test");
      const result = validateRouteForMode(route, ConnectionMode.DIRECT);
      assert.equal(result.valid, true);
    });

    it("rejects relay P2P route in Direct mode", () => {
      const route = createP2PRoute(P2PPath.RELAY, 1, 1, "test");
      const result = validateRouteForMode(route, ConnectionMode.DIRECT);
      assert.equal(result.valid, false);
      assert.ok(result.error.includes("not allowed in Direct mode"));
    });

    it("rejects SFU route in Direct mode", () => {
      const route = createSFURoute(
        SFUProvider.CLOUDFLARE_REALTIME,
        1,
        1,
        "test",
      );
      const result = validateRouteForMode(route, ConnectionMode.DIRECT);
      assert.equal(result.valid, false);
      assert.ok(result.error.includes("not allowed in Direct mode"));
    });

    it("allows all routes in Auto mode", () => {
      const routes = [
        createLocalRoute(1, 1, "test"),
        createP2PRoute(P2PPath.DIRECT, 1, 1, "test"),
        createP2PRoute(P2PPath.RELAY, 1, 1, "test"),
        createSFURoute(SFUProvider.CLOUDFLARE_REALTIME, 1, 1, "test"),
        createSFURoute(SFUProvider.MEDIASOUP, 1, 1, "test"),
      ];
      for (const route of routes) {
        const result = validateRouteForMode(route, ConnectionMode.AUTO);
        assert.equal(
          result.valid,
          true,
          `Route ${route.kind} should be allowed in Auto mode`,
        );
      }
    });
  });

  describe("compareRouteEpoch", () => {
    it("higher epoch wins", () => {
      const a = createLocalRoute(1, 1, "test");
      const b = createLocalRoute(2, 1, "test");
      assert.equal(compareRouteEpoch(a, b), -1);
      assert.equal(compareRouteEpoch(b, a), 1);
    });

    it("equal epoch compares sourceRevision", () => {
      const a = createLocalRoute(1, 1, "test");
      const b = createLocalRoute(1, 2, "test");
      assert.equal(compareRouteEpoch(a, b), -1);
      assert.equal(compareRouteEpoch(b, a), 1);
    });

    it("equal epoch and sourceRevision returns 0", () => {
      const a = createLocalRoute(1, 1, "test");
      const b = createLocalRoute(1, 1, "test");
      assert.equal(compareRouteEpoch(a, b), 0);
    });

    it("works across route kinds", () => {
      const a = createP2PRoute(P2PPath.DIRECT, 1, 1, "test");
      const b = createSFURoute(SFUProvider.CLOUDFLARE_REALTIME, 2, 1, "test");
      assert.equal(compareRouteEpoch(a, b), -1);
    });
  });

  describe("normalizeMediaPathMetrics", () => {
    it("normalizes numeric fields to numbers", () => {
      const raw = {
        routeId: "r1",
        peerOrProvider: "p1",
        rttMs: "50",
        jitterMs: "5",
        packetLossPercent: "0.1",
        jitterBufferDelayMs: "30",
        availableOutgoingBitrate: "100000",
        concealedAudioRatio: "0.02",
        candidateType: "host",
        protocol: "udp",
        sampledAt: "1234567890",
      };
      const normalized = normalizeMediaPathMetrics(raw);
      assert.equal(normalized.rttMs, 50);
      assert.equal(normalized.jitterMs, 5);
      assert.equal(normalized.packetLossPercent, 0.1);
      assert.equal(normalized.jitterBufferDelayMs, 30);
      assert.equal(normalized.availableOutgoingBitrate, 100000);
      assert.equal(normalized.concealedAudioRatio, 0.02);
      assert.equal(normalized.candidateType, "host");
      assert.equal(normalized.protocol, "udp");
      assert.equal(normalized.sampledAt, 1234567890);
    });

    it("handles null/undefined values", () => {
      const raw = {
        routeId: "r1",
        peerOrProvider: "p1",
        rttMs: null,
        jitterMs: undefined,
        packetLossPercent: null,
        jitterBufferDelayMs: undefined,
        availableOutgoingBitrate: null,
        concealedAudioRatio: undefined,
        sampledAt: Date.now(),
      };
      const normalized = normalizeMediaPathMetrics(raw);
      assert.equal(normalized.rttMs, null);
      assert.equal(normalized.jitterMs, null);
      assert.equal(normalized.packetLossPercent, null);
      assert.equal(normalized.jitterBufferDelayMs, null);
      assert.equal(normalized.availableOutgoingBitrate, null);
      assert.equal(normalized.concealedAudioRatio, null);
    });

    it("converts explicit WebRTC seconds and loss fractions", () => {
      const normalized = normalizeMediaPathMetrics({
        routeId: "r1",
        peerOrProvider: "p1",
        rttSeconds: 0.05,
        jitterSeconds: 0.005,
        jitterBufferDelaySeconds: 0.03,
        packetLossFraction: 0.01,
      });
      assert.equal(normalized.rttMs, 50);
      assert.equal(normalized.jitterMs, 5);
      assert.equal(normalized.jitterBufferDelayMs, 30);
      assert.equal(normalized.packetLossPercent, 1);
    });

    it("defaults sampledAt to now if missing", () => {
      const before = Date.now();
      const normalized = normalizeMediaPathMetrics({
        routeId: "r1",
        peerOrProvider: "p1",
      });
      const after = Date.now();
      assert.ok(
        normalized.sampledAt >= before && normalized.sampledAt <= after,
      );
    });
  });

  describe("stale route overwrite guard", () => {
    it("rejects a stale epoch before it can overwrite a newer route", () => {
      const newest = createSFURoute(SFUProvider.MEDIASOUP, 5, 2, "test");
      const stale = createP2PRoute(P2PPath.DIRECT, 3, 1, "stale");
      assert.equal(
        compareRouteEpoch(stale, newest),
        -1,
        "stale route orders below the newest route",
      );
      assert.equal(
        shouldAcceptTopologyEvent(stale, newest.epoch),
        false,
        "stale event must not overwrite a newer committed route",
      );
    });

    it("accepts an equal-epoch event with the same sourceRevision", () => {
      const current = createLocalRoute(1, 1, "test");
      assert.equal(shouldAcceptTopologyEvent(current, current.epoch), true);
    });
  });
});
