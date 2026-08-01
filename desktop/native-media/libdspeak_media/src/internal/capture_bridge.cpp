#include "lib_dspeak_media/lib_dspeak_media.h"
#include <json.hpp>
#include <api/video/i420_buffer.h>
#include <common_video/libyuv/include/webrtc_libyuv.h>
#include <media/base/adapted_video_track_source.h>
#if defined(__APPLE__)
#include <CoreMedia/CoreMedia.h>
#endif
#include "media_handles.hpp"
#include "runtime_health.hpp"

#include <atomic>
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <mutex>
#include <string>
#include <thread>

#include <mediasoupclient.hpp>
#include <Device.hpp>
#include <Transport.hpp>
#include <Producer.hpp>
#include <Consumer.hpp>
#include <api/create_peerconnection_factory.h>
#include <api/media_stream_interface.h>
#include <api/peer_connection_interface.h>
#include <api/scoped_refptr.h>
#include <api/video/video_frame.h>
#include <rtc_base/ref_counted_object.h>
#include <rtc_base/synchronization/mutex.h>
#include <rtc_base/thread.h>

#if defined(__APPLE__)
#include "PlatformCapture.h"
#endif

using json = nlohmann::json;

static size_t video_codec_priority(const webrtc::RtpCodecCapability& codec) {
    const auto mime_type = codec.mime_type();
    if (mime_type == "video/H264") return 0;
    if (mime_type == "video/VP9") return 1;
    if (mime_type == "video/VP8") return 2;
    return 3;
}

static void apply_video_codec_preferences(
    webrtc::PeerConnectionFactoryInterface* factory,
    const webrtc::scoped_refptr<webrtc::RtpTransceiverInterface>& transceiver) {
    if (!factory || !transceiver || !transceiver->sender() ||
        !transceiver->sender()->track() ||
        transceiver->sender()->track()->kind() != "video") return;
    auto capabilities = factory->GetRtpSenderCapabilities(webrtc::MediaType::VIDEO).codecs;
    std::stable_sort(capabilities.begin(), capabilities.end(),
                     [](const auto& left, const auto& right) {
                         return video_codec_priority(left) < video_codec_priority(right);
                     });
    transceiver->SetCodecPreferences(capabilities);
}

static webrtc::Priority native_priority(const json& value, webrtc::Priority fallback)
{
    if (!value.is_string()) return fallback;
    const auto priority = value.get<std::string>();
    if (priority == "very-low") return webrtc::Priority::kVeryLow;
    if (priority == "low") return webrtc::Priority::kLow;
    if (priority == "medium") return webrtc::Priority::kMedium;
    if (priority == "high") return webrtc::Priority::kHigh;
    return fallback;
}

static double native_priority_value(const json& value)
{
    switch (native_priority(value, webrtc::Priority::kMedium)) {
        case webrtc::Priority::kVeryLow: return 0.5;
        case webrtc::Priority::kLow: return 1.0;
        case webrtc::Priority::kHigh: return 4.0;
        case webrtc::Priority::kMedium: return 2.0;
    }
    return 2.0;
}

extern "C" int lib_dspeak_media_p2p_add_video_track(lib_dspeak_media_p2p_handle_t* handle,
                                                      lib_dspeak_media_video_track_t* track) {
    try {
        if (!handle || !handle->pc || !track || !track->track) return -1;
        return handle->signaling_thread->BlockingCall([handle, track] {
            auto result = handle->pc->AddTrack(track->track, {"stream0"});
            if (!result.ok()) return -1;
            const auto sender = result.value();
            for (const auto& transceiver : handle->pc->GetTransceivers()) {
                if (transceiver->sender() == sender) {
                    apply_video_codec_preferences(handle->factory.get(), transceiver);
                    break;
                }
            }
            return result.ok() ? 0 : -1;
        });
    } catch (...) {
        return -1;
    }
}

extern "C" int lib_dspeak_media_p2p_add_audio_track(lib_dspeak_media_p2p_handle_t* handle,
                                                      lib_dspeak_media_audio_track_t* track) {
    try {
        if (!handle || !handle->pc || !track || !track->track) return -1;
        return handle->signaling_thread->BlockingCall([handle, track] {
            auto result = handle->pc->AddTrack(track->track, {"stream0"});
            return result.ok() ? 0 : -1;
        });
    } catch (...) {
        return -1;
    }
}

