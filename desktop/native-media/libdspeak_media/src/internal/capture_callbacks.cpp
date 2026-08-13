#include "lib_dspeak_media/lib_dspeak_media.h"
#include "capture_state.hpp"
#include "media_handles.hpp"
#include "runtime_health.hpp"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <mutex>

#if defined(__APPLE__) || defined(_WIN32)

static double audio_dbfs(double rms) {
    if (!std::isfinite(rms) || rms <= 0.000001) return -60.0;
    return std::max(-60.0, std::min(0.0, 20.0 * std::log10(rms)));
}

static double audio_level(double rms) {
    if (!std::isfinite(rms)) return 0.0;
    return std::max(0.0, std::min(1.0, rms * 4.0));
}

void on_screen_frame(void* user_data,
                            const uint8_t* data,
                            uint32_t width,
                            uint32_t height,
                            uint32_t stride,
                            int64_t timestamp_ms) {
    CaptureRoute route = user_data ? *capture_route(user_data) : CaptureRoute::kDesktop;
    if (!data || width == 0 || height == 0 || stride == 0) return;
    std::lock_guard<std::mutex> lock(g_track_mutex);
    lib_dspeak_media_video_track_t* track = video_track_for_route(route);
    if (!track || !track->source) {
        return;
    }
    if (route == CaptureRoute::kDesktop && !g_screen_frame_logged.exchange(true)) {
        std::fprintf(stderr, "[dspeak:media] native screen frame delivered %ux%u\n",
                     width, height);
    }
    if (route == CaptureRoute::kCamera && !g_camera_frame_logged.exchange(true)) {
        std::fprintf(stderr, "[dspeak:media] native camera frame delivered %ux%u\n",
                     width, height);
    }
    track->source->OnCapturedFrame(data, width, height, stride, timestamp_ms);
    if (route == CaptureRoute::kDesktop) {
        g_probe_video_frames.fetch_add(1);
        dspeak_media_runtime::screen_video_ready.store(true);
    } else if (route == CaptureRoute::kCamera) {
        dspeak_media_runtime::camera_ready.store(true);
    }
}

