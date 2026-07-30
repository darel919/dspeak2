#include "lib_dspeak_media/lib_dspeak_media.h"
#include <json.hpp>
#include <api/video/i420_buffer.h>
#include <common_video/libyuv/include/webrtc_libyuv.h>
#include <media/base/adapted_video_track_source.h>
#if defined(__APPLE__)
#include <CoreMedia/CoreMedia.h>
#endif
#include "media_handles.hpp"

#include <atomic>
#include <chrono>
#include <cstdlib>
#include <cstring>
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

extern "C" int lib_dspeak_media_p2p_add_video_track(lib_dspeak_media_p2p_handle_t* handle,
                                                      lib_dspeak_media_video_track_t* track) {
    if (!handle || !handle->pc || !track || !track->track) return -1;
    auto result = handle->pc->AddTrack(track->track, {"stream0"});
    return result.ok() ? 0 : -1;
}

extern "C" int lib_dspeak_media_p2p_add_audio_track(lib_dspeak_media_p2p_handle_t* handle,
                                                      lib_dspeak_media_audio_track_t* track) {
    if (!handle || !handle->pc || !track || !track->track) return -1;
    auto result = handle->pc->AddTrack(track->track, {"stream0"});
    return result.ok() ? 0 : -1;
}

extern "C" int lib_dspeak_media_p2p_remove_video_track(lib_dspeak_media_p2p_handle_t* handle,
                                                         lib_dspeak_media_video_track_t* track) {
    if (!handle || !handle->pc || !track || !track->track) return -1;
    auto senders = handle->pc->GetSenders();
    for (auto& sender : senders) {
        if (sender->track() && sender->track()->id() == track->track->id()) {
            auto error = handle->pc->RemoveTrackOrError(sender);
            return error.ok() ? 0 : -1;
        }
    }
    return -1;
}

extern "C" int lib_dspeak_media_p2p_remove_audio_track(lib_dspeak_media_p2p_handle_t* handle,
                                                         lib_dspeak_media_audio_track_t* track) {
    if (!handle || !handle->pc || !track || !track->track) return -1;
    auto senders = handle->pc->GetSenders();
    for (auto& sender : senders) {
        if (sender->track() && sender->track()->id() == track->track->id()) {
            auto error = handle->pc->RemoveTrackOrError(sender);
            return error.ok() ? 0 : -1;
        }
    }
    return -1;
}

#if defined(__APPLE__)

static std::mutex g_capture_mutex;
static std::mutex g_track_mutex;
static lib_dspeak_media_capture_session* g_capture = nullptr;
static lib_dspeak_media_video_track_t* g_video_track = nullptr;
static lib_dspeak_media_audio_track_t* g_audio_track = nullptr;
static std::atomic<int> g_capture_error{0};
static std::atomic<uint64_t> g_probe_video_frames{0};
static std::atomic<uint64_t> g_probe_audio_frames{0};

static void on_screen_frame(void* user_data, void* sample_buffer) {
    (void)user_data;
    CMSampleBufferRef sample = static_cast<CMSampleBufferRef>(sample_buffer);
    if (!sample) return;
    std::lock_guard<std::mutex> lock(g_track_mutex);
    if (!g_video_track || !g_video_track->source) {
        CFRelease(sample);
        return;
    }
    CVPixelBufferRef pixel_buffer = CMSampleBufferGetImageBuffer(sample);
    if (pixel_buffer) {
        CMTime pts = CMSampleBufferGetPresentationTimeStamp(sample);
        int64_t timestamp_ms = 0;
        if (pts.timescale > 0) timestamp_ms = (pts.value * 1000) / pts.timescale;
        g_video_track->source->OnCapturedFrame(pixel_buffer, timestamp_ms);
        g_probe_video_frames.fetch_add(1);
    }
    CFRelease(sample);
}

static void on_audio_frame(void* user_data,
                           const float* data,
                           uint32_t frame_count,
                           uint32_t sample_rate,
                           uint8_t channels) {
    (void)user_data;
    std::lock_guard<std::mutex> lock(g_track_mutex);
    if (!g_audio_track || !g_audio_track->source || !data || channels != 2 || sample_rate != 48000) return;
    int64_t timestamp_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
    g_audio_track->source->OnCapturedData(data, 32, sample_rate, channels, frame_count, timestamp_ms);
    g_probe_audio_frames.fetch_add(1);
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
    if (capture_video) {
        int error = 0;
        g_video_track = lib_dspeak_media_create_video_track("desktop_capture_video", &error);
        if (!g_video_track) {
            if (error_out) *error_out = error;
            return false;
        }
    }
    if (capture_audio) {
        int error = 0;
        g_audio_track = lib_dspeak_media_create_audio_track("desktop_capture_audio", &error);
        if (!g_audio_track) {
            if (g_video_track) {
                lib_dspeak_media_destroy_video_track(g_video_track);
                g_video_track = nullptr;
            }
            if (error_out) *error_out = error;
            return false;
        }
    }
    return true;
}

static void destroy_capture_tracks() {
    std::lock_guard<std::mutex> lock(g_track_mutex);
    if (g_video_track) {
        lib_dspeak_media_destroy_video_track(g_video_track);
        g_video_track = nullptr;
    }
    if (g_audio_track) {
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

    std::lock_guard<std::mutex> capture_lock(g_capture_mutex);
    if (g_capture) {
        if (error_out) *error_out = -102;
        return -1;
    }
    if (!create_capture_tracks(request, error_out)) return -1;

    auto* capture = lib_dspeak_media_platform_capture_create(
        source_id.c_str(), source_type.c_str(), mode.c_str(), exclude_self_audio);
    if (!capture) {
        destroy_capture_tracks();
        if (error_out) *error_out = -103;
        return -1;
    }

    const bool capture_video = mode == "video" || mode == "both";
    const bool capture_audio = mode == "audio" || mode == "both";
    g_capture_error.store(0);
    int result = lib_dspeak_media_platform_capture_start(
        capture,
        capture_video ? on_screen_frame : nullptr,
        capture_audio ? on_audio_frame : nullptr,
        on_capture_error,
        nullptr);
    if (result != 0) {
        lib_dspeak_media_platform_capture_destroy(capture);
        destroy_capture_tracks();
        if (error_out) *error_out = result;
        return result;
    }
    g_capture = capture;
    return 0;
}

static int stop_capture_request(int* error_out) {
    if (error_out) *error_out = 0;
    std::lock_guard<std::mutex> capture_lock(g_capture_mutex);
    if (!g_capture) return 0;
    auto* capture = g_capture;
    g_capture = nullptr;
    lib_dspeak_media_platform_capture_stop(capture);
    lib_dspeak_media_platform_capture_destroy(capture);
    destroy_capture_tracks();
    return 0;
}

extern "C" char* lib_dspeak_media_list_capture_sources(void) {
    return lib_dspeak_media_platform_capture_list_sources();
}

extern "C" int lib_dspeak_media_start_capture(const char* request_json, int* error_out) {
    return start_capture_request(request_json, error_out);
}

extern "C" lib_dspeak_media_video_track_t* lib_dspeak_media_get_active_video_track(void) {
    std::lock_guard<std::mutex> lock(g_track_mutex);
    return g_video_track;
}

extern "C" lib_dspeak_media_audio_track_t* lib_dspeak_media_get_active_audio_track(void) {
    std::lock_guard<std::mutex> lock(g_track_mutex);
    return g_audio_track;
}

extern "C" int lib_dspeak_media_stop_capture(int* error_out) {
    return stop_capture_request(error_out);
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
    stop_capture_request(nullptr);
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
