#include "lib_dspeak_media/lib_dspeak_media.h"
#include "library_runtime.hpp"
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
#include "platform_video_codec_factories.hpp"

#if defined(__APPLE__) || defined(_WIN32)
#include "PlatformCapture.h"
#endif

using json = nlohmann::json;

static std::atomic<bool> g_initialized{false};

namespace dspeak_native {

SharedTrackFactory::~SharedTrackFactory() {
    factory = nullptr;
    delete signaling_thread;
    delete worker_thread;
    signaling_thread = nullptr;
    worker_thread = nullptr;
}

static std::mutex g_shared_track_factory_mutex;
static std::weak_ptr<SharedTrackFactory> g_shared_track_factory;

std::shared_ptr<SharedTrackFactory> get_shared_track_factory() {
    std::lock_guard<std::mutex> lock(g_shared_track_factory_mutex);
    if (auto existing = g_shared_track_factory.lock()) return existing;

    auto signaling_thread = std::unique_ptr<webrtc::Thread>(webrtc::Thread::Create().release());
    auto worker_thread = std::unique_ptr<webrtc::Thread>(webrtc::Thread::Create().release());
    if (!signaling_thread || !worker_thread ||
        !start_media_thread(signaling_thread.get()) ||
        !start_media_thread(worker_thread.get()))
        return nullptr;

    auto null_adm = webrtc::CreateAudioDeviceModule(
        webrtc::CreateEnvironment(),
        webrtc::AudioDeviceModule::kDummyAudio);
    if (!null_adm) return nullptr;

    auto runtime = std::make_shared<SharedTrackFactory>();
    runtime->factory = webrtc::CreatePeerConnectionFactory(
        nullptr,
        worker_thread.get(),
        signaling_thread.get(),
        null_adm,
        webrtc::CreateBuiltinAudioEncoderFactory(),
        webrtc::CreateBuiltinAudioDecoderFactory(),
        create_video_encoder_factory(),
        create_video_decoder_factory(),
        nullptr,
        nullptr);
    if (!runtime->factory) return nullptr;

    runtime->signaling_thread = signaling_thread.release();
    runtime->worker_thread = worker_thread.release();
    g_shared_track_factory = runtime;
    return runtime;
}

void release_shared_track_factory() {
    std::lock_guard<std::mutex> lock(g_shared_track_factory_mutex);
    g_shared_track_factory.reset();
}

}

