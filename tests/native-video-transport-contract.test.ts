import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const root = new URL("../", import.meta.url);

async function read(path: string) {
  return readFile(new URL(path, root), "utf8");
}

const workerServerSources = [
  "desktop/src-tauri/src/media_worker_server.rs",
  "desktop/src-tauri/src/media_worker_server/capture.rs",
  "desktop/src-tauri/src/media_worker_server/command.rs",
  "desktop/src-tauri/src/media_worker_server/core.rs",
  "desktop/src-tauri/src/media_worker_server/p2p.rs",
  "desktop/src-tauri/src/media_worker_server/protocol.rs",
  "desktop/src-tauri/src/media_worker_server/runtime.rs",
  "desktop/src-tauri/src/media_worker_server/sfu.rs",
  "desktop/src-tauri/src/media_worker_server/state.rs",
];

const workerClientSources = [
  "desktop/src-tauri/src/media/worker_client.rs",
  "desktop/src-tauri/src/media/worker_client/client.rs",
  "desktop/src-tauri/src/media/worker_client/connection.rs",
  "desktop/src-tauri/src/media/worker_client/diagnostics.rs",
  "desktop/src-tauri/src/media/worker_client/process.rs",
  "desktop/src-tauri/src/media/worker_client/routing.rs",
];

async function readSources(paths: string[]) {
  return (await Promise.all(paths.map((path) => read(path)))).join("\n");
}

async function readWorkerServer() {
  return readSources(workerServerSources);
}

async function readWorkerClient() {
  return readSources(workerClientSources);
}

