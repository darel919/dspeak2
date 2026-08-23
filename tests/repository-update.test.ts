import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createBuildIdentity,
  normalizeBranch,
  normalizeCommit,
  normalizeRepository,
} from "../shared/app-build.ts";
import { createUnavailableSnapshot } from "../server/utils/repository-update.ts";

const [
  _buildInfo,
  nuxtConfig,
  desktopNuxtConfig,
  route,
  repositoryUpdate,
  repositoryComposable,
  details,
  init,
  app,
  updatePrompt,
  pwaPrompt,
  desktopPrompt,
  tauriConfig,
  tauriMain,
  workflow,
  nativeMediaWorkflow,
  manifestScript,
  nativeMediaProvisioner,
  nativeMediaIgnore,
  nativeMediaAudioRing,
  nativeMediaThreadScheduler,
  nativeMediaCaptureState,
  nativeMediaReceiveRender,
  nativeMediaCmake,
  nativeMediaWindowsInternal,
  nativeMediaBuild,
  nativeMediaCargoConfig,
  nativeMediaRuntime,
  nativeMediaWindowsSupport,
  nativeMediaWindowsGraphics,
  nativeMediaWindowsAudio,
  nativeMediaWindowsCodecs,
  nativeMediaWindowsSession,
  nativeMediaWindowsOutput,
  nativeMediaMacSupport,
  nativeMediaMacScreen,
  nativeMediaMacDevices,
  nativeMediaMacDevice,
  settings,
  releaseVersionScript,
] = await Promise.all(
  [
    "../shared/app-build.ts",
    "../nuxt.config.ts",
    "../desktop/nuxt.desktop.config.ts",
    "../server/routes/api/update.get.ts",
    "../server/utils/repository-update.ts",
    "../app/composables/useRepositoryUpdate.ts",
    "../app/components/UpdateDetails.vue",
    "../app/components/Init.vue",
    "../app/app.vue",
    "../app/components/UpdatePrompt.vue",
    "../app/components/PwaUpdatePrompt.vue",
    "../app/components/DesktopUpdatePrompt.vue",
    "../desktop/src-tauri/tauri.conf.json",
    "../desktop/src-tauri/src/desktop/updates.rs",
    "../.github/workflows/desktop-build.yml",
    "../.github/workflows/native-media.yml",
    "../scripts/create-tauri-update-manifest.mjs",
    "../desktop/scripts/provision-native-media.sh",
    "../desktop/native-media/.gitignore",
    "../desktop/native-media/platform/AudioSpscRing.hpp",
    "../desktop/native-media/platform/NativeThreadScheduler.h",
    "../desktop/native-media/libdspeak_media/src/internal/capture_state.hpp",
    "../desktop/native-media/libdspeak_media/src/internal/receive_render.cpp",
    "../desktop/native-media/libdspeak_media/CMakeLists.txt",
    "../desktop/native-media/platform/windows/PlatformCaptureWindowsInternal.hpp",
    "../desktop/src-tauri/build.rs",
    "../desktop/.cargo/config.toml",
    "../desktop/native-media/libdspeak_media/src/internal/library_runtime.cpp",
    "../desktop/native-media/platform/windows/PlatformCaptureWindowsSupport.cpp",
    "../desktop/native-media/platform/windows/PlatformCaptureWindowsGraphics.cpp",
    "../desktop/native-media/platform/windows/PlatformCaptureWindowsAudio.cpp",
    "../desktop/native-media/platform/windows/MediaFoundationCodecsWindows.cpp",
    "../desktop/native-media/platform/windows/PlatformCaptureWindowsSession.cpp",
    "../desktop/native-media/platform/windows/PlatformCaptureWindowsOutput.cpp",
    "../desktop/native-media/platform/macos/PlatformCaptureMacosSupport.mm",
    "../desktop/native-media/platform/macos/PlatformCaptureScreen.mm",
    "../desktop/native-media/platform/macos/PlatformCaptureDevices.mm",
    "../desktop/native-media/platform/macos/PlatformCaptureDevice.mm",
    "../app/pages/settings.vue",
    "../scripts/sync-release-version.mjs",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
);

const nativeMediaWindows = [
  nativeMediaWindowsSupport,
  nativeMediaWindowsGraphics,
  nativeMediaWindowsAudio,
  nativeMediaWindowsSession,
  nativeMediaWindowsOutput,
].join("\n");
const nativeMediaMac = [
  nativeMediaMacSupport,
  nativeMediaMacScreen,
  nativeMediaMacDevices,
  nativeMediaMacDevice,
].join("\n");

test("build identity normalizes source metadata without exposing arbitrary values", () => {
  assert.equal(normalizeCommit("C".repeat(40)), "c".repeat(40));
  assert.equal(normalizeCommit("not-a-commit"), null);
  assert.equal(normalizeCommit("1234567", { short: true }), "1234567");
  assert.equal(normalizeCommit(1_234_567, { short: true }), null);
  assert.equal(normalizeBranch("feature/updates"), "feature/updates");
  assert.equal(normalizeBranch("bad branch"), "next");
  assert.equal(
    normalizeRepository("https://github.com/darel919/dspeak2.git"),
    "darel919/dspeak2",
  );
  assert.equal(
    normalizeRepository("https://example.com/repo"),
    "darel919/dspeak2",
  );
  assert.deepEqual(
    createBuildIdentity({
      version: "2.7.0-alpha12",
      commit: "A".repeat(40),
      branch: "next",
      builtAt: "2026-08-09T00:00:00.000Z",
      repository: "darel919/dspeak2",
      updateBranch: "next",
    }),
    {
      version: "2.7.0-alpha12",
      commit: "a".repeat(40),
      shortCommit: "a".repeat(7),
      branch: "next",
      builtAt: "2026-08-09T00:00:00.000Z",
      repository: "darel919/dspeak2",
      updateBranch: "next",
    },
  );
});

test("repository update metadata rejects numeric build commits", () => {
  const snapshot = createUnavailableSnapshot(
    { commit: 1_234_567 },
    { commit: 7_654_321 },
    "darel919/dspeak2",
    "next",
  );

  assert.equal(snapshot.client.commit, null);
  assert.equal(snapshot.client.shortCommit, null);
  assert.equal(snapshot.deployed.commit, null);
  assert.equal(snapshot.deployed.shortCommit, null);
});

test("web and desktop builds embed the same commit-aware identity", () => {
  assert.match(nuxtConfig, /createBuildIdentity/);
  assert.match(nuxtConfig, /VERCEL_GIT_COMMIT_SHA/);
  assert.match(nuxtConfig, /GITHUB_SHA/);
  assert.match(nuxtConfig, /appBuild:\s*\{\s*\.\.\.buildIdentity/);
  assert.match(desktopNuxtConfig, /createBuildIdentity/);
  assert.match(desktopNuxtConfig, /appBuild: buildIdentity/);
  assert.match(settings, /commit\s+\{\{\s*appBuild\.shortCommit/);
});

test("repository comparison reports deployment and source update states", () => {
  assert.match(route, /getRepositoryUpdate/);
  assert.match(route, /query\.commit/);
  assert.match(repositoryUpdate, /commits\//);
  assert.match(repositoryUpdate, /compare\//);
  assert.match(repositoryUpdate, /aheadBy/);
  assert.match(repositoryUpdate, /pullRequest/);
  assert.match(repositoryUpdate, /html_url/);
  assert.doesNotMatch(
    repositoryUpdate,
    /summarizeFile|filesTruncated|totalFiles/,
  );
  assert.match(repositoryUpdate, /deployedUpdateAvailable/);
  assert.match(repositoryUpdate, /sourceUpdateAvailable/);
  assert.match(repositoryUpdate, /MAX_CACHE_ENTRIES = 12/);
  assert.match(repositoryUpdate, /AbortSignal\.timeout\(5000\)/);
});

test("startup and prompts expose useful release details without file listings", () => {
  assert.match(init, /checkRepositoryUpdate/);
  assert.match(init, /Promise\.all/);
  assert.match(repositoryComposable, /apiPath/);
  assert.match(repositoryComposable, /\/update/);
  assert.match(repositoryComposable, /startMonitoring/);
  assert.match(repositoryComposable, /60 \* 60 \* 1000/);
  assert.match(details, /What's changed/);
  assert.match(details, /Full changelog/);
  assert.match(details, /pullRequest/);
  assert.doesNotMatch(details, /Files changed/);
  assert.match(details, /packageUpdate/);
  assert.match(details, /props\.snapshot\?\.comparison/);
  assert.match(pwaPrompt, /deployedUpdateAvailable/);
  assert.match(pwaPrompt, /promptVisible/);
  assert.match(pwaPrompt, /Refresh/);
  assert.match(pwaPrompt, /Later/);
  assert.match(pwaPrompt, /window\.location\.reload/);
  assert.match(init, /startDesktopUpdateMonitoring/);
  assert.match(app, /<UpdatePrompt \/>/);
  assert.doesNotMatch(app, /<PwaUpdatePrompt \/>|<DesktopUpdatePrompt \/>/);
  assert.match(
    updatePrompt,
    /PwaUpdatePrompt v-if="runtimeReady && !desktopRuntime"/,
  );
  assert.match(
    updatePrompt,
    /DesktopUpdatePrompt v-else-if="runtimeReady && desktopRuntime"/,
  );
  assert.match(updatePrompt, /runtimeStore\.initialize\(\)/);
  assert.match(desktopPrompt, /shouldShowDesktopUpdatePrompt/);
  assert.doesNotMatch(desktopPrompt, /repositoryUpdateAvailable/);
});

test("desktop releases publish signed updates and fail when the updater contract is incomplete", () => {
  assert.match(tauriConfig, /releases\/latest\/download\/latest\.json/);
  assert.match(tauriMain, /download_and_install/);
  assert.match(tauriMain, /app\.restart\(\)/);
  assert.match(tauriMain, /raw_json/);
  assert.match(tauriMain, /DSPEAK_TAURI_PUBLIC_KEY/);
  assert.match(workflow, /Configure signed updater artifacts/);
  assert.match(workflow, /TAURI_SIGNING_PRIVATE_KEY/);
  assert.match(
    workflow,
    /Tagged desktop releases require DSPEAK_TAURI_PUBLIC_KEY/,
  );
  assert.match(workflow, /Verify signed updater artifacts/);
  assert.doesNotMatch(workflow, /steps\.updater\.outputs\.enabled/);
  assert.doesNotMatch(workflow, /publishing installers without latest\.json/);
  assert.match(workflow, /create-tauri-update-manifest\.mjs/);
  assert.match(workflow, /Verify updater manifest/);
  assert.match(workflow, /release:check/);
  assert.match(workflow, /DSPEAK_RELEASE_TAG/);
  assert.match(workflow, /DSPEAK_RELEASE_COMMIT/);
  assert.doesNotMatch(workflow, /dspeak-media-control/);
  assert.doesNotMatch(workflow, /bun run test/);
  assert.doesNotMatch(workflow, /DSPEAK_TEST_TOKEN|desktop-session-e2e/);
  assert.match(workflow, /\.app\.tar\.gz\.sig/);
  assert.match(workflow, /nsis\/\*\.exe\.sig/);
  assert.doesNotMatch(workflow, /\.nsis\.zip\.sig/);
  assert.match(workflow, /windows-x64/);
  assert.doesNotMatch(workflow, /windows-arm64|windows-11-arm/);
  assert.match(manifestScript, /platforms/);
  assert.match(manifestScript, /packageMetadata/);
  assert.match(manifestScript, /releaseVersionFromTag/);
  assert.match(manifestScript, /commit/);
  assert.match(manifestScript, /signature/);
  assert.match(manifestScript, /windows-x86_64/);
  assert.match(manifestScript, /(?:x64\|x86_64\|amd64).*\\\.exe/);
  assert.doesNotMatch(manifestScript, /\.nsis\\?\.zip/);
  assert.doesNotMatch(manifestScript, /windows-aarch64/);
  assert.equal(nativeMediaProvisioner.match(/gclient sync/g)?.length, 1);
  assert.match(nativeMediaProvisioner, /--reset/);
  assert.match(nativeMediaProvisioner, /--revision "src@\$WEBRTC_BRANCH"/);
  assert.doesNotMatch(nativeMediaProvisioner, /git checkout -B/);
  assert.doesNotMatch(nativeMediaProvisioner, /--with_branch_heads/);
  assert.match(nativeMediaProvisioner, /export PATH="\$depot_tools:\$PATH"/);
  assert.match(
    nativeMediaProvisioner,
    /export DEPOT_TOOLS_WIN_TOOLCHAIN="\$\{DEPOT_TOOLS_WIN_TOOLCHAIN:-0\}"/,
  );
  assert.match(
    nativeMediaProvisioner,
    /platform_uses_windows_libraries "\$platform"[\s\S]*use_custom_libcxx=false/,
  );
  assert.match(
    nativeMediaProvisioner,
    /Windows WebRTC must use the MSVC-compatible standard library ABI/,
  );
  assert.match(nativeMediaProvisioner, /NATIVE_MEDIA_BASE_ARTIFACT_ARCHIVE/);
  assert.match(nativeMediaProvisioner, /seed_libwebrtc_from_native_bundle/);
  assert.match(nativeMediaProvisioner, /CMAKE_MSVC_RUNTIME_LIBRARY/);
  assert.match(nativeMediaProvisioner, /local cmake_runtime_argument=""/);
  assert.match(nativeMediaProvisioner, /CMAKE_POLICY_DEFAULT_CMP0091=NEW/);
  assert.doesNotMatch(nativeMediaProvisioner, /cmake_runtime_arguments/);
  assert.match(nativeMediaProvisioner, /missing\[\*\]-/);
  assert.match(nativeMediaIgnore, /!platform\/AudioSpscRing\.hpp/);
  assert.match(nativeMediaIgnore, /!platform\/NativeThreadScheduler\.h/);
  assert.match(
    nativeMediaCaptureState,
    /#include "\.\.\/\.\.\/\.\.\/platform\/AudioSpscRing\.hpp"/,
  );
  assert.match(
    nativeMediaReceiveRender,
    /#include "\.\.\/\.\.\/\.\.\/platform\/AudioSpscRing\.hpp"/,
  );
  assert.match(nativeMediaAudioRing, /class StereoAudioSpscRing/);
  assert.match(nativeMediaThreadScheduler, /namespace dspeak_native/);
  assert.match(
    nativeMediaProvisioner,
    /python3 src\/build\/util\/lastchange\.py -o src\/build\/util\/LASTCHANGE/,
  );
  assert.doesNotMatch(nativeMediaProvisioner, /kill "\$heartbeat_pid"/);
  assert.equal(nativeMediaProvisioner.match(/sha256_file/g)?.length, 4);
  assert.match(nativeMediaProvisioner, /command -v sha256sum/);
  assert.match(nativeMediaProvisioner, /command -v certutil\.exe/);
  assert.doesNotMatch(nativeMediaProvisioner, /shasum -a 256 "\$archive"/);
  assert.doesNotMatch(nativeMediaProvisioner, /dspeak_media_bootstrap/);
  assert.match(
    nativeMediaProvisioner,
    /\[\[ -s "\$bundle\/lib\/\$\{library\}\.lib"/,
  );
  assert.doesNotMatch(nativeMediaProvisioner, /gclient sync --cache-dir/);
  assert.match(nativeMediaProvisioner, /-name '\*\.inc'/);
  assert.match(nativeMediaProvisioner, /"\$webrtc_output\/gen"/);
  assert.match(
    nativeMediaProvisioner,
    /third_party\/abseil-cpp\/absl\/numeric\/int128_no_intrinsic\.inc/,
  );
  assert.match(
    nativeMediaProvisioner,
    /validate_webrtc_headers "\$source_bundle"/,
  );
  assert.match(
    nativeMediaCmake,
    /platform\/windows\/PlatformCaptureWindowsSession\.cpp/,
  );
  assert.match(
    nativeMediaWindowsInternal,
    /#include <propkeydef\.h>\n#include <functiondiscoverykeys_devpkey\.h>/,
  );
  assert.match(nativeMediaWindowsInternal, /#include <mferror\.h>/);
  assert.match(nativeMediaWindowsInternal, /#define StrCat StrCat/);
  assert.match(nativeMediaWindowsInternal, /using Microsoft::WRL::Make;/);
  assert.doesNotMatch(nativeMediaWindowsInternal, /#define NOMINMAX/);
  assert.doesNotMatch(
    nativeMediaCmake,
    /DSPEAK_MEDIA_CORE_LIBRARIES[\s\S]*?dspeak_media\.(?:lib|a)/,
  );
  assert.match(
    nativeMediaRuntime,
    /#if defined\(__APPLE__\) \|\| defined\(_WIN32\)\n#include "PlatformCapture\.h"/,
  );
  assert.doesNotMatch(
    nativeMediaRuntime,
    /lib_dspeak_media_platform_capabilities_json/,
  );
  assert.match(
    nativeMediaWindows,
    /Direct3D11CaptureFramePool::CreateFreeThreaded/,
  );
  assert.match(
    nativeMediaWindows,
    /AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK/,
  );
  assert.match(nativeMediaWindows, /MF_SOURCE_READER_FIRST_VIDEO_STREAM/);
  assert.match(nativeMediaWindows, /D3D11CreateDevice/);
  assert.match(nativeMediaWindowsSupport, /audio_device_json\(device\.Get\(\)/);
  assert.match(nativeMediaWindowsGraphics, /winrt::com_ptr<IInspectable>/);
  assert.match(nativeMediaWindowsGraphics, /inspectable_device\.put\(\)/);
  assert.match(nativeMediaWindowsAudio, /MF_E_NOT_FOUND/);
  assert.match(
    nativeMediaWindowsCodecs,
    /std::max\(1u, codec_settings->maxFramerate\)/,
  );
  assert.match(nativeMediaWindowsCodecs, /encoded_max_length/);
  assert.doesNotMatch(
    nativeMediaWindowsSession,
    /namespace \{\n\nstruct lib_dspeak_media_capture_session/,
  );
  assert.match(nativeMediaMac, /AVCaptureDeviceDiscoverySession/);
  assert.match(nativeMediaMac, /AVCaptureDeviceTypeExternalUnknown/);
  assert.match(nativeMediaMac, /is_current_process\(application\)/);
  assert.match(nativeMediaMac, /capture_session\.isRunning/);
  assert.match(nativeMediaMac, /excludesCurrentProcessAudio/);
  assert.match(workflow, /mediasoup_mode=/);
  assert.match(workflow, /libraries=\(dspeak_media webrtc\)/);
  assert.match(workflow, /temp_root="\$\(cygpath -u "\$RUNNER_TEMP"\)"/);
  assert.match(workflow, /tar -xzf "\$archive" -C "\$extract_root"/);
  assert.match(workflow, /artifact_dir="\$\(cygpath -m "\$artifact_dir"\)"/);
  assert.match(workflow, /ART="\$NATIVE_MEDIA_ARTIFACT_DIR"/);
  assert.doesNotMatch(workflow, /find .* -exec tar xzf/);
  assert.match(
    workflow,
    /NATIVE_MEDIA_WITH_MEDIASOUP=\$mediasoup_mode.*GITHUB_ENV/,
  );
  assert.match(nativeMediaWorkflow, /NATIVE_MEDIA_WITH_MEDIASOUP: "1"/);
  assert.match(nativeMediaCmake, /WEBRTC_WIN=1/);
  assert.match(nativeMediaCmake, /CMAKE_MSVC_RUNTIME_LIBRARY/);
  assert.match(nativeMediaCmake, /windows\.graphics\.capture\.interop\.h/);
  assert.match(nativeMediaCmake, /audioclientactivationparams\.h/);
  assert.match(nativeMediaCmake, /DSPEAK_MEDIA_WINDOWS_WGC_DEPS/);
  assert.match(nativeMediaCmake, /mmdevapi/);
  assert.match(nativeMediaCmake, /runtimeobject/);
  assert.match(nativeMediaCmake, /strmiids/);
  assert.match(nativeMediaBuild, /"strmiids"/);
  assert.match(nativeMediaBuild, /"mmdevapi"/);
  assert.match(nativeMediaBuild, /"runtimeobject"/);
  assert.match(nativeMediaBuild, /"dmoguids"/);
  assert.match(nativeMediaBuild, /"wmcodecdspuuid"/);
  assert.match(nativeMediaBuild, /"amstrmid"/);
  assert.match(nativeMediaBuild, /"msdmo"/);
  assert.match(nativeMediaBuild, /"oleaut32"/);
  assert.doesNotMatch(nativeMediaBuild, /"combase"/);
  assert.doesNotMatch(nativeMediaCmake, /\n\s+combase\n/);
  assert.match(nativeMediaCmake, /\n\s+dmoguids\n/);
  assert.match(nativeMediaCmake, /\n\s+wmcodecdspuuid\n/);
  assert.match(nativeMediaCmake, /\n\s+amstrmid\n/);
  assert.match(nativeMediaCmake, /\n\s+msdmo\n/);
  assert.match(nativeMediaCmake, /\n\s+oleaut32\n/);
  assert.doesNotMatch(
    nativeMediaBuild,
    /remain unsupported until their frame\/PCM bridges are implemented/,
  );
  assert.match(nativeMediaCargoConfig, /target-feature=\+crt-static/);
  assert.match(nativeMediaWorkflow, /reuse_webrtc/);
  assert.match(nativeMediaWorkflow, /desktop\/native-media\/platform/);
  assert.match(
    nativeMediaWorkflow,
    /Download native media base for WebRTC reuse/,
  );
  assert.match(releaseVersionScript, /normalizeVersion/);
  assert.match(releaseVersionScript, /findVersionMismatches/);
});