extern "C" int lib_dspeak_media_p2p_remove_video_track(lib_dspeak_media_p2p_handle_t* handle,
                                                         lib_dspeak_media_video_track_t* track) {
    try {
        if (!handle || !handle->pc || !track || !track->track) return -1;
        return handle->signaling_thread->BlockingCall([handle, track] {
            auto senders = handle->pc->GetSenders();
            for (auto& sender : senders) {
                if (sender->track() && sender->track()->id() == track->track->id()) {
                    auto error = handle->pc->RemoveTrackOrError(sender);
                    return error.ok() ? 0 : -1;
                }
            }
            return -1;
        });
    } catch (...) {
        return -1;
    }
}

extern "C" int lib_dspeak_media_p2p_remove_audio_track(lib_dspeak_media_p2p_handle_t* handle,
                                                         lib_dspeak_media_audio_track_t* track) {
    try {
        if (!handle || !handle->pc || !track || !track->track) return -1;
        return handle->signaling_thread->BlockingCall([handle, track] {
            auto senders = handle->pc->GetSenders();
            for (auto& sender : senders) {
                if (sender->track() && sender->track()->id() == track->track->id()) {
                    auto error = handle->pc->RemoveTrackOrError(sender);
                    return error.ok() ? 0 : -1;
                }
            }
            return -1;
        });
    } catch (...) {
        return -1;
    }
}

extern "C" int lib_dspeak_media_p2p_set_track_parameters(
    lib_dspeak_media_p2p_handle_t* handle,
    const char* track_id,
    const char* parameters_json) {
    try {
        if (!handle || !handle->pc || !track_id || !parameters_json) return -1;
        const std::string expected_id(track_id);
        const std::string parameters(parameters_json);
        return handle->signaling_thread->BlockingCall([handle, expected_id, parameters] {
            const auto value = json::parse(parameters);
            if (!value.is_object()) return -1;
            for (const auto& sender : handle->pc->GetSenders()) {
                if (!sender->track() || sender->track()->id() != expected_id) continue;
                auto current = sender->GetParameters();
                for (auto& encoding : current.encodings) {
                    if (value.contains("active") && value["active"].is_boolean())
                        encoding.active = value["active"].get<bool>();
                    if (value.contains("maxBitrate") && value["maxBitrate"].is_number_integer())
                        encoding.max_bitrate_bps = value["maxBitrate"].get<int>();
                    if (value.contains("maxFramerate") && value["maxFramerate"].is_number())
                        encoding.max_framerate = value["maxFramerate"].get<double>();
                    if (value.contains("scaleResolutionDownBy") && value["scaleResolutionDownBy"].is_number())
                        encoding.scale_resolution_down_by = value["scaleResolutionDownBy"].get<double>();
                    if (value.contains("priority") && value["priority"].is_string())
                        encoding.bitrate_priority = native_priority_value(value["priority"]);
                    if (value.contains("networkPriority") && value["networkPriority"].is_string())
                        encoding.network_priority = native_priority(value["networkPriority"], webrtc::Priority::kLow);
                }
                return sender->SetParameters(current).ok() ? 0 : -1;
            }
            return -1;
        });
    } catch (...) {
        return -1;
    }
}

extern "C" int lib_dspeak_media_p2p_set_receive_enabled(
    lib_dspeak_media_p2p_handle_t* handle,
    const char* track_id,
    bool enabled) {
    try {
        if (!handle || !handle->signaling_thread || !track_id) return -1;
        const std::string expected_id(track_id);
        return handle->signaling_thread->BlockingCall([handle, expected_id, enabled] {
            for (const auto& sink : handle->audio_sinks) {
                if (sink && expected_id == sink->id()) {
                    sink->SetEnabled(enabled);
                    return 0;
                }
            }
            for (const auto& sink : handle->video_sinks) {
                if (sink && expected_id == sink->id()) {
                    sink->SetEnabled(enabled);
                    return 0;
                }
            }
            return -1;
        });
    } catch (...) {
        return -1;
    }
}

#if defined(__APPLE__)

static std::mutex g_capture_mutex;
static std::mutex g_track_mutex;
static lib_dspeak_media_capture_session* g_capture = nullptr;
static lib_dspeak_media_capture_session* g_system_audio_capture = nullptr;
static bool g_capture_has_video = false;
static bool g_capture_has_audio = false;
static bool g_system_audio_has_audio = false;
static lib_dspeak_media_device_capture_session* g_microphone_capture = nullptr;
static lib_dspeak_media_device_capture_session* g_camera_capture = nullptr;
static lib_dspeak_media_video_track_t* g_video_track = nullptr;
static lib_dspeak_media_audio_track_t* g_audio_track = nullptr;
static lib_dspeak_media_video_track_t* g_camera_track = nullptr;
static lib_dspeak_media_audio_track_t* g_microphone_track = nullptr;
static std::string g_microphone_device_id;
static std::deque<float> g_audio_pending[3];
static std::atomic<int> g_capture_error{0};
static std::atomic<uint64_t> g_probe_video_frames{0};
static std::atomic<uint64_t> g_probe_audio_frames{0};
static std::atomic<bool> g_screen_frame_logged{false};
static std::atomic<bool> g_camera_frame_logged{false};

