import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BrowserMediaEngine } from "../app/composables/media/browserMediaEngine.js";
import { NativeMediaEngine } from "../app/composables/media/nativeMediaEngine.js";

function createSession() {
  const calls = [];
  const session = {
    connect: async (channelId) => calls.push(["connect", channelId]),
    disconnect: async () => calls.push(["disconnect"]),
    startAudioProduction: async () => calls.push(["startAudio"]),
    stopAudioProduction: async () => calls.push(["stopAudio"]),
    startVideoProduction: async (source) => calls.push(["startVideo", source]),
    stopVideoProduction: async (source) => calls.push(["stopVideo", source]),
    startSystemAudioProduction: async () => calls.push(["startSystemAudio"]),
    stopSystemAudioProduction: async () => calls.push(["stopSystemAudio"]),
    getWebRTCStatsSnapshot: async () => ({ rttMs: 10, engine: "browser" }),
    mediaConnectionState: "connected",
  };
  return { calls, session };
}

describe("MediaEngine adapters", () => {
  it("BrowserMediaEngine delegates session operations without changing them", async () => {
    const { calls, session } = createSession();
    const engine = new BrowserMediaEngine(session);

    await engine.joinSession({ channelId: "channel-1" });
    await engine.setMicrophoneEnabled(true);
    await engine.setCameraEnabled(true);
    await engine.startScreenShare({ includeSystemAudio: true });
    await engine.stopScreenShare();
    await engine.leaveSession();

    assert.deepEqual(calls, [
      ["connect", "channel-1"],
      ["startAudio"],
      ["startVideo", "camera"],
      ["startSystemAudio"],
      ["startVideo", "screen"],
      ["stopVideo", "screen"],
      ["stopSystemAudio"],
      ["disconnect"],
    ]);
  });

  it("NativeMediaEngine delegates all capabilities when native RTC is disabled", async () => {
    const { calls, session } = createSession();
    const browser = new BrowserMediaEngine(session);
    const engine = new NativeMediaEngine({ browserEngine: browser });

    await engine.joinSession({ channelId: "channel-2" });
    await engine.setMicrophoneEnabled(false);
    await engine.stopScreenShare();

    assert.deepEqual(calls, [
      ["connect", "channel-2"],
      ["stopAudio"],
      ["stopVideo", "screen"],
      ["stopSystemAudio"],
    ]);
    assert.deepEqual(engine.getCapabilities(), {
      microphone: "browser",
      camera: "browser",
      screenVideo: "browser",
      screenAudio: "browser",
      p2p: "browser",
      sfu: "browser",
      receiveVideo: "browser",
      receiveAudio: "browser",
    });
  });

  it("NativeMediaEngine routes enabled native commands through Tauri", async () => {
    const { session } = createSession();
    const calls = [];
    const tauri = {
      invoke: async (command, payload) => {
        calls.push([command, payload]);
        if (command === "media_initialize") {
          return { capabilities: { nativeRtc: true, screenVideo: true } };
        }
        return command === "media_get_stats" ? { engine: "native" } : undefined;
      },
      listen: async () => () => {},
    };
    const engine = new NativeMediaEngine({
      browserEngine: new BrowserMediaEngine(session),
      flags: { nativeRtc: true, nativeScreenShare: true },
      tauri,
    });

    await engine.joinSession({ channelId: "channel-3" });
    await engine.startScreenShare({ includeSystemAudio: true });
    const stats = await engine.getStats();

    assert.equal(stats.engine, "native");
    assert.deepEqual(
      calls.map(([command]) => command),
      [
        "media_initialize",
        "media_join",
        "media_start_screen_share",
        "media_get_stats",
      ],
    );
  });

  it("NativeMediaEngine falls back when the native runtime reports no capabilities", async () => {
    const { calls, session } = createSession();
    const nativeCalls = [];
    const engine = new NativeMediaEngine({
      browserEngine: new BrowserMediaEngine(session),
      flags: { nativeRtc: true },
      tauri: {
        invoke: async (...args) => {
          nativeCalls.push(args);
          return args[0] === "media_initialize"
            ? { capabilities: {} }
            : undefined;
        },
        listen: async () => () => {},
      },
    });

    await engine.joinSession({ channelId: "channel-fallback" });

    assert.deepEqual(calls, [["connect", "channel-fallback"]]);
    assert.deepEqual(
      nativeCalls.map(([command]) => command),
      ["media_initialize"],
    );
  });

  it("NativeMediaEngine does not initialize or join native RTC without a native capability", async () => {
    const { calls, session } = createSession();
    const nativeCalls = [];
    const engine = new NativeMediaEngine({
      browserEngine: new BrowserMediaEngine(session),
      flags: { nativeRtc: true },
      tauri: {
        invoke: async (...args) => nativeCalls.push(args),
        listen: async () => () => {},
      },
    });

    await engine.joinSession({ channelId: "channel-4" });

    assert.deepEqual(calls, [["connect", "channel-4"]]);
    assert.deepEqual(nativeCalls, [["media_initialize", { config: {} }]]);
  });

  it("NativeMediaEngine falls back when a native capture command fails", async () => {
    const { calls, session } = createSession();
    const nativeCalls = [];
    const engine = new NativeMediaEngine({
      browserEngine: new BrowserMediaEngine(session),
      flags: {
        nativeRtc: true,
        nativeBackendReady: true,
        nativeScreenShare: true,
      },
      tauri: {
        invoke: async (...args) => {
          nativeCalls.push(args);
          if (args[0] === "media_initialize") {
            return { capabilities: { nativeRtc: true, screenVideo: true } };
          }
          throw new Error("native command failed");
        },
        listen: async () => () => {},
      },
    });

    await engine.startScreenShare({ sourceId: "display-1" });

    assert.deepEqual(calls, [["startVideo", "screen"]]);
    assert.deepEqual(
      nativeCalls.map(([command]) => command),
      ["media_start_screen_share"],
    );
  });
});
