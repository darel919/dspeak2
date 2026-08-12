#include "lib_dspeak_media/lib_dspeak_media.h"
#include "media_handles.hpp"
#include <cstring>
#include <cstdlib>
#include <map>
#include <mutex>
#include <queue>
#include <atomic>
#include <future>
#include <string>
#include <stdexcept>
#include <vector>
#include <memory>
#if DSPEAK_MEDIA_WITH_MEDIASOUP
#include <mediasoupclient.hpp>
#endif
#include <api/media_stream_interface.h>
#include <api/scoped_refptr.h>
#include <api/create_peerconnection_factory.h>
#include <api/audio/create_audio_device_module.h>
#include <api/audio_codecs/builtin_audio_encoder_factory.h>
#include <api/audio_codecs/builtin_audio_decoder_factory.h>
#include <api/environment/environment_factory.h>
#include <rtc_base/thread.h>
#include <json.hpp>
#include "runtime_health.hpp"

#if defined(__APPLE__) || defined(__linux__) || defined(_WIN32)
#include "PlatformCapture.h"
#endif

using json = nlohmann::json;

static std::atomic<bool> g_initialized{false};

static bool probe_core_runtime() {
    try {
        auto* signaling_thread = webrtc::Thread::Create().release();
        auto* worker_thread = webrtc::Thread::Create().release();
        if (!signaling_thread || !worker_thread) {
            delete signaling_thread;
            delete worker_thread;
            return false;
        }
        signaling_thread->Start();
        worker_thread->Start();
        auto null_adm = webrtc::CreateAudioDeviceModule(
            webrtc::CreateEnvironment(),
            webrtc::AudioDeviceModule::kDummyAudio);
        if (!null_adm) {
            delete signaling_thread;
            delete worker_thread;
            return false;
        }
        auto factory = webrtc::CreatePeerConnectionFactory(
            nullptr,
            worker_thread,
            signaling_thread,
            null_adm,
            webrtc::CreateBuiltinAudioEncoderFactory(),
            webrtc::CreateBuiltinAudioDecoderFactory(),
            nullptr,
            nullptr,
            nullptr,
            nullptr);
        const bool ready = factory != nullptr;
        factory = nullptr;
        delete signaling_thread;
        delete worker_thread;
        return ready;
    } catch (...) {
        return false;
    }
}

static json runtime_health_record(bool available,
                                  const char* ready_reason,
                                  const char* pending_reason) {
    return {
        {"available", available},
        {"reason", available ? ready_reason : pending_reason},
    };
}

/* ── Internal helpers ────────────────────────────── */

char* lib_dspeak_media_strdup(const char* s)
{
    if (!s) return nullptr;
    auto* p = std::malloc(std::strlen(s) + 1);
    std::memcpy(p, s, std::strlen(s) + 1);
    return static_cast<char*>(p);
}

lib_dspeak_media_json lib_dspeak_media_json_arg(const char* s)
{
    return s ? json::parse(s) : json::object();
}

char* lib_dspeak_media_json_to_cstr(const json& j)
{
    auto s = j.dump();
    return lib_dspeak_media_strdup(s.c_str());
}

extern "C" int lib_dspeak_media_initialize(void)
{
    try {
#if DSPEAK_MEDIA_WITH_MEDIASOUP
        mediasoupclient::Initialize();
#endif
        const bool ready = probe_core_runtime();
        g_initialized = ready;
        dspeak_media_runtime::core_ready.store(ready);
        if (!ready) {
#if DSPEAK_MEDIA_WITH_MEDIASOUP
            mediasoupclient::Cleanup();
#endif
        }
        return ready ? 0 : -1;
    } catch (...) {
        g_initialized = false;
        dspeak_media_runtime::core_ready.store(false);
        return -1;
    }
}

extern "C" int lib_dspeak_media_probe_runtime(int* error_out)
{
    if (error_out) *error_out = 0;
    if (!g_initialized.load()) {
        if (error_out) *error_out = -400;
        dspeak_media_runtime::core_ready.store(false);
        return -1;
    }
    const bool ready = probe_core_runtime();
    dspeak_media_runtime::core_ready.store(ready);
    if (!ready && error_out) *error_out = -401;
    return ready ? 0 : -1;
}

