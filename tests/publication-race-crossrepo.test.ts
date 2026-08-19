import assert from "node:assert/strict";
import test from "node:test";
import { CloudflareRealtimeSession } from "../app/shared/cloudflare-realtime-session.ts";
import { createCloudflarePublicationRegistry } from "../app/shared/cloudflare-publication-registry.ts";
import { setupMediaMessageHandlers } from "../app/shared/media-message-handlers.ts";
import type { CloudflarePublication } from "../app/shared/types/cloudflare-media.ts";

function registry() {
  return createCloudflarePublicationRegistry();
}

function cloudflareSession() {
  const clientSession = new CloudflareRealtimeSession({
    send: () => true,
    iceServers: [],
    onRemoteTrack: () => {},
    onRemoteTrackEnded: () => {},
    onStateChange: () => {},
    getVideoSettings: () => ({}),
  });
  clientSession.sessionId = "cloudflare-session";
  clientSession.subscriptionsStarted = true;
  return clientSession;
}

interface PublicationRegistryHandle {
  update: (publication: Record<string, unknown>) => boolean;
  values: () => CloudflarePublication[];
  reconcileExact: (snapshot: CloudflarePublication[]) => {
    canonicalSnapshot: CloudflarePublication[];
    removed: CloudflarePublication[];
  };
}

interface ClientHandlers {
  queueCloudflarePublication: (publication: Record<string, unknown>) => boolean;
  lastAppliedPublicationRevision: { value: string };
  handlePublicationsDigest: (
    digest: unknown[],
    publicationRevision?: number | string | null,
  ) => Promise<unknown>;
}

function clientHandlers(reg: PublicationRegistryHandle): ClientHandlers {
  const queueCloudflarePublication = (publication: Record<string, unknown>) =>
    reg.update(publication);
  const lastApplied = { value: "0" };
  return {
    queueCloudflarePublication,
    lastAppliedPublicationRevision: lastApplied,
    handlePublicationsDigest: async (
      digest: unknown[],
      publicationRevision?: number | string | null,
    ) => {
      if (!Array.isArray(digest)) return;
      const serverPublications: CloudflarePublication[] = [];
      for (const entry of digest) {
        if (!entry || typeof entry !== "object") continue;
        serverPublications.push(entry as CloudflarePublication);
      }
      const envelopeRevision = publicationRevision
        ? String(publicationRevision)
        : "0";
      if (BigInt(envelopeRevision) < BigInt(lastApplied.value)) return;
      const { canonicalSnapshot, removed } =
        reg.reconcileExact(serverPublications);
      if (BigInt(envelopeRevision) > BigInt(lastApplied.value)) {
        lastApplied.value = envelopeRevision;
      }
      return { canonicalSnapshot, removed, lastApplied: lastApplied.value };
    },
  };
}

test("close push and delayed old heartbeat cannot resurrect a stopped publication through the real client path", async () => {
  const reg = registry();
  const clientSession = cloudflareSession();
  const handlers = clientHandlers(reg);
  const applied = [];

  const oldX = {
    peerId: "peer-1",
    source: "screen",
    trackName: "screen-X",
    generation: 8,
    connectionEpoch: 1,
    userId: "user-1",
    closed: false,
    publicationRevision: 40,
  };

  const digest40 = [oldX];
  handlers.queueCloudflarePublication(oldX);
  await handlers.handlePublicationsDigest(digest40, 40);
  assert.equal(reg.values().length, 1);

  let releaseSubscribeX;
  const gateX = new Promise((resolve) => {
    releaseSubscribeX = resolve;
  });
  const subscribeCalls = [];
  clientSession.subscribe = async (publication) => {
    const trackName = String(publication.trackName);
    subscribeCalls.push(trackName);
    clientSession.subscribedTrackNames.add(trackName);
    if (trackName === "screen-X") await gateX;
    return true;
  };

  const staleFence = () =>
    BigInt(40) < BigInt(handlers.lastAppliedPublicationRevision.value);
  const reconcilePromise = clientSession.reconcilePublications(
    reg.values(),
    [],
    staleFence,
    () => reg.values(),
  );

  const closeX = { ...oldX, closed: true, publicationRevision: 41 };
  handlers.queueCloudflarePublication(closeX);
  assert.equal(reg.values().length, 0);

  await handlers.handlePublicationsDigest([], 41);
  assert.equal(reg.values().length, 0);

  applied.push("close");

  releaseSubscribeX();
  await reconcilePromise;

  assert.equal(reg.values().length, 0);
  assert.equal(clientSession.publications.has("screen-X"), false);
  assert.equal(clientSession.subscribedTrackNames.has("screen-X"), false);
  assert.deepEqual(subscribeCalls, ["screen-X"]);
  assert.deepEqual(applied, ["close"]);
  clientSession.closeMedia();
});

