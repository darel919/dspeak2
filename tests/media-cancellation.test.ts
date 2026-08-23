import assert from "node:assert/strict";
import test from "node:test";
import {
  MEDIA_CANCELLATION_CODES,
  MediaCancellationError,
  classifyMediaError,
  isMediaCancellationError,
  providerIncarnationKey,
  sourceIncarnationNewer,
  transitionIdentityKey,
} from "../app/shared/media-cancellation.ts";

test("typed cancellation codes classify as non-fatal", () => {
  const error = new MediaCancellationError(
    MEDIA_CANCELLATION_CODES.MEDIA_OPERATION_SUPERSEDED,
  );
  assert.equal(isMediaCancellationError(error), true);
  assert.deepEqual(classifyMediaError(error), {
    cancellation: true,
    code: "MEDIA_OPERATION_SUPERSEDED",
  });
});

test("bare errors carrying a superseded code still cancel", () => {
  const error = Object.assign(new Error("activation replaced"), {
    code: "NATIVE_PROVIDER_ACTIVATION_SUPERSEDED",
  });
  assert.equal(classifyMediaError(error).cancellation, true);
});

test("lifecycle messages classify as cancellation without invented codes", () => {
  assert.equal(
    classifyMediaError(new Error("Cloudflare session closed")).cancellation,
    true,
  );
  assert.equal(
    classifyMediaError(new Error("topology superseded")).cancellation,
    true,
  );
});

test("ordinary transport faults are not cancellation", () => {
  assert.equal(
    classifyMediaError(new Error("ICE connection failed")).cancellation,
    false,
  );
  assert.equal(classifyMediaError(undefined).cancellation, false);
});

test("transition identity separates providers at same epoch and revision", () => {
  const cloudflare = transitionIdentityKey({
    routeEpoch: 7,
    attemptId: "attempt-a",
    provider: "cloudflare-realtime",
    providerId: null,
    sourceRevision: 4,
  });
  const mediasoup = transitionIdentityKey({
    routeEpoch: 7,
    attemptId: "attempt-b",
    provider: "mediasoup",
    providerId: "sfu-1",
    sourceRevision: 4,
  });
  assert.notEqual(cloudflare, mediasoup);
});

test("transition identity changes when only the attempt changes", () => {
  const base = {
    routeEpoch: 7,
    attemptId: "attempt-a",
    provider: "mediasoup",
    providerId: null,
    sourceRevision: 4,
  };
  assert.notEqual(
    transitionIdentityKey(base),
    transitionIdentityKey({ ...base, attemptId: "attempt-c" }),
  );
});

test("provider incarnation keys keep two sfu sessions representable", () => {
  const active = providerIncarnationKey({
    provider: "cloudflare-realtime",
    providerId: null,
    providerSessionId: "session-A",
    attemptId: "attempt-1",
  });
  const staged = providerIncarnationKey({
    provider: "mediasoup",
    providerId: "sfu-1",
    providerSessionId: "session-B",
    attemptId: "attempt-2",
  });
  assert.notEqual(active, staged);
});

test("newer connection epoch wins over generation", () => {
  assert.equal(
    sourceIncarnationNewer(
      {
        participantId: "p",
        source: "camera",
        generation: 1,
        connectionEpoch: 5,
      },
      {
        participantId: "p",
        source: "camera",
        generation: 9,
        connectionEpoch: 4,
      },
    ),
    true,
  );
});

test("generation breaks ties inside one connection epoch", () => {
  const current = {
    participantId: "p",
    source: "camera",
    generation: 3,
    connectionEpoch: 5,
  };
  assert.equal(sourceIncarnationNewer({ ...current }, current), false);
  assert.equal(
    sourceIncarnationNewer({ ...current, generation: 4 }, current),
    true,
  );
});

test("first incarnation is always adopted", () => {
  assert.equal(
    sourceIncarnationNewer(
      {
        participantId: "p",
        source: "camera",
        generation: 0,
        connectionEpoch: 0,
      },
      null,
    ),
    true,
  );
});
