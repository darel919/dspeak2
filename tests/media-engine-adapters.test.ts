import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, describe, it } from "node:test";
import { BrowserMediaEngine } from "../app/composables/media/browserMediaEngine.ts";
import { NativeMediaEngine } from "../app/composables/media/nativeMediaEngine.ts";
import { handleNativeCaptureError } from "../app/composables/media/native-media-engine-session.ts";
import {
  resolveNativeMediaFlags,
  useMediaEngine,
} from "../app/composables/media/useMediaEngine.ts";

const activeEngines = new Set<{ shutdown: () => Promise<void> }>();

function trackEngine<T extends { shutdown: () => Promise<void> }>(engine: T) {
  activeEngines.add(engine);
  return engine;
}

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
  afterEach(async () => {
    await Promise.allSettled(
      [...activeEngines].map((engine) => engine.shutdown()),
    );
    activeEngines.clear();
  });

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

  it("derives native capability defaults from an explicit native runtime", () => {
    const flags = resolveNativeMediaFlags({ nativeRtc: true });
    assert.equal(flags.nativeRtc, true);
    assert.equal(flags.nativeSfu, true);
    assert.equal(flags.nativeMicrophone, true);
    assert.equal(flags.nativeAudioReceive, true);
  });

  it("uses push-driven native media events instead of a polling loop", async () => {
    const source = await readFile(
      "app/composables/media/native-media-engine-runtime.ts",
      "utf8",
    );
    assert.match(
      source,
      /dispatchNativeAction\(engine, payload as NativeCaptureRequest\)/,
    );
    assert.match(source, /engine\.nativeEventOperation/);
    assert.doesNotMatch(source, /media_poll_action/);
    assert.doesNotMatch(source, /media_poll_receive_event/);
    assert.doesNotMatch(source, /media_p2p_poll_ice_candidate/);
  });

  it("does not probe browser microphone access before the Tauri factory", async () => {
    const voiceActions = await readFile(
      "app/shared/voice-media-actions.ts",
      "utf8",
    );
    const factoryImport = voiceActions.indexOf(
      '"~/composables/useMediasoupSfu"',
    );
    const permissionProbe = voiceActions.indexOf(
      "await ensureMicrophonePermission();",
    );

    assert.ok(factoryImport >= 0);
    assert.ok(permissionProbe > factoryImport);
    assert.match(
      voiceActions.slice(factoryImport, permissionProbe),
      /if \(!isTauriRuntime\(\)\) \{/,
    );
  });

  it("fails explicitly when native-only media has no native session", async () => {
    const engine = trackEngine(
      new NativeMediaEngine({
        flags: { nativeRtc: false },
        nativeOnly: true,
      }),
    );

    await assert.rejects(
      () => engine.connect("channel-native-boundary"),
      /Native WebRTC operation is unavailable: connect/,
    );
    assert.equal(engine.browserEngine instanceof BrowserMediaEngine, false);
  });

  it("cleans up native capture and synchronizes microphone state after a runtime capture error", async () => {
    const removed = [];
    const invoked = [];
    const emitted = [];
    const voiceStore = {
      deafened: false,
      micMuted: false,
      getAuthenticatedUser: () => ({ id: "user-1" }),
      updateUserVoiceState: (userId, state) =>
        emitted.push(["voice-state", userId, state]),
    };
    const engine = {
      voiceStore,
      nativeSession: {
        sendParticipantVoiceState: (state) =>
          emitted.push(["participant-state", state]),
      },
      _emit: (...args) => emitted.push(args),
      _invoke: async (command, payload) => invoked.push([command, payload]),
      _removeNativeSource: async (source) => removed.push(source),
    };

    const failure = await handleNativeCaptureError(engine, {
      route: "microphone",
      errorCode: 17,
      message: "Input device stopped",
    });

    assert.equal(failure.code, "NATIVE_CAPTURE_RUNTIME_FAILED");
    assert.deepEqual(removed, ["audio"]);
    assert.deepEqual(invoked, [["media_set_microphone", { enabled: false }]]);
    assert.equal(voiceStore.micMuted, true);
    assert.deepEqual(emitted[0], [
      "voice-state",
      "user-1",
      { muted: true, deafened: false },
    ]);
    assert.deepEqual(emitted[1], [
      "participant-state",
      { muted: true, deafened: false },
    ]);
  });

  it("BrowserMediaEngine delegates session operations without changing them", async () => {
    const { calls, session } = createSession();
    const engine = trackEngine(new BrowserMediaEngine(session));

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
      ["startVideo", "screen"],
      ["stopVideo", "screen"],
      ["disconnect"],
    ]);
  });

  it("does not report a browser source as enabled when its session operation fails", async () => {
    const session = createSession().session;
    session.startAudioProduction = async () => {
      throw new Error("microphone unavailable");
    };
    session.startVideoProduction = async () => {
      throw new Error("camera unavailable");
    };
    const engine = new BrowserMediaEngine(session);

    await assert.rejects(
      () => engine.startAudioProduction(),
      /microphone unavailable/,
    );
    await assert.rejects(
      () => engine.startVideoProduction("camera"),
      /camera unavailable/,
    );
    assert.equal(engine.isMicrophoneEnabled(), false);
    assert.equal(engine.isCameraEnabled(), false);
    assert.equal(engine.isScreenSharing(), false);
  });

  it("NativeMediaEngine delegates all capabilities when native RTC is disabled", async () => {
    const { calls, session } = createSession();
    const browser = new BrowserMediaEngine(session);
    const engine = trackEngine(
      new NativeMediaEngine({ browserEngine: browser }),
    );

    await engine.joinSession({ channelId: "channel-2" });
    await engine.setMicrophoneEnabled(false);
    await engine.stopScreenShare();

    assert.deepEqual(calls, [
      ["connect", "channel-2"],
      ["stopAudio"],
      ["stopVideo", "screen"],
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

  it("returns an object topology graph for native SFU RTC snapshots", async () => {
    const engine = new NativeMediaEngine({
      flags: { nativeRtc: true, nativeBackendReady: true },
      nativeOnly: true,
    });
    engine.nativeSession = {
      localPeerId: "local",
      topologyState: {
        mode: "sfu",
        epoch: 7,
        localPeerId: "local",
        peers: [{ peerId: "local" }, { peerId: "peer" }],
      },
      stats: async () => [
        {
          id: "send",
          pcStates: { connectionState: "connected" },
          candidatePair: {
            remote: { address: "203.0.113.8" },
            local: { candidateType: "host", protocol: "udp" },
          },
          rttMs: 24,
          protocol: "udp",
          candidateType: "host",
        },
      ],
    } as never;

    const snapshot = (await engine.getWebRTCStatsSnapshot()) as {
      topology: Record<string, unknown>;
      nodes: Array<Record<string, unknown>>;
      edges: Array<Record<string, unknown>>;
    };

    assert.equal(snapshot.topology.mode, "sfu");
    assert.equal(snapshot.topology.label, "SFU (IPv4 fallback)");
    assert.equal(
      snapshot.nodes.some((node) => node.role === "sfu"),
      true,
    );
    assert.equal(snapshot.edges.length, 3);
  });

  it("returns an object topology graph for native P2P RTC snapshots", async () => {
    const engine = new NativeMediaEngine({
      flags: { nativeRtc: true, nativeBackendReady: true },
      nativeOnly: true,
    });
    engine.nativeProvider = "p2p";
    engine.nativeP2pSession = {
      mode: "p2p",
      epoch: 8,
      localPeerId: "local",
      peers: new Map([["peer", { peerId: "peer" }]]),
      stats: async () => [
        {
          id: "p2p:peer",
          kind: "p2p",
          routeId: "peer",
          peerOrProvider: "peer",
          pcStates: { connectionState: "connected" },
          candidatePair: {
            remote: { address: "192.0.2.8" },
            local: { candidateType: "host", protocol: "udp" },
          },
          rttMs: 12,
          protocol: "udp",
          candidateType: "host",
        },
      ],
    } as never;

    const snapshot = (await engine.getWebRTCStatsSnapshot()) as {
      topology: Record<string, unknown>;
      nodes: Array<Record<string, unknown>>;
      edges: Array<Record<string, unknown>>;
    };

    assert.equal(snapshot.topology.mode, "p2p-direct");
    assert.equal(snapshot.nodes.length, 2);
    assert.equal(snapshot.edges.length, 1);
  });

  it("NativeMediaEngine joins before live SFU health is proven", async () => {
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
    const engine = trackEngine(
      new NativeMediaEngine({
        browserEngine: new BrowserMediaEngine(createSession().session),
        flags: { nativeRtc: true, nativeScreenShare: true },
        tauri,
      }),
    );

    await engine.initialize();
    engine.nativeSession = {
      connect: async (channelId) => calls.push(["connect", channelId]),
    };
    await engine.joinSession({ channelId: "channel-3" });
    assert.deepEqual(calls, [
      ["media_initialize", { config: {} }],
      ["connect", "channel-3"],
      ["media_join", { channelId: "channel-3" }],
    ]);
  });

  it("marks the native worker connected through the normal connect path", async () => {
    const calls = [];
    const engine = trackEngine(
      new NativeMediaEngine({
        flags: { nativeRtc: true, nativeBackendReady: true },
        nativeOnly: true,
        tauri: {
          invoke: async (command, payload) => calls.push([command, payload]),
        },
      }),
    );
    engine.initialized = true;
    engine.nativeSession = {
      connect: async (channelId) => calls.push(["connect", channelId]),
    };
    engine._configureNativeIceServers = async () => {};
    engine._configureNativeControl = async () => {};

    await engine.connect("channel-connect");

    assert.deepEqual(calls, [
      ["connect", "channel-connect"],
      ["media_join", { channelId: "channel-connect" }],
    ]);
  });

  it("releases native voice state when native disconnect fails", async () => {
    const calls = [];
    const engine = new NativeMediaEngine({
      flags: { nativeRtc: true, nativeBackendReady: true },
      nativeOnly: true,
      tauri: {
        invoke: async (command) => calls.push(command),
      },
    });
    engine.initialized = true;
    engine.nativeSession = {
      disconnect: async () => {
        throw new Error("disconnect failed");
      },
    };

    await engine.leaveSession();

    assert.deepEqual(calls, ["media_leave", "media_shutdown"]);
  });

  it("NativeMediaEngine attempts microphone capture before callback health is proven", async () => {
    const calls = [];
    const engine = trackEngine(
      new NativeMediaEngine({
        flags: { nativeRtc: true, nativeBackendReady: true },
        nativeOnly: true,
        tauri: {
          invoke: async (command) => {
            calls.push(command);
            return undefined;
          },
        },
      }),
    );
    engine.nativeSession = {
      addSource: async () => {},
      removeSource: () => {},
    };
    engine.nativeP2pSession = {
      addSource: async () => {},
      removeSource: async () => {},
    };

    await engine.startAudioProduction();
    assert.deepEqual(calls, ["media_set_microphone"]);
  });

  it("keeps native capture health flags fail-closed before callback health is proven", () => {
    const engine = new NativeMediaEngine({ nativeOnly: true });

    engine._mergeNativeCapabilities({
      nativeRtc: true,
      nativeBackendReady: true,
      capture: {
        camera: { available: false, sources: [{ sourceId: "camera-1" }] },
        screenCaptureKit: {
          available: false,
          sources: [{ sourceId: "display-1" }],
        },
      },
    });

    assert.equal(engine.flags.nativeBackendReady, true);
    assert.equal(engine.flags.nativeCamera, false);
    assert.equal(engine.flags.nativeScreenShare, false);
  });

  it("NativeMediaEngine attempts camera capture before callback health is proven", async () => {
    const calls = [];
    const engine = trackEngine(
      new NativeMediaEngine({
        flags: { nativeRtc: true, nativeBackendReady: true },
        nativeOnly: true,
        tauri: {
          invoke: async (command) => calls.push(command),
        },
      }),
    );
    engine.nativeSession = {
      addSource: async (entry) => calls.push(["sfu-add", entry.source]),
      removeSource: async () => {},
    };

    await engine.startVideoProduction("camera");

    assert.deepEqual(calls, ["media_set_camera", ["sfu-add", "camera"]]);
  });

  it("NativeMediaEngine starts source-selected screen capture before callback health is proven", async () => {
    const calls = [];
    const selection = {
      source: {
        sourceId: "display-1",
        sourceType: "display",
        sourceKey: "display:display-1",
      },
      sourceId: "display-1",
      sourceType: "display",
      sourceKey: "display:display-1",
      mode: "video",
      excludeSelf: true,
      excludeSelfAudio: true,
      video: {
        resolution: "original",
        frameRate: 60,
        qualityPriority: "framerate",
      },
      audio: {
        channels: 2,
        sampleRate: 48000,
        stereo: true,
        excludeSelfAudio: true,
      },
    };
    const engine = trackEngine(
      new NativeMediaEngine({
        flags: { nativeRtc: true, nativeBackendReady: true },
        nativeOnly: true,
        tauri: {
          invoke: async (command) => calls.push(command),
        },
      }),
    );
    engine.nativeSession = {
      addSource: async (entry) => calls.push(["sfu-add", entry.source]),
      removeSource: async (source) => calls.push(["sfu-remove", source]),
    };

    await engine.startVideoProduction("screen", {
      captureSelection: selection,
    });
    await engine.stopVideoProduction("screen");

    assert.deepEqual(calls, [
      "media_start_screen_share",
      ["sfu-add", "screen"],
      ["sfu-remove", "screen"],
      "media_stop_screen_share",
    ]);
  });

  it("publishes native local video feeds through a reactive ref", () => {
    const engine = new NativeMediaEngine({
      flags: { nativeRtc: true },
      nativeOnly: true,
    });
    engine.nativeSession = {
      localVideoFeeds: new Map([
        ["camera", { source: "camera", native: true, frame: null }],
      ]),
    };

    engine._syncLocalFeeds();

    assert.equal(engine.localVideoFeeds.value.get("camera").source, "camera");
    assert.notEqual(
      engine.localVideoFeeds.value,
      engine.nativeSession.localVideoFeeds,
    );
  });

  it("rebuilds native local video feeds from active sources", () => {
    const engine = new NativeMediaEngine({
      flags: { nativeRtc: true },
      nativeOnly: true,
    });
    engine.nativeSession = {
      localVideoFeeds: new Map(),
      sources: new Map([["camera", { source: "camera", kind: "video" }]]),
    };

    engine._syncLocalFeeds();

    assert.deepEqual(engine.localVideoFeeds.value.get("camera"), {
      source: "camera",
      producerId: "local:camera",
      native: true,
      surfaceId: "local:camera",
      frame: null,
    });
  });

  it("detaches native microphone and camera tracks before stopping capture", async () => {
    const calls = [];
    const engine = new NativeMediaEngine({
      flags: {
        nativeRtc: true,
        nativeBackendReady: true,
        nativeMicrophone: true,
        nativeCamera: true,
      },
      nativeOnly: true,
      tauri: {
        invoke: async (command) => calls.push(command),
      },
    });
    engine.nativeSession = {
      addSource: async () => {},
      removeSource: async (source) => calls.push(["sfu-remove", source]),
    };
    engine.nativeP2pSession = {
      addSource: async () => {},
      removeSource: async (source) => calls.push(["p2p-remove", source]),
    };

    await engine.setMicrophoneEnabled(false);
    await engine.setCameraEnabled(false);

    assert.deepEqual(calls, [
      ["sfu-remove", "audio"],
      ["p2p-remove", "audio"],
      "media_set_microphone",
      ["sfu-remove", "camera"],
      ["p2p-remove", "camera"],
      "media_set_camera",
    ]);
  });

  it("rolls back native microphone capture when source publication fails", async () => {
    const calls = [];
    const engine = new NativeMediaEngine({
      flags: {
        nativeRtc: true,
        nativeBackendReady: true,
        nativeMicrophone: true,
      },
      nativeOnly: true,
      tauri: {
        invoke: async (command) => calls.push(command),
      },
    });
    engine.nativeSession = {
      addSource: async () => {
        throw new Error("microphone publication failed");
      },
      removeSource: async (source) => calls.push(["sfu-remove", source]),
    };
    engine.nativeP2pSession = {
      removeSource: async (source) => calls.push(["p2p-remove", source]),
    };

    await assert.rejects(
      () => engine.setMicrophoneEnabled(true),
      /microphone publication failed/,
    );
    assert.deepEqual(calls, [
      "media_set_microphone",
      ["sfu-remove", "audio"],
      ["p2p-remove", "audio"],
      "media_set_microphone",
    ]);
  });

  it("rolls back native camera capture when source publication fails", async () => {
    const calls = [];
    const engine = new NativeMediaEngine({
      flags: {
        nativeRtc: true,
        nativeBackendReady: true,
        nativeCamera: true,
      },
      nativeOnly: true,
      tauri: {
        invoke: async (command) => calls.push(command),
      },
    });
    engine.nativeSession = {
      addSource: async () => {
        throw new Error("camera publication failed");
      },
      removeSource: async (source) => calls.push(["sfu-remove", source]),
    };
    engine.nativeP2pSession = {
      removeSource: async (source) => calls.push(["p2p-remove", source]),
    };

    await assert.rejects(
      () => engine.setCameraEnabled(true),
      /camera publication failed/,
    );
    assert.deepEqual(calls, [
      "media_set_camera",
      ["sfu-remove", "camera"],
      ["p2p-remove", "camera"],
      "media_set_camera",
    ]);
  });

  it("does not let native system audio reuse combined screen audio", async () => {
    const engine = new NativeMediaEngine({
      flags: {
        nativeRtc: true,
        nativeBackendReady: true,
        nativeScreenAudio: true,
      },
      nativeOnly: true,
      tauri: {
        invoke: async () => {
          throw new Error("capture must not start");
        },
      },
    });
    engine.activeScreenCapture = { mode: "both" };
    engine.activeSystemAudioCapture = {
      mode: "both",
      combinedWithScreen: true,
    };

    await assert.rejects(
      () => engine.startSystemAudioProduction(),
      (error) => error?.code === "DESKTOP_CAPTURE_SOURCE_CONFLICT",
    );
  });

  it("does not start native screen video over standalone system audio", async () => {
    const calls = [];
    const engine = new NativeMediaEngine({
      flags: {
        nativeRtc: true,
        nativeBackendReady: true,
        nativeScreenShare: true,
      },
      nativeOnly: true,
      tauri: {
        invoke: async (command) => calls.push(command),
      },
    });
    engine.activeSystemAudioCapture = { source: { sourceId: "audio-1" } };

    await assert.rejects(
      () => engine.startScreenShare(),
      (error) => error?.code === "DESKTOP_CAPTURE_SOURCE_CONFLICT",
    );
    assert.deepEqual(calls, []);
  });

  it("NativeMediaEngine keeps screen video and system audio in parity", async () => {
    const calls = [];
    const nativeSession = {
      async addSource(entry) {
        calls.push(["sfu-add", entry.source]);
      },
      removeSource(source) {
        calls.push(["sfu-remove", source]);
      },
    };
    const nativeP2pSession = {
      async addSource(entry) {
        calls.push(["p2p-add", entry.source]);
      },
      async removeSource(source) {
        calls.push(["p2p-remove", source]);
      },
    };
    const engine = trackEngine(
      new NativeMediaEngine({
        flags: {
          nativeRtc: true,
          nativeBackendReady: true,
          nativeScreenShare: true,
          nativeScreenAudio: true,
        },
        nativeOnly: true,
        tauri: {
          invoke: async (command) => {
            calls.push(command);
            return {};
          },
        },
      }),
    );
    engine.nativeSession = nativeSession;
    engine.nativeP2pSession = nativeP2pSession;

    await engine.startScreenShare({ includeSystemAudio: true });
    await engine.stopScreenShare();

    assert.deepEqual(calls, [
      "media_start_system_audio",
      ["sfu-add", "screen-audio"],
      ["p2p-add", "screen-audio"],
      "media_set_shared_audio_volume",
      "media_start_screen_share",
      ["sfu-add", "screen"],
      ["p2p-add", "screen"],
      ["sfu-remove", "screen"],
      ["p2p-remove", "screen"],
      "media_stop_screen_share",
      ["sfu-remove", "screen-audio"],
      ["p2p-remove", "screen-audio"],
      "media_stop_system_audio",
    ]);
  });

  it("publishes both tracks from one native combined capture", async () => {
    const calls = [];
    const selection = {
      source: {
        sourceId: "display-1",
        sourceType: "display",
        sourceKey: "display:display-1",
      },
      sourceId: "display-1",
      sourceType: "display",
      sourceKey: "display:display-1",
      mode: "both",
      excludeSelf: true,
      video: {
        resolution: "original",
        frameRate: 60,
        qualityPriority: "framerate",
      },
      audio: {
        channels: 2,
        sampleRate: 48000,
        stereo: true,
        excludeSelfAudio: true,
      },
      excludeSelfAudio: true,
    };
    const engine = trackEngine(
      new NativeMediaEngine({
        flags: {
          nativeRtc: true,
          nativeBackendReady: true,
          nativeScreenShare: true,
          nativeScreenAudio: true,
        },
        nativeOnly: true,
        tauri: {
          invoke: async (command) => {
            calls.push(command);
            return {};
          },
        },
      }),
    );
    engine.nativeSession = {
      addSource: async (entry) => calls.push(["sfu-add", entry.source]),
      removeSource: (source) => calls.push(["sfu-remove", source]),
    };
    engine.nativeP2pSession = {
      addSource: async (entry) => calls.push(["p2p-add", entry.source]),
      removeSource: async (source) => calls.push(["p2p-remove", source]),
    };

    await engine.startScreenShare({ captureSelection: selection });
    await engine.stopScreenShare();

    assert.deepEqual(calls, [
      "media_start_screen_share",
      ["sfu-add", "screen"],
      ["p2p-add", "screen"],
      ["sfu-add", "screen-audio"],
      ["p2p-add", "screen-audio"],
      "media_set_shared_audio_volume",
      ["sfu-remove", "screen"],
      ["p2p-remove", "screen"],
      ["sfu-remove", "screen-audio"],
      ["p2p-remove", "screen-audio"],
      "media_stop_screen_share",
      "media_stop_system_audio",
    ]);
  });

  it("passes the validated system audio identity to the native command", async () => {
    const calls = [];
    const selection = {
      source: {
        sourceId: "macos:system-audio",
        sourceType: "system-audio",
        sourceKey: "system-audio:macos:system-audio",
      },
      sourceId: "macos:system-audio",
      sourceType: "system-audio",
      sourceKey: "system-audio:macos:system-audio",
      mode: "audio",
      excludeSelf: true,
      video: {
        resolution: "original",
        frameRate: 60,
        qualityPriority: "framerate",
      },
      audio: {
        channels: 2,
        sampleRate: 48000,
        stereo: true,
        excludeSelfAudio: true,
      },
      excludeSelfAudio: true,
    };
    const engine = trackEngine(
      new NativeMediaEngine({
        flags: {
          nativeRtc: true,
          nativeBackendReady: true,
          nativeScreenAudio: true,
        },
        nativeOnly: true,
        tauri: {
          invoke: async (command, payload) => {
            calls.push([command, payload]);
            return {};
          },
        },
      }),
    );
    engine.nativeSession = {
      addSource: async () => null,
      removeSource: async () => {},
    };
    engine.nativeP2pSession = {
      addSource: async () => null,
      removeSource: async () => {},
    };

    await engine.startSystemAudioProduction({
      captureSelection: selection,
      roomBitrateBps: 128000,
    });

    assert.equal(calls[0][0], "media_start_system_audio");
    assert.deepEqual(
      calls[0][1].request.captureSelection.source,
      selection.source,
    );
    assert.equal(
      calls[0][1].request.captureSelection.sourceId,
      selection.sourceId,
    );
    assert.equal(
      calls[0][1].request.captureSelection.sourceType,
      selection.sourceType,
    );
    assert.equal(
      calls[0][1].request.captureSelection.sourceKey,
      selection.sourceKey,
    );
    assert.equal(calls[0][1].request.captureSelection.mode, "audio");
    assert.equal(
      calls[0][1].request.captureSelection.audio.maxBitrateBps,
      128000,
    );

    await engine.stopSystemAudioProduction();
  });

  it("reports native source state and removes stopped native sources", async () => {
    const nativeCalls = [];
    const nativeSession = {
      sources: new Map([
        ["audio", { source: "audio" }],
        ["screen", { source: "screen" }],
      ]),
      getState: () => "ready",
      removeSource(source) {
        this.sources.delete(source);
      },
    };
    const nativeP2pSession = {
      sources: new Map([
        ["audio", { source: "audio" }],
        ["screen", { source: "screen" }],
      ]),
      async removeSource(source) {
        this.sources.delete(source);
      },
    };
    const engine = new NativeMediaEngine({
      flags: {
        nativeRtc: true,
        nativeBackendReady: true,
        nativeScreenShare: true,
        nativeScreenAudio: true,
      },
      nativeOnly: true,
      tauri: {
        invoke: async (command) => {
          nativeCalls.push(command);
        },
      },
    });
    engine.nativeSession = nativeSession;
    engine.nativeP2pSession = nativeP2pSession;

    assert.equal(engine.getState(), "ready");
    assert.equal(engine.isMicrophoneEnabled(), true);
    assert.equal(engine.isScreenSharing(), true);
    await engine.stopScreenShare();
    assert.equal(engine.isScreenSharing(), false);

    nativeSession.sources.set("screen-audio", { source: "screen-audio" });
    nativeP2pSession.sources.set("screen-audio", { source: "screen-audio" });
    await engine.stopSystemAudioProduction();
    assert.equal(nativeSession.sources.has("screen-audio"), false);
    assert.equal(nativeP2pSession.sources.has("screen-audio"), false);
    assert.deepEqual(nativeCalls, [
      "media_stop_screen_share",
      "media_stop_system_audio",
    ]);
  });

  it("NativeMediaEngine falls back when the native runtime reports no capabilities", async () => {
    const { calls, session } = createSession();
    const nativeCalls = [];
    const engine = trackEngine(
      new NativeMediaEngine({
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
      }),
    );

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
    const engine = trackEngine(
      new NativeMediaEngine({
        browserEngine: new BrowserMediaEngine(session),
        flags: { nativeRtc: true },
        tauri: {
          invoke: async (...args) => nativeCalls.push(args),
          listen: async () => () => {},
        },
      }),
    );

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