enum class CaptureRoute {
    kDesktop,
    kMicrophone,
    kCamera,
};

static std::deque<float>& audio_pending_for_route(CaptureRoute route) {
    return g_audio_pending[static_cast<size_t>(route)];
}

static CaptureRoute* capture_route(void* user_data) {
    return static_cast<CaptureRoute*>(user_data);
}

static lib_dspeak_media_video_track_t* video_track_for_route(CaptureRoute route) {
    return route == CaptureRoute::kCamera ? g_camera_track : g_video_track;
}

static lib_dspeak_media_audio_track_t* audio_track_for_route(CaptureRoute route) {
    return route == CaptureRoute::kMicrophone ? g_microphone_track : g_audio_track;
}

static CaptureRoute g_desktop_route = CaptureRoute::kDesktop;
static CaptureRoute g_microphone_route = CaptureRoute::kMicrophone;
static CaptureRoute g_camera_route = CaptureRoute::kCamera;

static void on_screen_frame(void* user_data, void* sample_buffer) {
    CaptureRoute route = user_data ? *capture_route(user_data) : CaptureRoute::kDesktop;
    CMSampleBufferRef sample = static_cast<CMSampleBufferRef>(sample_buffer);
    if (!sample) return;
    std::lock_guard<std::mutex> lock(g_track_mutex);
    lib_dspeak_media_video_track_t* track = video_track_for_route(route);
    if (!track || !track->source) {
        CFRelease(sample);
        return;
    }
    CVPixelBufferRef pixel_buffer = CMSampleBufferGetImageBuffer(sample);
    if (pixel_buffer) {
        if (route == CaptureRoute::kDesktop &&
            !g_screen_frame_logged.exchange(true)) {
            std::fprintf(stderr, "[dspeak:media] native screen frame delivered %zux%zu\n",
                         CVPixelBufferGetWidth(pixel_buffer),
                         CVPixelBufferGetHeight(pixel_buffer));
        }
        if (route == CaptureRoute::kCamera &&
            !g_camera_frame_logged.exchange(true)) {
            std::fprintf(stderr, "[dspeak:media] native camera frame delivered %zux%zu\n",
                         CVPixelBufferGetWidth(pixel_buffer),
                         CVPixelBufferGetHeight(pixel_buffer));
        }
        CMTime pts = CMSampleBufferGetPresentationTimeStamp(sample);
        int64_t timestamp_ms = 0;
        if (pts.timescale > 0) timestamp_ms = (pts.value * 1000) / pts.timescale;
        track->source->OnCapturedFrame(pixel_buffer, timestamp_ms);
        if (route == CaptureRoute::kDesktop) {
            g_probe_video_frames.fetch_add(1);
            dspeak_media_runtime::screen_video_ready.store(true);
        } else if (route == CaptureRoute::kCamera) {
            dspeak_media_runtime::camera_ready.store(true);
        }
    }
    CFRelease(sample);
}

static void on_audio_frame(void* user_data,
                           const float* data,
                           uint32_t frame_count,
                           uint32_t sample_rate,
                           uint8_t channels) {
    CaptureRoute route = user_data ? *capture_route(user_data) : CaptureRoute::kDesktop;
    std::vector<std::vector<float>> chunks;
    NativeAudioSource* source = nullptr;
    webrtc::Thread* audio_thread = nullptr;
    {
        std::lock_guard<std::mutex> lock(g_track_mutex);
        lib_dspeak_media_audio_track_t* track = audio_track_for_route(route);
        if (!track || !track->source || !track->worker_thread || !data || frame_count == 0 ||
            channels != 2 || sample_rate != 48000) return;
        auto& pending = audio_pending_for_route(route);
        pending.insert(pending.end(), data, data + static_cast<size_t>(frame_count) * channels);
        constexpr size_t frames_per_webrtc_audio_frame = 480;
        constexpr size_t samples_per_webrtc_audio_frame = frames_per_webrtc_audio_frame * 2;
        while (pending.size() >= samples_per_webrtc_audio_frame) {
            std::vector<float> chunk(samples_per_webrtc_audio_frame);
            std::copy_n(pending.begin(), samples_per_webrtc_audio_frame, chunk.begin());
            pending.erase(pending.begin(), pending.begin() + samples_per_webrtc_audio_frame);
            chunks.push_back(std::move(chunk));
        }
        source = track->source;
        audio_thread = track->worker_thread;
    }

    const int64_t timestamp_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
    constexpr size_t frames_per_webrtc_audio_frame = 480;
    size_t emitted_frames = 0;
    for (auto& chunk : chunks) {
        webrtc::scoped_refptr<NativeAudioSource> source_ref(source);
        audio_thread->BlockingCall([source_ref, &chunk, sample_rate, channels, timestamp_ms,
                                    emitted_frames, frames_per_webrtc_audio_frame] {
            source_ref->OnCapturedData(
                chunk.data(), 32, sample_rate, channels, frames_per_webrtc_audio_frame,
                timestamp_ms + static_cast<int64_t>(emitted_frames * 1000 / sample_rate));
        });
        emitted_frames += frames_per_webrtc_audio_frame;
    }

    if (!chunks.empty() && route == CaptureRoute::kDesktop) {
        g_probe_audio_frames.fetch_add(1);
        dspeak_media_runtime::screen_audio_ready.store(true);
    } else if (!chunks.empty() && route == CaptureRoute::kMicrophone) {
        dspeak_media_runtime::microphone_ready.store(true);
    }
}

