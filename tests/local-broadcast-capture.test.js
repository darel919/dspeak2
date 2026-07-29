import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LocalBroadcastCapture } from "../app/shared/local-broadcast-capture.js";

describe("LocalBroadcastCapture", () => {
  it("class exists and has required methods", () => {
    assert.ok(typeof LocalBroadcastCapture === "function");
    assert.ok(typeof LocalBroadcastCapture.prototype.start === "function");
    assert.ok(typeof LocalBroadcastCapture.prototype.stop === "function");
    assert.ok(typeof LocalBroadcastCapture.prototype.getState === "function");
  });

  it("starts with stopped state", () => {
    const capture = new LocalBroadcastCapture({
      createAudioContext: () => ({ state: "suspended", close: () => {} }),
      createMediaElement: () => ({
        addEventListener: () => {},
        removeEventListener: () => {},
        load: () => {},
        play: () => Promise.resolve(),
        pause: () => {},
      }),
      onStateChange: () => {},
    });
    assert.equal(capture.getState(), "stopped");
  });

  it("throws if started twice", async () => {
    const mockElem = {
      addEventListener: (type, handler) => {
        if (type === "canplay") setTimeout(handler, 10);
      },
      load: () => {},
      play: () => Promise.resolve(),
      pause: () => {},
      removeAttribute: () => {},
      set crossOrigin(val) {},
      set preload(val) {},
      set src(val) {},
      get src() {
        return "";
      },
      error: null,
    };
    const capture = new LocalBroadcastCapture({
      createAudioContext: () => ({
        state: "suspended",
        resume: () => Promise.resolve(),
        close: () => {},
        createMediaElementSource: () => ({ connect: () => {} }),
        createMediaStreamDestination: () => ({
          stream: {
            getAudioTracks: () => [
              {
                contentHint: "",
                readyState: "live",
                stop: () => {},
                addEventListener: () => {},
                removeEventListener: () => {},
              },
            ],
          },
          disconnect: () => {},
        }),
      }),
      createMediaElement: () => mockElem,
      onStateChange: () => {},
    });
    await capture.start({ url: "http://localhost:19350/stream.ogg" });
    await assert.rejects(
      () => capture.start({ url: "http://localhost:19350/stream.ogg" }),
      /already started/,
    );
    await capture.stop();
  });
});

describe("LocalBroadcastCapture stop cleanup", () => {
  it("stop disconnects nodes, closes audio context, and resets state", async () => {
    let audioContextClosed = false;
    let audioContextSuspended = false;
    let mediaElementLoaded = false;
    let mediaElementPaused = false;
    let mediaElementSrcRemoved = false;

    const capture = new LocalBroadcastCapture({
      createAudioContext: () => ({
        state: "running",
        resume: () => Promise.resolve(),
        close: () => {
          audioContextClosed = true;
          return Promise.resolve();
        },
        suspend: () => {
          audioContextSuspended = true;
          return Promise.resolve();
        },
        createMediaElementSource: () => ({
          connect: () => {},
          disconnect: () => {},
        }),
        createMediaStreamDestination: () => ({
          stream: {
            getAudioTracks: () => [
              {
                contentHint: "",
                readyState: "live",
                stop: () => {},
                addEventListener: () => {},
                removeEventListener: () => {},
              },
            ],
          },
          disconnect: () => {},
        }),
      }),
      createMediaElement: () => ({
        addEventListener: (type, handler) => {
          if (type === "canplay") setTimeout(handler, 10);
        },
        removeEventListener: () => {},
        load: () => {
          mediaElementLoaded = true;
        },
        play: () => Promise.resolve(),
        pause: () => {
          mediaElementPaused = true;
        },
        removeAttribute: (attr) => {
          if (attr === "src") mediaElementSrcRemoved = true;
        },
        src: "",
      }),
      onStateChange: () => {},
    });

    await capture.start({ url: "http://localhost:19350/stream.ogg" });
    await capture.stop();

    assert.ok(audioContextClosed, "AudioContext should be closed");
    assert.ok(mediaElementPaused, "Audio element should be paused");
    assert.ok(mediaElementSrcRemoved, "Audio element src should be cleared");
    assert.equal(capture.getState(), "stopped");
  });
});

describe("Broadcast contract (integration)", () => {
  it("broadcast-capture.js does not call getDisplayMedia", () => {
    const source = readFileSync(
      "app/shared/local-broadcast-capture.js",
      "utf-8",
    );
    assert.ok(
      !source.includes("getDisplayMedia"),
      "Must not call getDisplayMedia",
    );
  });

  it("media-source-controller.js handles broadcast-audio source", () => {
    const source = readFileSync(
      "app/shared/media-source-controller.js",
      "utf-8",
    );
    assert.ok(
      source.includes("broadcast-audio"),
      "Must handle broadcast-audio",
    );
  });

  it("useHybridMediaSession initializes shared audio before source control", () => {
    const source = readFileSync(
      "app/composables/useHybridMediaSession.js",
      "utf-8",
    );
    const initialization = source.indexOf("= createLocalAudioEngine({");
    const controller = source.indexOf(
      "sourceController = createMediaSourceController({",
    );
    assert.ok(initialization >= 0, "Must initialize the local audio engine");
    assert.ok(
      initialization < controller,
      "Must initialize shared audio before creating source control",
    );
  });

  it("useHybridMediaSession.js exposes start/stop broadcast", () => {
    const source = readFileSync(
      "app/composables/useHybridMediaSession.js",
      "utf-8",
    );
    assert.ok(
      source.includes("startBroadcastProduction"),
      "Must expose startBroadcastProduction",
    );
    assert.ok(
      source.includes("stopBroadcastProduction"),
      "Must expose stopBroadcastProduction",
    );
  });
});