void on_audio_frame(void* user_data,
                           const float* data,
                           uint32_t frame_count,
                           uint32_t sample_rate,
                           uint8_t channels) {
    CaptureRoute route = user_data ? *capture_route(user_data) : CaptureRoute::kDesktop;
    std::unique_lock<std::mutex> track_lock(g_track_mutex);
    lib_dspeak_media_audio_track_t* track = audio_track_for_route(route);
    if (!track || !track->source || !track->worker_thread || !data || frame_count == 0 ||
        channels != 2 || sample_rate != 48000) return;
    double input_sum = 0.0;
    for (size_t index = 0; index < static_cast<size_t>(frame_count) * channels; ++index) {
        const double sample = static_cast<double>(data[index]);
        input_sum += sample * sample;
    }
    const double input_rms = std::sqrt(
        input_sum / std::max<size_t>(1, static_cast<size_t>(frame_count) * channels));
    if (route == CaptureRoute::kMicrophone) {
        g_microphone_level_db.store(audio_dbfs(input_rms));
        if (g_microphone_check_recording.load()) {
            std::lock_guard<std::mutex> check_lock(g_microphone_check_mutex);
            constexpr size_t max_samples = 48'000 * 2 * 15;
            const size_t remaining = g_microphone_check_samples.size() < max_samples
                ? max_samples - g_microphone_check_samples.size()
                : 0;
            const size_t samples_to_copy = std::min(
                remaining, static_cast<size_t>(frame_count) * channels);
            for (size_t index = 0; index < samples_to_copy; ++index) {
                const double sample = std::max(-1.0, std::min(1.0, static_cast<double>(data[index])));
                g_microphone_check_samples.push_back(
                    static_cast<int16_t>(std::lround(sample * 32767.0)));
            }
        }
    }
    auto& pending = audio_pending_for_route(route);
    double attenuation = route == CaptureRoute::kDesktop
        ? g_shared_audio_attenuation_current.load()
        : 1.0;
    const double target = route == CaptureRoute::kDesktop
        ? g_shared_audio_attenuation_target.load()
        : 1.0;
    const int duration_ms = target < attenuation
        ? g_shared_audio_attack_ms.load()
        : g_shared_audio_release_ms.load();
    const double ramp_frames = std::max(
        1.0, static_cast<double>(std::max(0, duration_ms)) * sample_rate / 1000.0);
    const double per_frame = (target - attenuation) / ramp_frames;
    const double base_volume = route == CaptureRoute::kDesktop
        ? g_shared_audio_volume.load()
        : 1.0;
    double output_sum = 0.0;
    for (uint32_t frame = 0; frame < frame_count; ++frame) {
        if (std::abs(target - attenuation) > 0.000001) {
            attenuation = duration_ms <= 0
                ? target
                : attenuation + per_frame;
            if ((per_frame > 0 && attenuation > target) ||
                (per_frame < 0 && attenuation < target))
                attenuation = target;
        } else {
            attenuation = target;
        }
        const float left = static_cast<float>(
            data[static_cast<size_t>(frame) * channels] * base_volume * attenuation);
        const float right = static_cast<float>(
            data[static_cast<size_t>(frame) * channels + 1] * base_volume * attenuation);
        pending.push(left, right);
        output_sum += static_cast<double>(left) * left +
            static_cast<double>(right) * right;
    }
    if (route == CaptureRoute::kDesktop) {
        const double output_rms = std::sqrt(
            output_sum / std::max<size_t>(1, static_cast<size_t>(frame_count) * channels));
        g_shared_audio_level_db.store(audio_dbfs(output_rms));
        g_shared_audio_level.store(audio_level(output_rms));
    }
    if (route == CaptureRoute::kDesktop)
        g_shared_audio_attenuation_current.store(attenuation);
    constexpr size_t frames_per_webrtc_audio_frame = 480;
    std::array<float, frames_per_webrtc_audio_frame * 2> chunk{};
    const int64_t timestamp_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
    size_t emitted_frames = 0;
    while (pending.available() >= frames_per_webrtc_audio_frame) {
        for (size_t frame = 0; frame < frames_per_webrtc_audio_frame; ++frame) {
            CaptureAudioRing::Frame sample;
            if (!pending.pop(sample)) break;
            chunk[frame * 2] = sample.left;
            chunk[frame * 2 + 1] = sample.right;
        }
        const auto source_ref = track->source;
        track->worker_thread->BlockingCall(
            [source_ref, &chunk, sample_rate, channels, timestamp_ms, emitted_frames,
             frames_per_webrtc_audio_frame] {
                source_ref->OnCapturedData(
                    chunk.data(), 32, sample_rate, channels, frames_per_webrtc_audio_frame,
                    timestamp_ms + static_cast<int64_t>(emitted_frames * 1000 / sample_rate));
        });
        emitted_frames += frames_per_webrtc_audio_frame;
    }
    track_lock.unlock();

    if (emitted_frames > 0 && route == CaptureRoute::kDesktop) {
        g_probe_audio_frames.fetch_add(1);
        dspeak_media_runtime::screen_audio_ready.store(true);
    } else if (emitted_frames > 0 && route == CaptureRoute::kMicrophone) {
        dspeak_media_runtime::microphone_ready.store(true);
    }
}

static const char* capture_route_name(CaptureRoute route) {
    switch (route) {
        case CaptureRoute::kMicrophone: return "microphone";
        case CaptureRoute::kCamera: return "camera";
        case CaptureRoute::kDesktop: return "desktop";
    }
    return "unknown";
}

void on_capture_error(void* user_data, int error_code, const char* message) {
    const auto* route = capture_route(user_data);
    g_capture_error.store(error_code);
    lib_dspeak_media_push_capture_error_event(
        route ? capture_route_name(*route) : "unknown", error_code, message);
}


#endif