#if defined(__APPLE__)
extern "C" int lib_dspeak_media_stop_screen_capture(int* error_out);
extern "C" void lib_dspeak_media_stop_system_audio_capture(void);
extern "C" int lib_dspeak_media_stop_microphone_capture(int* error_out);
extern "C" int lib_dspeak_media_stop_camera_capture(int* error_out);
#endif

extern "C" void lib_dspeak_media_shutdown(void)
{
#if defined(__APPLE__)
    lib_dspeak_media_stop_screen_capture(nullptr);
    lib_dspeak_media_stop_system_audio_capture();
    lib_dspeak_media_stop_microphone_capture(nullptr);
    lib_dspeak_media_stop_camera_capture(nullptr);
#endif
    try {
#if DSPEAK_MEDIA_WITH_MEDIASOUP
        mediasoupclient::Cleanup();
#endif
    } catch (...) {}
    g_initialized = false;
    dspeak_media_runtime::reset();
}

/* ── Capabilities ─────────────────────────────────── */

extern "C" char* lib_dspeak_media_get_capabilities(void)
{
    const bool core_ready = g_initialized.load() && dspeak_media_runtime::core_ready.load();
    const bool screen_video_ready = dspeak_media_runtime::screen_video_ready.load();
    const bool screen_audio_ready = dspeak_media_runtime::screen_audio_ready.load();
    const bool microphone_ready = dspeak_media_runtime::microphone_ready.load();
    const bool camera_ready = dspeak_media_runtime::camera_ready.load();
    const bool audio_receive_ready = dspeak_media_runtime::audio_receive_ready.load();
    const bool video_receive_ready = dspeak_media_runtime::video_receive_ready.load();
    const bool p2p_ready = dspeak_media_runtime::p2p_ready.load();
    const bool sfu_ready = dspeak_media_runtime::sfu_ready.load();

    json caps;
    caps["nativeRtc"] = core_ready;
    caps["nativeBackendReady"] = core_ready;
    caps["screenVideo"] = screen_video_ready;
    caps["screenAudio"] = screen_audio_ready;
    caps["microphone"] = microphone_ready;
    caps["camera"] = camera_ready;
    caps["audioReceive"] = audio_receive_ready;
    caps["videoReceive"] = video_receive_ready;
    caps["p2p"] = p2p_ready;
    caps["sfu"] = sfu_ready;
    caps["capture"] = json::object();
    caps["health"] = {
        {"nativeRtc", runtime_health_record(core_ready,
            "libwebrtc initialized and peer-connection factory probe passed",
            "native core runtime probe has not passed")},
        {"microphone", runtime_health_record(microphone_ready,
            "microphone callback delivered validated stereo 48 kHz PCM",
            "microphone device enumeration is not proof of callback delivery")},
        {"camera", runtime_health_record(camera_ready,
            "camera callback delivered a native frame",
            "camera device enumeration is not proof of callback delivery")},
        {"screenVideo", runtime_health_record(screen_video_ready,
            "ScreenCaptureKit delivered a native video sample",
            "screen source enumeration is not proof of video delivery")},
        {"screenAudio", runtime_health_record(screen_audio_ready,
            "ScreenCaptureKit delivered validated stereo 48 kHz float PCM",
            "screen source enumeration is not proof of audio delivery")},
        {"audioReceive", runtime_health_record(audio_receive_ready,
            "a native remote audio frame reached the CoreAudio renderer",
            "no native remote audio frame has reached the renderer")},
        {"videoReceive", runtime_health_record(video_receive_ready,
            "a native remote video frame reached the receive renderer",
            "no native remote video frame has reached the renderer")},
        {"p2p", runtime_health_record(p2p_ready,
            "a native P2P ICE connection reached connected or completed",
            "a two-peer native P2P ICE probe has not completed")},
        {"sfu", runtime_health_record(sfu_ready,
            "a native SFU transport reached connected",
            "a live native SFU transport has not reached connected")},
    };
#if defined(__linux__) || defined(_WIN32)
    try {
        auto platform = json::parse(lib_dspeak_media_platform_capabilities_json());
        if (platform.contains("capture")) caps["capture"] = platform["capture"];
    } catch (...) {
        caps["capture"] = json::object();
    }
#endif
#if defined(__APPLE__) || defined(__linux__) || defined(_WIN32)
    try {
        char* source_text = lib_dspeak_media_platform_capture_list_sources();
        if (!source_text) throw std::runtime_error("source enumeration returned no response");
        std::unique_ptr<char, decltype(&std::free)> source_guard(source_text, &std::free);
        auto sources = json::parse(source_guard.get());
        json video_sources = json::array();
        json audio_sources = json::array();
        if (sources.is_array()) {
            for (const auto& source : sources) {
                const auto capabilities = source.value("capabilities", json::object());
                if (capabilities.value("video", false)) video_sources.push_back(source);
                if (capabilities.value("audio", false)) audio_sources.push_back(source);
            }
        }
#if defined(__APPLE__)
        caps["capture"]["screenCaptureKit"] = {
            {"available", screen_video_ready},
            {"reason", screen_video_ready
                ? "ScreenCaptureKit delivered a native video sample"
                : "ScreenCaptureKit source enumeration requires an explicit delivery probe"},
            {"sources", video_sources},
        };
        caps["capture"]["screenAudio"] = {
            {"available", screen_audio_ready},
            {"reason", screen_audio_ready
                ? "ScreenCaptureKit delivered validated stereo 48 kHz float PCM"
                : "ScreenCaptureKit audio requires an explicit delivery probe"},
            {"sources", audio_sources},
        };
        char* device_caps_text = lib_dspeak_media_platform_capture_capabilities();
        if (device_caps_text) {
            try {
                auto device_caps = json::parse(device_caps_text);
                for (const char* kind : {"microphone", "camera"}) {
                    const auto capability = device_caps.value(kind, json::object());
                    const bool available = std::strcmp(kind, "microphone") == 0
                        ? microphone_ready : camera_ready;
                    const std::string enumerated_reason = capability.value(
                        "reason", "Native device capability was not reported");
                    caps[kind] = available;
                    caps["capture"][kind] = {
                        {"available", available},
                        {"reason", available
                            ? (std::string("Native device capture callback passed: ") + enumerated_reason)
                            : (std::string("Native device capture delivery probe has not passed: ") + enumerated_reason)},
                        {"sources", capability.value("sources", json::array())},
                    };
                }
            } catch (...) {
                caps["capture"]["microphone"] = {
                    {"available", false},
                    {"reason", "Native microphone capability JSON was invalid"},
                    {"sources", json::array()},
                };
                caps["capture"]["camera"] = {
                    {"available", false},
                    {"reason", "Native camera capability JSON was invalid"},
                    {"sources", json::array()},
                };
            }
            std::free(device_caps_text);
        }
#endif
        caps["capture"]["sourceEnumeration"] = {
            {"available", sources.is_array() && !sources.empty()},
            {"sourceCount", sources.is_array() ? sources.size() : 0},
        };
    } catch (...) {
        caps["capture"]["sourceEnumeration"] = {
            {"available", false},
            {"sourceCount", 0},
        };
    }
#endif
    return lib_dspeak_media_json_to_cstr(caps);
}

