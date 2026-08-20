import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer";

const executablePath =
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const temporaryRoot = await mkdtemp(join(tmpdir(), "dspeak-p2p-smoke-"));
const bundlePath = join(temporaryRoot, "p2p-smoke.js");
const browsers = [];
let webServer;

async function waitFor(label, predicate, pages, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await pumpSignals(pages);
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const states = await Promise.all(
    pages.map((page) => page.evaluate(() => window.mediaState())),
  );
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(states)}`);
}

async function pumpSignals([first, second]) {
  const firstSignals = await first.evaluate(() => window.takeSignals());
  const secondSignals = await second.evaluate(() => window.takeSignals());
  for (const message of firstSignals) {
    if (!message.signal) continue;
    await second.evaluate(
      (signal) => window.deliverSignal("peer-a", signal),
      message,
    );
  }
  for (const message of secondSignals) {
    if (!message.signal) continue;
    await first.evaluate(
      (signal) => window.deliverSignal("peer-b", signal),
      message,
    );
  }
}

async function setupPage(page, origin, peerId, remotePeerId) {
  await page.goto(origin);
  await page.addScriptTag({ path: bundlePath });
  await page.evaluate(
    ({ localId, otherId }) => {
      window.signals = [];
      window.remoteTracks = new Map();
      window.remoteEnded = [];
      window.failures = [];
      window.signalErrors = [];
      window.resources = [];
      window.mesh = new window.NativeP2pMesh({
        iceServers: [],
        sendSignal: (message) => {
          window.signals.push(message);
          return true;
        },
        onRemoteTrack: (entry) => {
          window.remoteTracks.set(entry.source, entry);
        },
        onRemoteTrackEnded: (entry) => {
          window.remoteTracks.delete(entry.source);
          window.remoteEnded.push(entry.source);
        },
        onFailure: (failure) => {
          window.failures.push({
            reason: failure.reason,
            message: failure.error?.message || null,
          });
        },
        onSnapshot: () => {},
        getAudioStereo: () => false,
        getSenderOptions: (source, track) =>
          track.kind === "audio"
            ? { encodings: [{ maxBitrate: 64000 }] }
            : {
                encodings: [{ maxBitrate: 1000000 }],
                degradationPreference: "maintain-framerate",
              },
      });
      window.mesh.applyTopology({
        mode: "p2p",
        epoch: 1,
        localPeerId: localId,
        peers: [
          { peerId: localId, userId: localId, sources: [] },
          { peerId: otherId, userId: otherId, sources: [] },
        ],
      });
      window.takeSignals = () =>
        JSON.parse(JSON.stringify(window.signals.splice(0)));
      window.deliverSignal = (fromPeerId, message) =>
        window.mesh
          .receiveSignal({
            fromPeerId,
            epoch: message.epoch,
            signal: message.signal,
          })
          .catch((error) =>
            window.signalErrors.push(error?.stack || String(error)),
          );
      window.publishVideo = async (source, color) => {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 360 },
            frameRate: { ideal: 30 },
          },
        });
        const track = stream.getVideoTracks()[0];
        window.resources.push({ stream, track, color });
        await window.mesh.publishSource(source, track, stream);
      };
      window.publishAudio = async (source, frequency) => {
        const context = new AudioContext();
        const oscillator = context.createOscillator();
        const destination = context.createMediaStreamDestination();
        oscillator.frequency.value = frequency;
        oscillator.connect(destination);
        oscillator.start();
        await context.resume();
        const stream = destination.stream;
        const track = stream.getAudioTracks()[0];
        window.resources.push({ context, oscillator, stream, track });
        await window.mesh.publishSource(source, track, stream);
      };
      window.unpublish = (source) => window.mesh.unpublishSource(source);
      window.mediaState = async () => {
        const outbound = {};
        for (const source of ["screen", "screen-audio", "camera", "audio"]) {
          const report = await window.mesh.getOutboundTrackStats(source);
          let bytes = 0;
          report?.forEach((stat) => {
            if (stat.type === "outbound-rtp" && !stat.isRemote)
              bytes += Number(stat.bytesSent) || 0;
          });
          outbound[source] = bytes;
        }
        const inbound = {};
        for (const [source, entry] of window.remoteTracks) {
          const report = await window.mesh.getInboundTrackStats(
            entry.peerId,
            entry.track,
          );
          let bytes = 0;
          report?.forEach((stat) => {
            if (stat.type === "inbound-rtp" && !stat.isRemote)
              bytes += Number(stat.bytesReceived) || 0;
          });
          inbound[source] = bytes;
        }
        return {
          outbound,
          inbound,
          remoteSources: [...window.remoteTracks.keys()],
          remoteEnded: [...window.remoteEnded],
          failures: [...window.failures],
          signalErrors: [...window.signalErrors],
          connectionStates: [...window.mesh.connections.values()].map(
            (state) => ({
              connection: state.pc.connectionState,
              ice: state.pc.iceConnectionState,
              signaling: state.pc.signalingState,
              makingOffer: state.makingOffer,
              negotiationRequested: state.negotiationRequested,
              signalingPhase: state.signalingPhase,
              signalingStep: state.signalingStep,
              senders: [...state.senders.keys()],
              transceivers: state.pc.getTransceivers().map((transceiver) => ({
                direction: transceiver.direction,
                currentDirection: transceiver.currentDirection,
                kind:
                  transceiver.sender.track?.kind ||
                  transceiver.receiver.track?.kind,
                mid: transceiver.mid,
              })),
            }),
          ),
        };
      };
      window.stopSmoke = async () => {
        window.mesh.closeAll();
        for (const resource of window.resources) {
          resource.track?.stop();
          resource.oscillator?.stop();
          await resource.context?.close();
        }
      };
    },
    { localId: peerId, otherId: remotePeerId },
  );
}

try {
  const build = await Bun.build({
    entrypoints: ["scripts/browser/p2p-smoke-entry.ts"],
    outdir: temporaryRoot,
    naming: "p2p-smoke.js",
    target: "browser",
  });
  if (!build.success)
    throw new Error(build.logs.map((entry) => entry.message).join("\n"));
  await readFile(bundlePath);
  webServer = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>dSpeak P2P smoke</title>");
  });
  await new Promise((resolve, reject) => {
    webServer.once("error", reject);
    webServer.listen(0, "127.0.0.1", resolve);
  });
  const address = webServer.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const launch = (profileName) =>
    puppeteer.launch({
      executablePath,
      headless: "shell",
      userDataDir: join(temporaryRoot, profileName),
      args: [
        "--autoplay-policy=no-user-gesture-required",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--no-default-browser-check",
        "--no-first-run",
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
      ],
    });
  browsers.push(await launch("profile-a"), await launch("profile-b"));
  const first = await browsers[0].newPage();
  const second = await browsers[1].newPage();
  const pages = [first, second];
  await setupPage(first, origin, "peer-a", "peer-b");
  await setupPage(second, origin, "peer-b", "peer-a");

  await second.evaluate(() => window.publishVideo("screen", "#264653"));
  await second.evaluate(() => window.publishAudio("screen-audio", 220));
  await waitFor(
    "screen and screen audio",
    async () => {
      const state = await first.evaluate(() => window.mediaState());
      return (
        state.remoteSources.includes("screen") &&
        state.remoteSources.includes("screen-audio")
      );
    },
    pages,
  );

  await first.evaluate(() => window.publishVideo("camera", "#9b2226"));
  await waitFor(
    "camera",
    async () => {
      const state = await second.evaluate(() => window.mediaState());
      return state.remoteSources.includes("camera");
    },
    pages,
  );

  await first.evaluate(() => window.publishAudio("audio", 440));
  await waitFor(
    "microphone",
    async () => {
      const state = await second.evaluate(() => window.mediaState());
      return state.remoteSources.includes("audio");
    },
    pages,
  );
  await waitFor(
    "fresh microphone RTP",
    async () => {
      const [sender, receiver] = await Promise.all([
        first.evaluate(() => window.mediaState()),
        second.evaluate(() => window.mediaState()),
      ]);
      return (
        sender.outbound.audio > 0 &&
        receiver.inbound.audio > 0 &&
        sender.connectionStates.every(
          (state) => state.signaling === "stable",
        ) &&
        receiver.connectionStates.every((state) => state.signaling === "stable")
      );
    },
    pages,
  );
  const before = await Promise.all(
    pages.map((page) => page.evaluate(() => window.mediaState())),
  );
  await new Promise((resolve) => setTimeout(resolve, 700));
  await pumpSignals(pages);
  const after = await Promise.all(
    pages.map((page) => page.evaluate(() => window.mediaState())),
  );

  assert.equal(after[0].failures.length, 0);
  assert.equal(after[1].failures.length, 0);
  assert.equal(after[0].signalErrors.length, 0);
  assert.equal(after[1].signalErrors.length, 0);
  assert.ok(
    after[0].inbound["screen-audio"] > before[0].inbound["screen-audio"],
  );
  assert.ok(after[1].inbound.audio > before[1].inbound.audio);
  assert.ok(after[0].outbound.audio > before[0].outbound.audio);
  assert.ok(after[0].remoteSources.includes("screen"));
  assert.ok(after[1].remoteSources.includes("camera"));
  for (const state of after.flatMap((entry) => entry.connectionStates)) {
    assert.equal(state.connection, "connected");
    assert.ok(["connected", "completed"].includes(state.ice));
    assert.equal(state.signaling, "stable");
    assert.ok(
      state.transceivers.some(
        (transceiver) =>
          transceiver.kind === "video" &&
          transceiver.currentDirection === "sendrecv",
      ),
    );
  }
  await first.evaluate(() => window.unpublish("camera"));
  await waitFor(
    "camera removal",
    async () => {
      const state = await second.evaluate(() => window.mediaState());
      return (
        !state.remoteSources.includes("camera") &&
        state.remoteEnded.includes("camera")
      );
    },
    pages,
  );
  await first.evaluate(() => window.publishVideo("camera", "#bb3e03"));
  await waitFor(
    "camera restoration",
    async () => {
      const state = await second.evaluate(() => window.mediaState());
      return state.remoteSources.includes("camera");
    },
    pages,
  );
  await first.evaluate(() => window.unpublish("audio"));
  await waitFor(
    "microphone removal",
    async () => {
      const state = await second.evaluate(() => window.mediaState());
      return (
        !state.remoteSources.includes("audio") &&
        state.remoteEnded.includes("audio")
      );
    },
    pages,
  );
  await first.evaluate(() => window.publishAudio("audio", 660));
  await waitFor(
    "microphone restoration",
    async () => {
      const state = await second.evaluate(() => window.mediaState());
      return state.remoteSources.includes("audio");
    },
    pages,
  );
  const restoredBefore = await second.evaluate(() => window.mediaState());
  await waitFor(
    "fresh restored microphone RTP",
    async () => {
      const restoredAfter = await second.evaluate(() => window.mediaState());
      return restoredAfter.inbound.audio > restoredBefore.inbound.audio;
    },
    pages,
  );
  const restoredAfter = await second.evaluate(() => window.mediaState());
  assert.equal(restoredAfter.failures.length, 0);
  assert.equal(restoredAfter.signalErrors.length, 0);
  console.log(
    JSON.stringify({
      status: "passed",
      microphone: {
        outboundBefore: before[0].outbound.audio,
        outboundAfter: after[0].outbound.audio,
        inboundBefore: before[1].inbound.audio,
        inboundAfter: after[1].inbound.audio,
      },
      screenAudio: {
        outboundBefore: before[1].outbound["screen-audio"],
        outboundAfter: after[1].outbound["screen-audio"],
        inboundBefore: before[0].inbound["screen-audio"],
        inboundAfter: after[0].inbound["screen-audio"],
      },
      remoteSources: after.map((entry) => entry.remoteSources),
      cameraRestored: true,
      restoredMicrophone: {
        inboundBefore: restoredBefore.inbound.audio,
        inboundAfter: restoredAfter.inbound.audio,
      },
      connections: after.flatMap((entry) => entry.connectionStates),
    }),
  );
  await Promise.all(
    pages.map((page) => page.evaluate(() => window.stopSmoke())),
  );
} finally {
  await Promise.all(browsers.map((candidate) => candidate.close()));
  await new Promise((resolve) => webServer?.close(resolve) || resolve());
  await rm(temporaryRoot, { recursive: true, force: true });
}