describe("native video transport contract", () => {
  it("carries bounded RGBA frames through the receive event ABI", async () => {
    const header = await read(
      "desktop/native-media/libdspeak_media/include/lib_dspeak_media/lib_dspeak_media.h",
    );
    const render = await read(
      "desktop/native-media/libdspeak_media/src/internal/receive_render.cpp",
    );
    assert.match(header, /uint8_t\* data/);
    assert.match(header, /uint32_t data_len/);
    assert.match(render, /I420ToARGB/);
    assert.match(render, /packed_bgra/);
    assert.match(render, /rgba\[index\] = packed_bgra\[index \+ 2\]/);
    assert.doesNotMatch(render, /I420ToABGR/);
    assert.match(render, /has_pending_video_frame/);
    assert.match(render, /push_event\([\s\S]*rgba\.data\(\)/);
    assert.match(render, /"timestamp", frame\.timestamp_us\(\)/);
    assert.doesNotMatch(render, /video_surface::render/);
  });

  it("uses push events for control delivery instead of a JavaScript poll loop", async () => {
    const runtime = await read(
      "app/composables/media/native-media-engine-runtime.ts",
    );
    const common = await read(
      "app/composables/media/native-media-engine-common.ts",
    );
    const commands = await read("desktop/src-tauri/src/desktop/mod.rs");
    assert.doesNotMatch(runtime, /media_poll_(action|receive_event)/);
    assert.doesNotMatch(runtime, /media_p2p_poll_ice_candidate/);
    assert.doesNotMatch(commands, /media_poll_(action|receive_event)/);
    assert.doesNotMatch(commands, /media_p2p_poll_ice_candidate/);
    assert.match(common, /media:native-action/);
    assert.match(common, /media:native-receive-event/);
  });

  it("renders native frames inside the WebView layout", async () => {
    const feed = await read("app/components/VideoFeed.vue");
    const voiceChannel = await read("app/components/VoiceChannel.vue");
    const desktopWindow = await read("desktop/src-tauri/src/desktop/window.rs");
    const mediaState = await read("desktop/src-tauri/src/media/state.rs");
    const worker = await readWorkerServer();
    assert.match(feed, /<canvas/);
    assert.match(feed, /ImageData|atob\(/);
    assert.match(feed, /scheduleNativeFrame/);
    assert.doesNotMatch(feed, /media_video_surface|native-surface/);
    assert.doesNotMatch(
      voiceChannel,
      /native-surface|visibility-receiving-change/,
    );
    assert.doesNotMatch(
      desktopWindow,
      /WindowEvent::Moved|sync_video_surfaces/,
    );
    assert.doesNotMatch(mediaState, /video_surface/);
    assert.match(
      worker,
      /borrowed_native_bytes\(event\.data, event\.data_len\)/,
    );
    assert.doesNotMatch(worker, /lib_dspeak_media_video_surface/);
  });

  it("keeps native media in the on-demand worker without a surface window", async () => {
    const build = await read("desktop/src-tauri/build.rs");
    const workerClient = await readWorkerClient();
    const workerBuild = await read("scripts/build-desktop-worker.mjs");
    const devScript = await read("desktop/scripts/dev-desktop.sh");
    const cargo = await read("desktop/src-tauri/Cargo.toml");
    const config = await read("desktop/src-tauri/tauri.conf.json");
    assert.match(build, /NATIVE_MEDIA_WORKER_BUILD/);
    assert.match(build, /is_media_worker && with_mediasoup/);
    assert.match(workerClient, /dspeak-media-\{target\}/);
    assert.match(workerClient, /media_worker_invoke/);
    assert.doesNotMatch(
      workerClient,
      /media_worker_surface_invoke|video_surface/,
    );
    assert.match(cargo, /required-features = \["media-worker"\]/);
    assert.match(workerBuild, /"--features",\s*"media-worker"/);
    assert.match(workerBuild, /"--bin",\s*"dspeak-media"/);
    assert.match(devScript, /NATIVE_MEDIA_WORKER_BUILD=1 cargo/);
    assert.match(devScript, /--features media-worker/);
    assert.match(devScript, /--bin dspeak-media/);
    assert.match(config, /externalBin/);
  });

  it("reinitializes the worker before joining after a clean worker release", async () => {
    const workerClient = await readWorkerClient();
    assert.match(workerClient, /call_with_initialize/);
    assert.match(workerClient, /worker_command == "media_join"/);
    assert.match(workerClient, /connection\.send\("media_initialize"/);
    assert.match(workerClient, /ensure_connection/);
  });

  it("reinitializes the worker before source-aware capture starts after a probe release", async () => {
    const workerClient = await readWorkerClient();
    assert.match(workerClient, /let capture_start_command = matches!\(/);
    assert.match(workerClient, /"media_start_screen_share"/);
    assert.match(workerClient, /"media_start_system_audio"/);
    assert.match(
      workerClient,
      /worker_command == "media_join" \|\| capture_start_command/,
    );
    assert.match(workerClient, /call_with_initialize/);
  });

  it("owns receive-event strings exactly once and preserves logical P2P handles", async () => {
    const worker = await readWorkerServer();
    const header = await read(
      "desktop/native-media/libdspeak_media/include/lib_dspeak_media/lib_dspeak_media.h",
    );
    const peer = await read(
      "desktop/native-media/libdspeak_media/src/internal/peer_connection.cpp",
    );
    assert.match(worker, /borrowed_native_text\(event\.id\)/);
    assert.match(worker, /borrowed_native_json\(event\.payload_json\)/);
    assert.match(worker, /lib_dspeak_media_free_receive_event\(&mut event\)/);
    assert.match(header, /bool offerer,\s+uint64_t event_handle/);
    assert.match(worker, /p2p_create\(ice_servers\.as_ptr\(\), offerer, key\)/);
    assert.match(peer, /event_handle\.store\(event_handle/);
    assert.match(peer, /p2p_event_handle\(handle_\)/);
  });

  it("keeps the media worker alive for active-call device and capture probes", async () => {
    const worker = await readWorkerServer();
    const workerClient = await readWorkerClient();
    const settings = await read("app/pages/settings.vue");
    assert.match(
      worker,
      /command == "media_get_devices"[\s\S]*shutdown_after: false/,
    );
    assert.match(worker, /fn prepare_devices[\s\S]*shutdown_after: false/);
    assert.match(worker, /fn prepare_capture[\s\S]*shutdown_after: false/);
    assert.match(settings, /media_prepare_devices/);
    assert.match(settings, /media:native-receive-event/);
    assert.match(settings, /media_initialize/);
    assert.match(settings, /media_shutdown/);
    assert.doesNotMatch(settings, /media_get_audio_levels/);
    assert.match(workerClient, /media_initialize.*media_prepare_devices/);
    assert.match(workerClient, /call_existing\(&worker_app, &worker_command/);
    assert.match(workerClient, /native media worker is not running/);
  });

  it("shuts down a native worker when initialization fails", async () => {
    const session = await read(
      "app/composables/media/native-media-engine-session.ts",
    );
    assert.match(
      session,
      /if \(engine\.nativeOnly\) \{[\s\S]*media_shutdown[\s\S]*throw error;/,
    );
  });

  it("resets parent state when the native worker exits unexpectedly", async () => {
    const workerClient = await readWorkerClient();
    assert.match(workerClient, /NativeMediaState::default\(\)/);
    assert.match(workerClient, /MEDIA_EVENT_STATE/);
    assert.match(workerClient, /MEDIA_WORKER_EXITED/);
  });

  it("does not create a capture-track factory per source", async () => {
    const tracks = await read(
      "desktop/native-media/libdspeak_media/src/internal/native_tracks.cpp",
    );
    const runtime = await read(
      "desktop/native-media/libdspeak_media/src/internal/library_runtime.cpp",
    );
    assert.doesNotMatch(tracks, /CreatePeerConnectionFactory/);
    assert.match(tracks, /get_shared_track_factory/);
    assert.match(runtime, /get_shared_track_factory/);
    assert.match(runtime, /release_shared_track_factory/);
  });

  it("pushes native audio telemetry and keeps software AV1 out of low-spec policy", async () => {
    const audio = await read(
      "app/composables/media/native-media-engine-audio.ts",
    );
    const runtime = await read(
      "app/composables/media/native-media-engine-runtime.ts",
    );
    const codecs = await read(
      "desktop/native-media/libdspeak_media/src/internal/platform_video_codec_factories.cpp",
    );
    const diagnostics = await read(
      "desktop/native-media/libdspeak_media/src/internal/library_runtime.cpp",
    );
    assert.doesNotMatch(audio, /setInterval\(poll, 40\)/);
    assert.match(runtime, /handleNativeAudioTelemetry/);
    assert.match(codecs, /SoftwareDecoderFactory/);
    assert.doesNotMatch(codecs, /Dav1d|dav1d/);
    assert.doesNotMatch(diagnostics, /video_codec_entry\("AV1"/);
  });

  it("reports independent encode/decode capability matrices and conservative encoder limits", async () => {
    const diagnostics = await read(
      "desktop/native-media/libdspeak_media/src/internal/library_runtime.cpp",
    );
    const types = await read("desktop/src-tauri/src/media/types.rs");
    const signaling = await read("app/shared/native-mediasoup-signaling.ts");
    assert.match(diagnostics, /video_codec_capabilities/);
    assert.match(diagnostics, /\{"encode", runtime_codec_direction_entry/);
    assert.match(diagnostics, /\{"decode", runtime_codec_direction_entry/);
    assert.match(diagnostics, /"H264".*"H265".*"VP8".*"VP9".*"AV1"/s);
    assert.match(diagnostics, /maxHardwareSessions/);
    assert.match(diagnostics, /testedCodecPairs/);
    assert.match(diagnostics, /confidence/);
    assert.match(types, /video_codec_capabilities/);
    assert.match(types, /concurrent_encode/);
    assert.match(signaling, /mediaCapabilities: session\.mediaCapabilities/);
  });

  it("probes hardware profiles beyond the legacy 1080p30 ceiling", async () => {
    const codecs = await read(
      "desktop/native-media/libdspeak_media/src/internal/platform_video_codec_factories.cpp",
    );
    const runtime = await read(
      "desktop/native-media/libdspeak_media/src/internal/library_runtime.cpp",
    );
    const bridge = await read(
      "desktop/native-media/libdspeak_media/src/internal/p2p_track_bridge.cpp",
    );
    const videoToolbox = await read(
      "desktop/native-media/platform/macos/VideoToolboxCodecsMacos.mm",
    );
    const build = await read("desktop/src-tauri/build.rs");
    const workerInfo = await read("desktop/src-tauri/MediaWorkerInfo.plist");
    const peer = await read(
      "desktop/native-media/libdspeak_media/src/internal/peer_connection.cpp",
    );
    assert.match(codecs, /\{3840, 2160, 60\}/);
    assert.match(codecs, /max_probe_sessions = 4/);
    assert.match(codecs, /native_h264_format/);
    assert.match(codecs, /profile-level-id.*42e01f/);
    assert.match(runtime, /maximum-successfully-tested-profile/);
    assert.match(runtime, /"activeStream", nullptr/);
    assert.match(runtime, /"factoryProbe"/);
    assert.match(bridge, /SetCodecPreferences\(capabilities\)\.ok\(\)/);
    assert.match(bridge, /rtx_targets_primary_codec/);
    assert.match(bridge, /preference_changed/);
    assert.match(peer, /preferred_video_codecs_are_in_sdp/);
    assert.match(peer, /const auto& sdp = generated_sdp/);
    assert.match(codecs, /profile-level-id.*42e01f/);
    assert.doesNotMatch(
      peer,
      /apply_native_(opus_profile|h264_compatibility_profiles)/,
    );
    assert.doesNotMatch(peer, /profile-level-id=42e032/);
    assert.match(videoToolbox, /if \(next \+ 3 >= size\) next = size;/);
    assert.match(build, /rustc-link-arg-bin=dspeak-media=-Wl,-sectcreate/);
    assert.match(workerInfo, /NSCameraUsageDescription/);
  });

  it("hardens the macOS hardware encoder callback boundary", async () => {
    const videoToolbox = await read(
      "desktop/native-media/platform/macos/VideoToolboxCodecsMacos.mm",
    );
    assert.match(videoToolbox, /CMBlockBufferCopyDataBytes/);
    assert.match(videoToolbox, /pending_contexts_/);
    assert.match(videoToolbox, /mark_encode_returned/);
    assert.match(videoToolbox, /mark_callback_completed/);
    assert.match(videoToolbox, /catch \(\.\.\.\) \{\}/);
  });

  it("keeps native video migration metadata on one logical stream identity", async () => {
    const consumers = await read("app/shared/native-mediasoup-consumers.ts");
    const actions = await read("app/shared/native-mediasoup-actions.ts");
    const voiceChannel = await read("app/components/VoiceChannel.vue");
    assert.match(consumers, /logicalVideoStreamId/);
    assert.match(consumers, /NATIVE_CODEC_MIGRATION_REQUIRED_FRAMES/);
    assert.match(actions, /commitVideoMigration/);
    assert.match(actions, /presentableFrames/);
    assert.match(voiceChannel, /logicalStreamId \|\| feed\.key/);
  });

  it("does not build detached platform video surfaces", async () => {
    const cmake = await read(
      "desktop/native-media/libdspeak_media/CMakeLists.txt",
    );
    const library = await read(
      "desktop/native-media/libdspeak_media/src/internal/library_runtime.cpp",
    );
    assert.doesNotMatch(cmake, /VideoSurface|video_surface/);
    assert.doesNotMatch(library, /VideoSurface|video_surface/);
  });
});