/* ── Memory ───────────────────────────────────────── */

extern "C" void lib_dspeak_media_free_string(char* s)
{
    std::free(s);
}

extern "C" const char* lib_dspeak_media_capture_error_message(int error_code)
{
    switch (error_code) {
        case -100:
            return "native capture is unsupported by this platform backend";
        case -101:
            return "native capture dependencies are unavailable in this build";
        case -102:
            return "native capture request is invalid";
        case -103:
            return "native capture is not running";
        case -220:
            return "microphone or camera permission was denied";
        case -221:
            return "AVAudioEngine microphone failed to start";
        case -222:
            return "AVAudioEngine delivered an unsupported PCM format";
        case -223:
            return "camera capture graph could not be created";
        case -224:
            return "AVAudioEngine microphone graph failed during setup";
        case -225:
            return "selected microphone is not available";
        case -301:
            return "native capture health probe could not find a usable source";
        case -302:
            return "native capture health probe found no video or audio source";
        case -303:
            return "native capture health probe could not start capture";
        case -304:
            return "native capture health probe received no media sample";
        case -400:
            return "native runtime probe ran before native initialization";
        case -401:
            return "native core runtime probe failed";
        case -700:
            return "self-hosted mediasoup SFU support is not included in this native bundle";
        default:
            return "native capture failed";
    }
}