static void on_capture_error(void* user_data, int error_code, const char* message) {
    (void)user_data;
    (void)message;
    g_capture_error.store(error_code);
}

static bool create_capture_tracks(const json& request, int* error_out) {
    const std::string mode = request.value("mode", "");
    const bool capture_video = mode == "video" || mode == "both";
    const bool capture_audio = mode == "audio" || mode == "both";
    if (!capture_video && !capture_audio) {
        if (error_out) *error_out = -101;
        return false;
    }
    std::lock_guard<std::mutex> lock(g_track_mutex);
    const bool created_video = capture_video && !g_video_track;
    if (capture_video && !g_video_track) {
        int error = 0;
        g_video_track = lib_dspeak_media_create_video_track("desktop_capture_video", &error);
        if (!g_video_track) {
            if (error_out) *error_out = error;
            return false;
        }
    }
    if (capture_audio && !g_audio_track) {
        int error = 0;
        g_audio_track = lib_dspeak_media_create_audio_track("desktop_capture_audio", &error);
        if (!g_audio_track) {
            if (created_video && g_video_track) {
                lib_dspeak_media_destroy_video_track(g_video_track);
                g_video_track = nullptr;
            }
            if (error_out) *error_out = error;
            return false;
        }
    }
    return true;
}

static void destroy_capture_tracks(bool video, bool audio) {
    std::lock_guard<std::mutex> lock(g_track_mutex);
    if (video && g_video_track) {
        lib_dspeak_media_destroy_video_track(g_video_track);
        g_video_track = nullptr;
    }
    if (audio && g_audio_track) {
        lib_dspeak_media_destroy_audio_track(g_audio_track);
        g_audio_track = nullptr;
    }
}

