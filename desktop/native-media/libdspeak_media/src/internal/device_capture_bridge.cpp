#include "lib_dspeak_media/lib_dspeak_media.h"
#include <json.hpp>
#include "capture_state.hpp"
#include "media_handles.hpp"
#include "runtime_health.hpp"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <string>
#include <vector>

#if defined(__APPLE__) || defined(_WIN32)
#include "PlatformCapture.h"

using json = nlohmann::json;

static int start_microphone_request(const char* device_id, int* error_out) {
    if (error_out) *error_out = 0;
    std::lock_guard<std::mutex> capture_lock(g_capture_mutex);
    if (g_microphone_capture) return 0;
    g_microphone_level_db.store(-60.0);
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
        fprintf(stderr, "[dspeak:capture] microphone session creation returned null device=%s\n",
                device_id ? device_id : "<default>");
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
    const char* requested_device = device_id && device_id[0]
        ? device_id
        : (g_camera_device_id.empty() ? nullptr : g_camera_device_id.c_str());
    auto* capture = lib_dspeak_media_platform_device_capture_create(
        requested_device, "camera");
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
        audio_pending_for_route(CaptureRoute::kMicrophone).reset();
        g_microphone_level_db.store(-60.0);
        g_microphone_check_recording.store(false);
        std::lock_guard<std::mutex> check_lock(g_microphone_check_mutex);
        g_microphone_check_samples.clear();
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
    audio_pending_for_route(CaptureRoute::kMicrophone).reset();
    g_microphone_level_db.store(-60.0);
    g_microphone_check_recording.store(false);
    {
        std::lock_guard<std::mutex> check_lock(g_microphone_check_mutex);
        g_microphone_check_samples.clear();
    }
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

extern "C" int lib_dspeak_media_set_shared_audio_volume(double volume) {
    if (volume != volume) return -1;
    g_shared_audio_volume.store(std::max(0.0, std::min(2.0, volume)));
    return 0;
}

extern "C" int lib_dspeak_media_set_shared_audio_attenuation(
    int enabled,
    double reduction_percent,
    int attack_ms,
    int release_ms) {
    if (!std::isfinite(reduction_percent)) return -1;
    const double reduction = std::max(0.0, std::min(100.0, reduction_percent));
    g_shared_audio_attenuation_target.store(
        enabled ? 1.0 - reduction / 100.0 : 1.0);
    g_shared_audio_attack_ms.store(std::max(0, std::min(10000, attack_ms)));
    g_shared_audio_release_ms.store(std::max(0, std::min(10000, release_ms)));
    return 0;
}

extern "C" char* lib_dspeak_media_get_audio_levels(void) {
    uint32_t device_period_frames = 0;
    uint32_t render_period_frames = 0;
    uint32_t queue_frames = 0;
    uint64_t dropped_frames = 0;
    uint32_t target_frames = 0;
    uint32_t output_count = 0;
    lib_dspeak_media_platform_audio_output_get_metrics(
        &device_period_frames,
        &render_period_frames,
        &queue_frames,
        &dropped_frames,
        &target_frames,
        &output_count);
    json result = {
        {"microphoneDbfs", g_microphone_level_db.load()},
        {"sharedAudioDbfs", g_shared_audio_level_db.load()},
        {"sharedAudioLevel", g_shared_audio_level.load()},
        {"microphoneReady", g_microphone_capture != nullptr},
        {"sharedAudioReady", g_capture != nullptr || g_system_audio_capture != nullptr},
        {"nativeOutputDevicePeriodFrames", device_period_frames},
        {"nativeOutputRenderPeriodFrames", render_period_frames},
        {"nativeOutputQueueDepthFrames", queue_frames},
        {"nativePlayoutTargetFrames", target_frames},
        {"nativeOutputDevicePeriodMs", device_period_frames * 1000.0 / 48000.0},
        {"nativeOutputRenderPeriodMs", render_period_frames * 1000.0 / 48000.0},
        {"nativeOutputQueueDepthMs", queue_frames * 1000.0 / 48000.0},
        {"nativePlayoutTargetMs", target_frames * 1000.0 / 48000.0},
        {"nativeOutputDroppedFrames", dropped_frames},
        {"nativeOutputCount", output_count},
    };
    return lib_dspeak_media_json_to_cstr(result);
}

extern "C" int lib_dspeak_media_start_microphone_check(void) {
    if (!g_microphone_capture) return -225;
    std::lock_guard<std::mutex> check_lock(g_microphone_check_mutex);
    g_microphone_check_samples.clear();
    g_microphone_check_recording.store(true);
    return 0;
}

extern "C" uint8_t* lib_dspeak_media_stop_microphone_check(size_t* length_out) {
    if (length_out) *length_out = 0;
    g_microphone_check_recording.store(false);
    std::vector<int16_t> samples;
    {
        std::lock_guard<std::mutex> check_lock(g_microphone_check_mutex);
        samples.swap(g_microphone_check_samples);
    }
    const size_t payload_size = samples.size() * sizeof(int16_t);
    const size_t total_size = 44 + payload_size;
    if (total_size > UINT32_MAX) return nullptr;
    auto* buffer = static_cast<uint8_t*>(std::malloc(total_size));
    if (!buffer) return nullptr;
    std::memset(buffer, 0, total_size);
    std::memcpy(buffer, "RIFF", 4);
    std::memcpy(buffer + 8, "WAVE", 4);
    std::memcpy(buffer + 12, "fmt ", 4);
    const uint32_t format_size = 16;
    const uint16_t format = 1;
    const uint16_t channels = 2;
    const uint32_t sample_rate = 48000;
    const uint16_t bits_per_sample = 16;
    const uint16_t block_align = channels * sizeof(int16_t);
    const uint32_t byte_rate = sample_rate * block_align;
    const uint32_t data_size = static_cast<uint32_t>(payload_size);
    const uint32_t riff_size = 36 + data_size;
    std::memcpy(buffer + 4, &riff_size, sizeof(riff_size));
    std::memcpy(buffer + 16, &format_size, sizeof(format_size));
    std::memcpy(buffer + 20, &format, sizeof(format));
    std::memcpy(buffer + 22, &channels, sizeof(channels));
    std::memcpy(buffer + 24, &sample_rate, sizeof(sample_rate));
    std::memcpy(buffer + 28, &byte_rate, sizeof(byte_rate));
    std::memcpy(buffer + 32, &block_align, sizeof(block_align));
    std::memcpy(buffer + 34, &bits_per_sample, sizeof(bits_per_sample));
    std::memcpy(buffer + 36, "data", 4);
    std::memcpy(buffer + 40, &data_size, sizeof(data_size));
    if (payload_size > 0) std::memcpy(buffer + 44, samples.data(), payload_size);
    if (length_out) *length_out = total_size;
    return buffer;
}

extern "C" void lib_dspeak_media_free_buffer(uint8_t* buffer) {
    std::free(buffer);
}

extern "C" int lib_dspeak_media_set_camera_device(const char* device_id, int* error_out) {
    try {
        if (error_out) *error_out = 0;
        bool restart = false;
        {
            std::lock_guard<std::mutex> capture_lock(g_capture_mutex);
            g_camera_device_id = device_id ? device_id : "";
            restart = g_camera_capture != nullptr;
        }
        if (restart) {
            int stop_error = 0;
            stop_camera_request(&stop_error);
            if (stop_error != 0) {
                if (error_out) *error_out = stop_error;
                return -1;
            }
            return start_camera_request(g_camera_device_id.c_str(), error_out);
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


#endif
