#include "lib_dspeak_media/lib_dspeak_media.h"
#include <json.hpp>
#include "capture_state.hpp"
#include "media_handles.hpp"
#include "runtime_health.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>

#if defined(__APPLE__) || defined(_WIN32)
#include "PlatformCapture.h"

using json = nlohmann::json;

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
    if (!capture_slot) {
        std::lock_guard<std::mutex> track_lock(g_track_mutex);
        audio_pending_for_route(CaptureRoute::kDesktop).reset();
        return 0;
    }
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
    {
        std::lock_guard<std::mutex> track_lock(g_track_mutex);
        audio_pending_for_route(CaptureRoute::kDesktop).reset();
    }
    g_shared_audio_level_db.store(-60.0);
    g_shared_audio_level.store(0.0);
    return 0;
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
#if defined(_WIN32)
    const char* platform_prefix = "windows:display:";
#else
    const char* platform_prefix = "macos:display:";
#endif
    json request = {
        {"sourceId", std::string(platform_prefix) +
            std::to_string(display_id)},
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
#if defined(_WIN32)
    const char* platform_prefix = "windows:system-audio";
#else
    const char* platform_prefix = "macos:system-audio";
#endif
    json request = {
        {"sourceId", platform_prefix},
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

#endif