static int start_capture_request(const char* request_json, int* error_out) {
    if (error_out) *error_out = 0;
    if (!request_json) {
        if (error_out) *error_out = -101;
        return -1;
    }

    json request;
    try {
        request = json::parse(request_json);
        if (request.contains("captureSelection")) request = request.at("captureSelection");
    } catch (...) {
        if (error_out) *error_out = -101;
        return -1;
    }

    const std::string source_id = request.value("sourceId", "");
    const std::string source_type = request.value("sourceType", "");
    const std::string mode = request.value("mode", "");
    const bool exclude_self_audio = request.value("excludeSelfAudio", false) &&
                                    request.value("excludeSelf", false) &&
                                    request.value("audio", json::object()).value("excludeSelfAudio", false);
    if (source_id.empty() || source_type.empty() || mode.empty() || !exclude_self_audio) {
        if (error_out) *error_out = -101;
        return -1;
    }

    const bool system_audio = source_type == "system-audio";
    const bool capture_video = mode == "video" || mode == "both";
    const bool capture_audio = mode == "audio" || mode == "both";
    const auto video = request.value("video", json::object());
    const auto resolution = video.value("resolution", "original");
    uint32_t video_width = video.value("width", 0u);
    uint32_t video_height = video.value("height", 0u);
    const auto bounds = request.value("bounds", json::object());
    if (video_width == 0 && bounds.is_object()) video_width = bounds.value("width", 0u);
    if (video_height == 0 && bounds.is_object()) video_height = bounds.value("height", 0u);
    if (video_width == 0 || video_height == 0) {
        if (resolution == "720p") {
            video_width = 1280;
            video_height = 720;
        } else if (resolution == "1080p") {
            video_width = 1920;
            video_height = 1080;
        } else if (resolution == "1440p") {
            video_width = 2560;
            video_height = 1440;
        } else if (resolution == "2160p") {
            video_width = 3840;
            video_height = 2160;
        } else {
            video_width = 1920;
            video_height = 1080;
        }
    }
    const uint32_t video_frame_rate = video.value("frameRate", 60u);
    std::lock_guard<std::mutex> capture_lock(g_capture_mutex);
    auto*& capture_slot = system_audio ? g_system_audio_capture : g_capture;
    if (capture_slot) {
        if (error_out) *error_out = -102;
        return -1;
    }
    if ((system_audio && g_capture_has_audio) || (!system_audio && g_system_audio_has_audio)) {
        if (error_out) *error_out = -102;
        return -1;
    }
    if (!create_capture_tracks(request, error_out)) return -1;

    auto* capture = lib_dspeak_media_platform_capture_create(
        source_id.c_str(), source_type.c_str(), mode.c_str(), exclude_self_audio,
        video_width, video_height, video_frame_rate);
    if (!capture) {
        destroy_capture_tracks(capture_video, capture_audio);
        if (error_out) *error_out = -103;
        return -1;
    }

    g_capture_error.store(0);
    g_screen_frame_logged.store(false);
    std::fprintf(stderr,
                 "[dspeak:media] native capture start source=%s type=%s mode=%s video=%ux%u@%u\n",
                 source_id.c_str(), source_type.c_str(), mode.c_str(), video_width,
                 video_height, video_frame_rate);
    int result = lib_dspeak_media_platform_capture_start(
        capture,
        capture_video ? on_screen_frame : nullptr,
        capture_audio ? on_audio_frame : nullptr,
        on_capture_error,
        &g_desktop_route);
    if (result != 0) {
        lib_dspeak_media_platform_capture_destroy(capture);
        destroy_capture_tracks(capture_video, capture_audio);
        if (error_out) *error_out = result;
        return result;
    }
    capture_slot = capture;
    if (system_audio) {
        g_system_audio_has_audio = capture_audio;
    } else {
        g_capture_has_video = capture_video;
        g_capture_has_audio = capture_audio;
    }
    return 0;
}

static int stop_capture_request(int* error_out, bool system_audio = false) {
    if (error_out) *error_out = 0;
    std::lock_guard<std::mutex> capture_lock(g_capture_mutex);
    auto*& capture_slot = system_audio ? g_system_audio_capture : g_capture;
    if (!capture_slot) return 0;
    auto* capture = capture_slot;
    const bool capture_video = system_audio ? false : g_capture_has_video;
    const bool capture_audio = system_audio ? g_system_audio_has_audio : g_capture_has_audio;
    capture_slot = nullptr;
    if (system_audio) {
        g_system_audio_has_audio = false;
    } else {
        g_capture_has_video = false;
        g_capture_has_audio = false;
    }
    lib_dspeak_media_platform_capture_stop(capture);
    lib_dspeak_media_platform_capture_destroy(capture);
    destroy_capture_tracks(capture_video, capture_audio);
    return 0;
}

static int stop_camera_request(int* error_out);

static int start_microphone_request(const char* device_id, int* error_out) {
    if (error_out) *error_out = 0;
    std::lock_guard<std::mutex> capture_lock(g_capture_mutex);
    if (g_microphone_capture) return 0;
    {
        std::lock_guard<std::mutex> track_lock(g_track_mutex);
        if (!g_microphone_track) {
            int error = 0;
            g_microphone_track = lib_dspeak_media_create_audio_track("microphone_capture_audio", &error);
            if (!g_microphone_track) {
                if (error_out) *error_out = error;
                return -1;
            }
        }
    }
    auto* capture = lib_dspeak_media_platform_device_capture_create(
        device_id && device_id[0] ? device_id : nullptr, "microphone");
    if (!capture) {
        fprintf(stderr, "[dspeak:capture] microphone session creation returned null device=%s\\n",
                device_id ?: "<default>");
        std::lock_guard<std::mutex> track_lock(g_track_mutex);
        lib_dspeak_media_destroy_audio_track(g_microphone_track);
        g_microphone_track = nullptr;
        if (error_out) *error_out = -224;
        return -1;
    }
    g_capture_error.store(0);
    int result = lib_dspeak_media_platform_device_capture_start(
        capture, nullptr, on_audio_frame, on_capture_error, &g_microphone_route);
    if (result != 0) {
        lib_dspeak_media_platform_device_capture_destroy(capture);
        std::lock_guard<std::mutex> track_lock(g_track_mutex);
        lib_dspeak_media_destroy_audio_track(g_microphone_track);
        g_microphone_track = nullptr;
        if (error_out) *error_out = result;
        return result;
    }
    g_microphone_capture = capture;
    return 0;
}

