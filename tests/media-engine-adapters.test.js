import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { BrowserMediaEngine } from "../app/composables/media/browserMediaEngine.js";
import { NativeMediaEngine } from "../app/composables/media/nativeMediaEngine.js";
import { useMediaEngine } from "../app/composables/media/useMediaEngine.js";

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
  it("selects Tauri before constructing the browser session", () => {
    let browserSessionConstructed = false;
    const sessionFactory = () => {
      browserSessionConstructed = true;
      return createSession().session;
    };

    const webEngine = useMediaEngine(sessionFactory, { isTauri: false });
    assert.equal(browserSessionConstructed, true);
    assert.ok(webEngine instanceof BrowserMediaEngine);

    browserSessionConstructed = false;
    const nativeEngine = useMediaEngine(sessionFactory, { isTauri: true });
    assert.equal(browserSessionConstructed, false);
    assert.ok(nativeEngine instanceof NativeMediaEngine);
  });

  it("does not probe browser microphone access before the Tauri factory", async () => {
    const voiceStore = await readFile("app/stores/voice.js", "utf8");
    const factoryImport = voiceStore.indexOf('"~/composables/useMediasoupSfu"');
    const permissionProbe = voiceStore.indexOf(
      "await ensureMicrophonePermission();",
    );

    assert.ok(factoryImport >= 0);
    assert.ok(permissionProbe > factoryImport);
    assert.match(
      voiceStore.slice(factoryImport, permissionProbe),
      /if \(!isTauriRuntime\(\)\) \{/,
    );
  });

  it("fails explicitly when native-only media has no native session", async () => {
    const engine = new NativeMediaEngine({
      flags: { nativeRtc: false },
      nativeOnly: true,
    });

    await assert.rejects(
      () => engine.connect("channel-native-boundary"),
      /Native WebRTC operation is unavailable: connect/,
    );
    assert.equal(engine.browserEngine instanceof BrowserMediaEngine, false);
  });

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
          return {
            capabilities: {
              nativeRtc: true,
              nativeBackendReady: true,
              screenVideo: true,
            },
          };
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

  it("NativeMediaEngine does not silently replace a source-aware failure with browser capture", async () => {
    const { calls, session } = createSession();
    const engine = new NativeMediaEngine({
      browserEngine: new BrowserMediaEngine(session),
      flags: {
        nativeRtc: true,
        nativeBackendReady: true,
        nativeScreenShare: true,
      },
      tauri: {
        invoke: async (command) => {
          if (command === "media_start_screen_share") {
            throw new Error(
              "unsupported: PipeWire portal capture is unavailable",
            );
          }
          return undefined;
        },
        listen: async () => () => {},
      },
    });

    await assert.rejects(
      () =>
        engine.startScreenShare({
          source: {
            sourceId: "display:one",
            sourceType: "display",
            sourceKey: "display:display:one",
          },
          sourceId: "display:one",
          sourceType: "display",
          sourceKey: "display:display:one",
          mode: "video",
        }),
      /unsupported: PipeWire portal capture is unavailable/,
    );
    assert.deepEqual(calls, []);
  });
});
