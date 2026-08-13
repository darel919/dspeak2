import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const root = new URL("../", import.meta.url);

async function read(path: string) {
  return readFile(new URL(path, root), "utf8");
}

describe("native video transport contract", () => {
  it("keeps live video pixels out of the receive event ABI", async () => {
    const header = await read(
      "desktop/native-media/libdspeak_media/include/lib_dspeak_media/lib_dspeak_media.h",
    );
    const render = await read(
      "desktop/native-media/libdspeak_media/src/internal/receive_render.cpp",
    );
    assert.doesNotMatch(header, /data_len|uint8_t\* data/);
    assert.doesNotMatch(render, /I420ToRGBA/);
    assert.match(render, /video_surface::render/);
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

  it("positions native surfaces from the shared Nuxt layout", async () => {
    const feed = await read("app/components/VideoFeed.vue");
    const voiceChannel = await read("app/components/VoiceChannel.vue");
    const surface = await read("desktop/src-tauri/src/media/video_surface.rs");
    const worker = await read("desktop/src-tauri/src/media_worker_server.rs");
    assert.doesNotMatch(feed, /<canvas/);
    assert.doesNotMatch(feed, /ImageData|atob\(/);
    assert.match(feed, /media_video_surface_set_bounds/);
    assert.match(feed, /media_video_surface_destroy/);
    assert.match(feed, /visibility-receiving-change/);
    assert.match(feed, /updateNativeReceivingVisibility/);
    assert.match(voiceChannel, /setVideoReceiving\(tile\.feed, \$event\)/);
    assert.match(surface, /inner_position/);
    assert.match(surface, /scale_factor/);
    assert.doesNotMatch(surface, /RawWindowHandle/);
    assert.match(worker, /lib_dspeak_media_video_surface_set_bounds/);
  });

  it("keeps native media and native surfaces in the on-demand worker", async () => {
    const build = await read("desktop/src-tauri/build.rs");
    const workerClient = await read(
      "desktop/src-tauri/src/media/worker_client.rs",
    );
    const surface = await read("desktop/src-tauri/src/media/video_surface.rs");
    const workerBuild = await read("scripts/build-desktop-worker.mjs");
    const devScript = await read("desktop/scripts/dev-desktop.sh");
    const cargo = await read("desktop/src-tauri/Cargo.toml");
    const config = await read("desktop/src-tauri/tauri.conf.json");
    assert.match(build, /NATIVE_MEDIA_WORKER_BUILD/);
    assert.match(build, /is_media_worker && with_mediasoup/);
    assert.match(workerClient, /dspeak-media-\{target\}/);
    assert.match(workerClient, /media_worker_invoke/);
    assert.match(workerClient, /media_worker_surface_invoke/);
    assert.match(surface, /media_worker_surface_invoke/);
    assert.match(cargo, /required-features = \["media-worker"\]/);
    assert.match(workerBuild, /"--features",\s*"media-worker"/);
    assert.match(workerBuild, /"--bin",\s*"dspeak-media"/);
    assert.match(devScript, /NATIVE_MEDIA_WORKER_BUILD=1 cargo/);
    assert.match(devScript, /--features media-worker/);
    assert.match(devScript, /--bin dspeak-media/);
    assert.match(config, /externalBin/);
  });

  it("reinitializes the worker before joining after a clean worker release", async () => {
    const workerClient = await read(
      "desktop/src-tauri/src/media/worker_client.rs",
    );
    assert.match(workerClient, /call_with_initialize/);
    assert.match(workerClient, /worker_command == "media_join"/);
    assert.match(workerClient, /connection\.send\("media_initialize"/);
    assert.match(workerClient, /ensure_connection/);
  });

  it("owns receive-event strings exactly once and preserves logical P2P handles", async () => {
    const worker = await read("desktop/src-tauri/src/media_worker_server.rs");
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
    const worker = await read("desktop/src-tauri/src/media_worker_server.rs");
    const workerClient = await read(
      "desktop/src-tauri/src/media/worker_client.rs",
    );
    const settings = await read("app/pages/settings.vue");
    assert.match(
      worker,
      /command == "media_get_devices"[\s\S]*shutdown_after: false/,
    );
    assert.match(
      worker,
      /fn prepare_devices[\s\S]*shutdown_after: !state\.connected/,
    );
    assert.match(
      worker,
      /fn prepare_capture[\s\S]*shutdown_after: !state\.connected/,
    );
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
    const workerClient = await read(
      "desktop/src-tauri/src/media/worker_client.rs",
    );
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

  it("uses worker-owned platform surfaces instead of parent-window embedding", async () => {
    const mac = await read(
      "desktop/native-media/platform/macos/VideoSurfaceMacos.mm",
    );
    const windows = await read(
      "desktop/native-media/platform/windows/VideoSurfaceWindows.cpp",
    );
    assert.match(mac, /AVSampleBufferDisplayLayer/);
    assert.match(mac, /kCVPixelBufferIOSurfacePropertiesKey/);
    assert.match(mac, /pending_sample/);
    assert.match(mac, /render_scheduled/);
    assert.doesNotMatch(mac, /set_parent|RawWindowHandle/);
    assert.match(windows, /D3D11CreateDeviceAndSwapChain/);
    assert.match(windows, /ResizeBuffers/);
    assert.doesNotMatch(
      windows,
      /StretchDIBits|SetDIBitsToDevice|CreateDIBSection/,
    );
    assert.doesNotMatch(windows, /set_parent|RawWindowHandle/);
  });
});