static int start_camera_request(const char* device_id, int* error_out) {
    if (error_out) *error_out = 0;
    std::lock_guard<std::mutex> capture_lock(g_capture_mutex);
    if (g_camera_capture) return 0;
    {
        std::lock_guard<std::mutex> track_lock(g_track_mutex);
        if (!g_camera_track) {
            int error = 0;
            g_camera_track = lib_dspeak_media_create_video_track("camera_capture_video", &error);
            if (!g_camera_track) {
                if (error_out) *error_out = error;
                return -1;
            }
            g_camera_track->source->SetScreencast(false);
        }
    }
    auto* capture = lib_dspeak_media_platform_device_capture_create(
        device_id && device_id[0] ? device_id : nullptr, "camera");
    if (!capture) {
        std::lock_guard<std::mutex> track_lock(g_track_mutex);
        lib_dspeak_media_destroy_video_track(g_camera_track);
        g_camera_track = nullptr;
        if (error_out) *error_out = -224;
        return -1;
    }
    g_capture_error.store(0);
    int result = lib_dspeak_media_platform_device_capture_start(
        capture, on_screen_frame, nullptr, on_capture_error, &g_camera_route);
    if (result != 0) {
        lib_dspeak_media_platform_device_capture_destroy(capture);
        std::lock_guard<std::mutex> track_lock(g_track_mutex);
        lib_dspeak_media_destroy_video_track(g_camera_track);
        g_camera_track = nullptr;
        if (error_out) *error_out = result;
        return result;
    }
    g_camera_capture = capture;
    return 0;
}

static int stop_microphone_request(int* error_out) {
    if (error_out) *error_out = 0;
    std::lock_guard<std::mutex> capture_lock(g_capture_mutex);
    if (!g_microphone_capture) {
        std::lock_guard<std::mutex> track_lock(g_track_mutex);
        audio_pending_for_route(CaptureRoute::kMicrophone).clear();
        return 0;
    }
    auto* capture = g_microphone_capture;
    g_microphone_capture = nullptr;
    lib_dspeak_media_platform_device_capture_stop(capture);
    lib_dspeak_media_platform_device_capture_destroy(capture);
    std::lock_guard<std::mutex> track_lock(g_track_mutex);
    if (g_microphone_track) {
        lib_dspeak_media_destroy_audio_track(g_microphone_track);
        g_microphone_track = nullptr;
    }
    audio_pending_for_route(CaptureRoute::kMicrophone).clear();
    return 0;
}

static int stop_camera_request(int* error_out) {
    if (error_out) *error_out = 0;
    std::lock_guard<std::mutex> capture_lock(g_capture_mutex);
    if (!g_camera_capture) return 0;
    auto* capture = g_camera_capture;
    g_camera_capture = nullptr;
    lib_dspeak_media_platform_device_capture_stop(capture);
    lib_dspeak_media_platform_device_capture_destroy(capture);
    std::lock_guard<std::mutex> track_lock(g_track_mutex);
    if (g_camera_track) {
        lib_dspeak_media_destroy_video_track(g_camera_track);
        g_camera_track = nullptr;
    }
    return 0;
}

extern "C" char* lib_dspeak_media_list_capture_devices(void) {
    try {
        return lib_dspeak_media_platform_capture_list_devices();
    } catch (...) {
        return nullptr;
    }

}

extern "C" int lib_dspeak_media_set_microphone_device(const char* device_id, int* error_out) {
    try {
        if (error_out) *error_out = 0;
    bool restart = false;
    {
        std::lock_guard<std::mutex> capture_lock(g_capture_mutex);
        g_microphone_device_id = device_id ? device_id : "";
        restart = g_microphone_capture != nullptr;
    }
    if (restart) {
        int stop_error = 0;
        stop_microphone_request(&stop_error);
        if (stop_error != 0) {
            if (error_out) *error_out = stop_error;
            return -1;
        }
        return start_microphone_request(g_microphone_device_id.c_str(), error_out);
    }
    return 0;
    } catch (...) {
        if (error_out) *error_out = -1;
        return -1;
    }
}

extern "C" int lib_dspeak_media_start_microphone_capture(int* error_out) {
    try {
        return start_microphone_request(g_microphone_device_id.c_str(), error_out);
    } catch (...) {
        if (error_out) *error_out = -1;
        return -1;
    }

}

extern "C" int lib_dspeak_media_stop_microphone_capture(int* error_out) {
    try {
        return stop_microphone_request(error_out);
    } catch (...) {
        if (error_out) *error_out = -1;
        return -1;
    }

}

