import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

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
  return (await Promise.all(paths.map((path) => readFile(path, "utf8")))).join(
    "\n",
  );
}

const [render, workerServer, workerClient, session] = await Promise.all([
  readFile(
    "desktop/native-media/libdspeak_media/src/internal/receive_render.cpp",
    "utf8",
  ),
  readSources(workerServerSources),
  readSources(workerClientSources),
  readFile("app/composables/media/native-media-engine-session.ts", "utf8"),
]);

describe("native media worker continuity contract", () => {
  it("bounds raw video events before they cross the worker protocol", () => {
    assert.match(render, /kFrameEventMaxWidth = 480/);
    assert.match(render, /kFrameEventMaxHeight = 270/);
    assert.match(render, /kFrameEventIntervalUs = 66000/);
    assert.match(render, /kLocalCameraFrameEventMaxWidth = 480/);
    assert.match(render, /kLocalCameraFrameEventMaxHeight = 270/);
    assert.match(render, /kLocalCameraFrameEventIntervalUs = 33333/);
    assert.match(render, /kLocalScreenFrameEventMaxWidth = 320/);
    assert.match(render, /kLocalScreenFrameEventMaxHeight = 180/);
    assert.match(render, /kLocalScreenFrameEventIntervalUs = 100000/);
    assert.match(render, /preview_interval_us = is_screen_preview/);
    assert.match(render, /preview_max_width = is_screen_preview/);
    assert.match(render, /preview_max_height = is_screen_preview/);
    assert.match(render, /I420Scale/);
    assert.match(workerServer, /MAX_NATIVE_VIDEO_FRAME_BYTES: usize = 600_000/);
    assert.match(workerServer, /"dataDropped": data_dropped/);
  });

  it("keeps preparation commands on the persistent media worker", () => {
    assert.match(
      workerServer,
      /fn prepare_devices[\s\S]*shutdown_after: false/,
    );
    assert.match(
      workerServer,
      /fn prepare_capture[\s\S]*shutdown_after: false/,
    );
    assert.match(workerClient, /if command == "media_shutdown"/);
    assert.doesNotMatch(
      workerClient,
      /"media_prepare_devices" \| "media_prepare_capture"\)\s*\{/,
    );
  });

  it("keeps large receive events off the control response pipe", () => {
    assert.match(workerServer, /BufWriter::new\(io::stderr\(\)\)/);
    assert.match(workerServer, /DSPEAK_NATIVE_EVENT/);
    assert.match(workerServer, /fn write_event_message/);
    assert.match(workerClient, /fn read_worker_stderr/);
    assert.match(workerClient, /strip_prefix\(EVENT_PREFIX\)/);
  });

  it("serializes camera and screen capture lifecycle operations", () => {
    assert.match(
      session,
      /\(engine\.cameraOperation \|\| Promise\.resolve\(\)\)[\s\S]*\.then\(\(\) => setCameraEnabledNow/,
    );
    assert.match(
      session,
      /\(engine\.screenOperation \|\| Promise\.resolve\(\)\)[\s\S]*\.then\(\(\) => startScreenShareNow/,
    );
    assert.match(session, /async function startScreenShareNow/);
    assert.match(session, /async function stopScreenShareNow/);
    assert.match(session, /await stopScreenShareNow\(engine\)/);
    assert.match(session, /handleNativeCaptureErrorNow/);
  });
});