static bool probe_core_runtime() {
    try {
        auto* signaling_thread = webrtc::Thread::Create().release();
        auto* worker_thread = webrtc::Thread::Create().release();
        if (!signaling_thread || !worker_thread) {
            delete signaling_thread;
            delete worker_thread;
            return false;
        }
        if (!dspeak_native::start_media_thread(signaling_thread) ||
            !dspeak_native::start_media_thread(worker_thread)) {
            delete signaling_thread;
            delete worker_thread;
            return false;
        }
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

static json video_codec_entry(const char* codec,
                              const std::string& implementation,
                              bool hardware) {
    return {
        {"codec", codec},
        {"implementation", implementation},
        {"hardware", hardware},
    };
}

static json video_codec_factory_entry(const char* encoder_factory,
                                      const char* decoder_factory,
                                      bool hardware_encoder,
                                      bool hardware_decoder) {
    return {
        {"encoderFactory", encoder_factory},
        {"decoderFactory", decoder_factory},
        {"hardwareEncoder", hardware_encoder},
        {"hardwareDecoder", hardware_decoder},
    };
}

static const char* runtime_efficiency(
    const std::string& codec,
    bool supported,
    bool hardware,
    bool tested) {
    if (!supported || !tested) return "unusable";
    if (hardware) return "excellent";
    if (codec == "VP9" || codec == "H265") return "poor";
    if (codec == "AV1") return "unusable";
    return "acceptable";
}

static json runtime_codec_direction_entry(
    const std::string& codec,
    const dspeak_native::VideoCodecRuntimeDiagnostics& diagnostics,
    bool encoder) {
    const bool supported = encoder
        ? diagnostics.encoder_supported
        : diagnostics.decoder_supported;
    const bool hardware = encoder
        ? diagnostics.encoder_hardware
        : diagnostics.decoder_hardware;
    const bool tested = encoder
        ? diagnostics.encoder_frame_validated
        : diagnostics.decoder_frame_validated;
    const std::string implementation = encoder
        ? diagnostics.encoder_implementation
        : diagnostics.decoder_implementation;
    const int testedWidth = encoder
        ? diagnostics.encoder_tested_width
        : diagnostics.decoder_tested_width;
    const int testedHeight = encoder
        ? diagnostics.encoder_tested_height
        : diagnostics.decoder_tested_height;
    const int testedFps = encoder
        ? diagnostics.encoder_tested_fps
        : diagnostics.decoder_tested_fps;
    const std::string failure = encoder
        ? diagnostics.encoder_failure
        : diagnostics.decoder_failure;
    json entry = {
        {"supported", supported},
        {"acceleration", supported ? (hardware ? "hardware" : "software")
                                    : "unsupported"},
        {"implementation", implementation.empty() ? "unknown" : implementation},
        {"realtimeEfficiency", runtime_efficiency(codec, supported, hardware, tested)},
        {"powerClass", supported && hardware ? "low" : "high"},
        {"tested", tested},
        {"configured", encoder ? supported : diagnostics.decoder_configured},
    };
    if (tested && testedWidth > 0 && testedHeight > 0 && testedFps > 0) {
        entry["maxWidth"] = testedWidth;
        entry["maxHeight"] = testedHeight;
        entry["maxFps"] = testedFps;
    }
    if (tested)
        entry["testedProfile"] = codec + " / " +
            std::to_string(testedWidth) + "x" +
            std::to_string(testedHeight) + "@" +
            std::to_string(testedFps);
    if (!failure.empty()) entry["failureReason"] = failure;
    return entry;
}

static json video_codec_capabilities(const dspeak_native::VideoCodecFactoryDiagnostics& diagnostics) {
    json result = json::object();
    for (const auto* codec : {"H264", "H265", "VP8", "VP9", "AV1"}) {
        const auto found = diagnostics.codecs.find(codec);
        dspeak_native::VideoCodecRuntimeDiagnostics empty;
        const auto& runtime = found == diagnostics.codecs.end() ? empty : found->second;
        result[codec] = {
            {"encode", runtime_codec_direction_entry(codec, runtime, true)},
            {"decode", runtime_codec_direction_entry(codec, runtime, false)},
        };
    }
    return result;
}

static json video_codec_diagnostics() {
    const auto diagnostics = dspeak_native::video_codec_factory_diagnostics();
    const auto capabilities = video_codec_capabilities(diagnostics);
    json encoders = json::array();
    json decoders = json::array();
    for (const auto& [codec, runtime] : diagnostics.codecs) {
        if (runtime.encoder_supported)
            encoders.push_back(video_codec_entry(
                codec.c_str(), runtime.encoder_implementation,
                runtime.encoder_hardware));
        if (runtime.decoder_supported)
            decoders.push_back(video_codec_entry(
                codec.c_str(), runtime.decoder_implementation,
                runtime.decoder_hardware));
    }
    return {
        {"reportKind", "native-video-codec-factory"},
        {"configurationSource", "on-demand native libwebrtc encode/decode validation"},
        {"platform", diagnostics.platform},
        {"factoryMode", diagnostics.hardware_encoder || diagnostics.hardware_decoder
            ? "platform-hardware-with-software-fallback"
            : "software-fallback"},
        {"hardwareEncoder", diagnostics.hardware_encoder},
        {"hardwareDecoder", diagnostics.hardware_decoder},
        {"capabilities", capabilities},
        {"concurrentEncode", {
            {"supported", diagnostics.hardware_encoder},
            {"maxHardwareSessions", diagnostics.max_hardware_encode_sessions},
            {"confidence", diagnostics.concurrent_hardware_sessions_tested
                ? "tested"
                : "conservative-default"},
            {"testedCodecPairs", [&diagnostics] {
                json pairs = json::array();
                for (const auto& [left, right] : diagnostics.tested_codec_pairs)
                    pairs.push_back({left, right});
                return pairs;
            }()},
        }},
        {"fallbackPolicy", {
            {"hardwareCodec", "H264"},
            {"softwareEncoder", "VP8/H264"},
            {"softwareDecoder", "VP8/VP9/H264"},
            {"softwareAv1Encoder", false},
            {"softwareAv1Decoder", false},
        }},
        {"encoders", encoders},
        {"decoders", decoders},
        {"factories", {
            {"p2p", video_codec_factory_entry(
                "CompositeVideoEncoderFactory", "CompositeVideoDecoderFactory",
                diagnostics.hardware_encoder, diagnostics.hardware_decoder)},
            {"sfu", video_codec_factory_entry(
                "CompositeVideoEncoderFactory", "CompositeVideoDecoderFactory",
                diagnostics.hardware_encoder, diagnostics.hardware_decoder)},
            {"nativeVideoTrack", video_codec_factory_entry(
                "CompositeVideoEncoderFactory", "CompositeVideoDecoderFactory",
                diagnostics.hardware_encoder, diagnostics.hardware_decoder)},
            {"nativeAudioTrack", {
                {"encoderFactory", nullptr},
                {"decoderFactory", nullptr},
                {"hardwareEncoder", false},
                {"hardwareDecoder", false},
            }},
        }},
        {"activeStream", {
            {"encoderImplementation", diagnostics.active_encoder_implementation},
            {"decoderImplementation", diagnostics.active_decoder_implementation},
            {"hardwareEncoder", diagnostics.active_hardware_encoder},
            {"hardwareDecoder", diagnostics.active_hardware_decoder},
            {"encoderCreations", diagnostics.encoder_creations},
            {"decoderCreations", diagnostics.decoder_creations},
            {"source", "RTP outbound/inbound stats"},
            {"status", diagnostics.encoder_creations || diagnostics.decoder_creations
                ? "observed_during_factory_creation"
                : "not-created"},
        }},
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
        dspeak_native::reset_video_codec_factory_diagnostics();
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

#if defined(__APPLE__) || defined(_WIN32)
extern "C" int lib_dspeak_media_stop_screen_capture(int* error_out);
extern "C" void lib_dspeak_media_stop_system_audio_capture(void);
extern "C" int lib_dspeak_media_stop_microphone_capture(int* error_out);
extern "C" int lib_dspeak_media_stop_camera_capture(int* error_out);
#endif

extern "C" void lib_dspeak_media_shutdown(void)
{
    dspeak_native::release_shared_track_factory();
#if defined(__APPLE__) || defined(_WIN32)
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
    dspeak_native::reset_video_codec_factory_diagnostics();
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
    const auto codec_diagnostics = video_codec_diagnostics();
    caps["videoCodecDiagnostics"] = codec_diagnostics;
    caps["videoCodecCapabilities"] = codec_diagnostics["capabilities"];
    caps["concurrentEncode"] = codec_diagnostics["concurrentEncode"];
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
            "Native desktop capture delivered a native video sample",
            "screen source enumeration is not proof of video delivery")},
        {"screenAudio", runtime_health_record(screen_audio_ready,
            "Native desktop audio capture delivered validated stereo 48 kHz float PCM",
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
#if defined(__APPLE__) || defined(_WIN32)
    try {
        const char* video_backend =
#if defined(__APPLE__)
            "screenCaptureKit";
#else
            "windowsGraphicsCapture";
#endif
        const char* audio_backend =
#if defined(__APPLE__)
            "screenAudio";
#else
            "wasapiProcessLoopback";
#endif
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
        caps["capture"][video_backend] = {
            {"available", screen_video_ready},
            {"reason", screen_video_ready
                ? "The native desktop capturer delivered a video sample"
                : "Desktop source enumeration requires an explicit delivery probe"},
            {"sources", video_sources},
        };
        caps["capture"][audio_backend] = {
            {"available", screen_audio_ready},
            {"reason", screen_audio_ready
                ? "The native desktop audio capturer delivered validated stereo 48 kHz float PCM"
                : "Desktop audio source enumeration requires an explicit delivery probe"},
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
                for (auto it = device_caps.begin(); it != device_caps.end(); ++it) {
                    if (it.key() == "microphone" || it.key() == "camera") continue;
                    caps["capture"][it.key()] = it.value();
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
        case -201:
            return "native desktop capture content enumeration failed";
        case -202:
            return "native desktop capture source is no longer available";
        case -203:
            return "native screen audio requires macOS 13 or newer";
        case -204:
            return "native screen audio returned an unsupported format";
        case -205:
            return "native screen capture stream stopped";
        case -209:
            return "native screen capture failed to start";
        case -210:
            return "screen recording permission was denied";
        case -601:
            return "Windows WASAPI capture initialization failed";
        case -602:
            return "Windows WASAPI capture failed to start";
        case -603:
            return "Windows WASAPI capture stopped delivering audio";
        case -611:
            return "Windows Media Foundation camera initialization failed";
        case -612:
            return "Windows Media Foundation camera stopped delivering frames";
        case -624:
            return "Windows system audio capture failed to start";
        case -625:
            return "Windows application audio process could not be resolved";
        case -626:
            return "Windows process loopback requires Windows 10 build 20348 or newer";
        case -627:
            return "Windows Graphics Capture stopped delivering frames";
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