extern "C" int lib_dspeak_media_start_camera_capture(int* error_out) {
    try {
        return start_camera_request(nullptr, error_out);
    } catch (...) {
        if (error_out) *error_out = -1;
        return -1;
    }

}

extern "C" int lib_dspeak_media_stop_camera_capture(int* error_out) {
    try {
        return stop_camera_request(error_out);
    } catch (...) {
        if (error_out) *error_out = -1;
        return -1;
    }

}

extern "C" char* lib_dspeak_media_list_capture_sources(void) {
    try {
        return lib_dspeak_media_platform_capture_list_sources();
    } catch (...) {
        return nullptr;
    }

}

extern "C" int lib_dspeak_media_start_capture(const char* request_json, int* error_out) {
    try {
        return start_capture_request(request_json, error_out);
    } catch (...) {
        if (error_out) *error_out = -1;
        return -1;
    }

}

extern "C" lib_dspeak_media_video_track_t* lib_dspeak_media_get_active_video_track(void) {
    try {
        std::lock_guard<std::mutex> lock(g_track_mutex);
    return g_camera_track ? g_camera_track : g_video_track;

    } catch (...) {
        return nullptr;
    }
}

extern "C" lib_dspeak_media_audio_track_t* lib_dspeak_media_get_active_audio_track(void) {
    try {
        std::lock_guard<std::mutex> lock(g_track_mutex);
    return g_microphone_track ? g_microphone_track : g_audio_track;

    } catch (...) {
        return nullptr;
    }
}

extern "C" lib_dspeak_media_video_track_t* lib_dspeak_media_get_video_track(const char* source) {
    try {
        std::lock_guard<std::mutex> lock(g_track_mutex);
    if (source && std::strcmp(source, "camera") == 0) return g_camera_track;
    return g_video_track;

    } catch (...) {
        return nullptr;
    }
}

extern "C" lib_dspeak_media_audio_track_t* lib_dspeak_media_get_audio_track(const char* source) {
    try {
        std::lock_guard<std::mutex> lock(g_track_mutex);
    if (source && std::strcmp(source, "audio") == 0) return g_microphone_track;
    return g_audio_track;

    } catch (...) {
        return nullptr;
    }
}

extern "C" int lib_dspeak_media_stop_capture(int* error_out) {
    try {
        return stop_capture_request(error_out);
    } catch (...) {
        if (error_out) *error_out = -1;
        return -1;
    }

}