test("replacement variant: blocked R40 converges to the newer publication Y, never X", async () => {
  const reg = registry();
  const clientSession = cloudflareSession();
  const handlers = clientHandlers(reg);

  const oldX = {
    peerId: "peer-1",
    source: "screen",
    trackName: "screen-X",
    generation: 8,
    connectionEpoch: 1,
    userId: "user-1",
    closed: false,
    publicationRevision: 40,
  };
  const newY = {
    peerId: "peer-1",
    source: "screen",
    trackName: "screen-Y",
    generation: 9,
    connectionEpoch: 1,
    userId: "user-1",
    closed: false,
    publicationRevision: 41,
  };

  handlers.queueCloudflarePublication(oldX);
  await handlers.handlePublicationsDigest([oldX], 40);
  assert.equal(reg.values().length, 1);
  assert.equal(reg.values()[0].trackName, "screen-X");

  let releaseSubscribeX;
  const gateX = new Promise((resolve) => {
    releaseSubscribeX = resolve;
  });
  const subscribeCalls = [];
  clientSession.subscribe = async (publication) => {
    const trackName = String(publication.trackName);
    subscribeCalls.push(trackName);
    clientSession.subscribedTrackNames.add(trackName);
    if (trackName === "screen-X") await gateX;
    return true;
  };

  handlers.queueCloudflarePublication(newY);
  await handlers.handlePublicationsDigest([newY], 41);
  assert.equal(reg.values().length, 1);
  assert.equal(reg.values()[0].trackName, "screen-Y");
  assert.equal(handlers.lastAppliedPublicationRevision.value, "41");

  const staleFence = () =>
    BigInt(40) < BigInt(handlers.lastAppliedPublicationRevision.value);
  const reconcilePromise = clientSession.reconcilePublications(
    [oldX],
    [],
    staleFence,
    () => reg.values(),
  );
  releaseSubscribeX();
  await reconcilePromise;

  const retained = reg.values();
  assert.equal(retained.length, 1);
  assert.equal(retained[0].trackName, "screen-Y");
  assert.equal(clientSession.publications.has("screen-X"), false);
  assert.equal(clientSession.publications.has("screen-Y"), true);
  assert.ok(subscribeCalls.includes("screen-X"));
  assert.ok(subscribeCalls.includes("screen-Y"));
  clientSession.closeMedia();
});

test("stale mid-subscribe convergence survives genuine R40→R41-blocked→R42 overtaking", async () => {
  const reg = registry();
  const clientSession = cloudflareSession();
  const handlers = clientHandlers(reg);

  const oldX = {
    peerId: "peer-1",
    source: "screen",
    trackName: "screen-X",
    generation: 8,
    connectionEpoch: 1,
    userId: "user-1",
    closed: false,
  };
  const newY = {
    peerId: "peer-1",
    source: "screen",
    trackName: "screen-Y",
    generation: 9,
    connectionEpoch: 1,
    userId: "user-1",
    closed: false,
  };
  const newZ = {
    peerId: "peer-1",
    source: "screen",
    trackName: "screen-Z",
    generation: 10,
    connectionEpoch: 1,
    userId: "user-1",
    closed: false,
  };

  let releaseSubscribeX: (() => void) | undefined;
  let releaseSubscribeY: (() => void) | undefined;
  const gateX = new Promise<void>((resolve) => {
    releaseSubscribeX = resolve;
  });
  const gateY = new Promise<void>((resolve) => {
    releaseSubscribeY = resolve;
  });
  const subscribeCalls: string[] = [];
  clientSession.subscribe = async (publication: { trackName?: unknown }) => {
    const trackName = String(publication.trackName);
    subscribeCalls.push(trackName);
    clientSession.subscribedTrackNames.add(trackName);
    if (trackName === "screen-X") await gateX;
    if (trackName === "screen-Y") await gateY;
    return true;
  };

  let stale = false;
  const reconcilePromise = clientSession.reconcilePublications(
    [oldX],
    [],
    () => stale,
    () => reg.values(),
    () => handlers.lastAppliedPublicationRevision.value,
  );

  handlers.queueCloudflarePublication(newY);
  await handlers.handlePublicationsDigest([newY], 41);
  stale = true;
  releaseSubscribeX?.();

  await new Promise((resolve) => setTimeout(resolve, 0));

  handlers.queueCloudflarePublication(newZ);
  await handlers.handlePublicationsDigest([newZ], 42);

  releaseSubscribeY?.();

  await reconcilePromise;

  assert.equal(clientSession.publications.has("screen-Z"), true);
  assert.equal(clientSession.publications.has("screen-X"), false);
  assert.equal(clientSession.publications.has("screen-Y"), false);
  assert.equal(clientSession.subscribedTrackNames.has("screen-Z"), true);
  assert.equal(clientSession.subscribedTrackNames.has("screen-X"), false);
  assert.equal(clientSession.subscribedTrackNames.has("screen-Y"), false);
  assert.ok(subscribeCalls.includes("screen-X"));
  assert.ok(subscribeCalls.includes("screen-Z"));
  clientSession.closeMedia();
});