extern "C" int lib_dspeak_media_probe_capture(int timeout_ms, int* error_out) {
    if (error_out) *error_out = 0;
    if (timeout_ms < 1) timeout_ms = 1;
    char* source_text = lib_dspeak_media_platform_capture_list_sources();
    if (!source_text) {
        if (error_out) *error_out = -301;
        return -1;
    }
    json sources;
    try {
        sources = json::parse(source_text);
    } catch (...) {
        std::free(source_text);
        if (error_out) *error_out = -301;
        return -1;
    }
    std::free(source_text);
    if (!sources.is_array() || sources.empty()) {
        if (error_out) *error_out = -301;
        return -1;
    }

    json selected;
    std::string mode;
    for (const auto& source : sources) {
        const auto capabilities = source.value("capabilities", json::object());
        if (capabilities.value("video", false) && capabilities.value("audio", false)) {
            selected = source;
            mode = "both";
            break;
        }
    }
    if (selected.is_null()) {
        for (const auto& source : sources) {
            const auto capabilities = source.value("capabilities", json::object());
            if (capabilities.value("video", false)) {
                selected = source;
                mode = "video";
                break;
            }
        }
    }
    if (selected.is_null()) {
        for (const auto& source : sources) {
            const auto capabilities = source.value("capabilities", json::object());
            if (capabilities.value("audio", false)) {
                selected = source;
                mode = "audio";
                break;
            }
        }
    }
    if (selected.is_null()) {
        if (error_out) *error_out = -302;
        return -1;
    }

    json request = {
        {"sourceId", selected.value("sourceId", "")},
        {"sourceType", selected.value("sourceType", "")},
        {"mode", mode},
        {"excludeSelf", true},
        {"excludeSelfAudio", true},
        {"audio", {{"excludeSelfAudio", true}}},
    };
    const auto video_before = g_probe_video_frames.load();
    const auto audio_before = g_probe_audio_frames.load();
    int start_error = 0;
    const auto serialized = request.dump();
    if (start_capture_request(serialized.c_str(), &start_error) != 0) {
        if (error_out) *error_out = start_error == 0 ? -303 : start_error;
        return -1;
    }

    const bool needs_video = mode == "video" || mode == "both";
    const bool needs_audio = mode == "audio" || mode == "both";
    bool delivered = false;
    for (int elapsed = 0; elapsed < timeout_ms; elapsed += 10) {
        const bool video_delivered = !needs_video || g_probe_video_frames.load() > video_before;
        const bool audio_delivered = !needs_audio || g_probe_audio_frames.load() > audio_before;
        if (video_delivered && audio_delivered) {
            delivered = true;
            break;
        }
        if (g_capture_error.load() != 0) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    int stop_error = 0;
    stop_capture_request(&stop_error);
    if (g_capture_error.load() != 0) {
        if (error_out) *error_out = g_capture_error.load();
        return -1;
    }
    if (!delivered) {
        if (error_out) *error_out = -304;
        return -1;
    }
    if (stop_error != 0) {
        if (error_out) *error_out = stop_error;
        return -1;
    }
    return 0;
}

extern "C" int lib_dspeak_media_start_screen_capture(uint64_t display_id, int* error_out) {
    json request = {
        {"sourceId", "macos:display:" + std::to_string(static_cast<uint32_t>(display_id))},
        {"sourceType", "display"},
        {"mode", "video"},
        {"excludeSelf", true},
        {"excludeSelfAudio", true},
        {"audio", {{"excludeSelfAudio", true}}},
    };
    const std::string serialized = request.dump();
    return start_capture_request(serialized.c_str(), error_out);
}

extern "C" int lib_dspeak_media_stop_screen_capture(int* error_out) {
    return stop_capture_request(error_out);
}

extern "C" int lib_dspeak_media_start_system_audio_capture(int* error_out) {
    json request = {
        {"sourceId", "macos:system-audio"},
        {"sourceType", "system-audio"},
        {"mode", "audio"},
        {"excludeSelf", true},
        {"excludeSelfAudio", true},
        {"audio", {{"excludeSelfAudio", true}}},
    };
    const std::string serialized = request.dump();
    return start_capture_request(serialized.c_str(), error_out);
}

extern "C" void lib_dspeak_media_stop_system_audio_capture(void) {
    stop_capture_request(nullptr, true);
}

#else

static char* empty_sources() {
    const char value[] = "[]";
    char* result = static_cast<char*>(std::malloc(sizeof(value)));
    if (result) std::memcpy(result, value, sizeof(value));
    return result;
}

extern "C" char* lib_dspeak_media_list_capture_sources(void) {
    return empty_sources();
}

extern "C" char* lib_dspeak_media_list_capture_devices(void) {
    return empty_sources();
}

extern "C" int lib_dspeak_media_set_microphone_device(const char* device_id, int* error_out) {
    (void)device_id;
    if (error_out) *error_out = -100;
    return -1;
}

extern "C" int lib_dspeak_media_start_microphone_capture(int* error_out) {
    if (error_out) *error_out = -100;
    return -1;
}

extern "C" int lib_dspeak_media_stop_microphone_capture(int* error_out) {
    if (error_out) *error_out = 0;
    return 0;
}

extern "C" int lib_dspeak_media_start_camera_capture(int* error_out) {
    if (error_out) *error_out = -100;
    return -1;
}

extern "C" int lib_dspeak_media_stop_camera_capture(int* error_out) {
    if (error_out) *error_out = 0;
    return 0;
}

extern "C" int lib_dspeak_media_start_capture(const char* request_json, int* error_out) {
    (void)request_json;
    if (error_out) *error_out = -100;
    return -1;
}

extern "C" int lib_dspeak_media_stop_capture(int* error_out) {
    if (error_out) *error_out = 0;
    return 0;
}

extern "C" int lib_dspeak_media_probe_capture(int timeout_ms, int* error_out) {
    (void)timeout_ms;
    if (error_out) *error_out = -100;
    return -1;
}

extern "C" lib_dspeak_media_video_track_t* lib_dspeak_media_get_video_track(const char* source) {
    (void)source;
    return nullptr;
}

extern "C" lib_dspeak_media_audio_track_t* lib_dspeak_media_get_audio_track(const char* source) {
    (void)source;
    return nullptr;
}

extern "C" int lib_dspeak_media_start_screen_capture(uint64_t display_id, int* error_out) {
    (void)display_id;
    if (error_out) *error_out = -100;
    return -1;
}

extern "C" int lib_dspeak_media_stop_screen_capture(int* error_out) {
    if (error_out) *error_out = 0;
    return 0;
}

extern "C" int lib_dspeak_media_start_system_audio_capture(int* error_out) {
    if (error_out) *error_out = -100;
    return -1;
}

extern "C" void lib_dspeak_media_stop_system_audio_capture(void) {}

#endif
