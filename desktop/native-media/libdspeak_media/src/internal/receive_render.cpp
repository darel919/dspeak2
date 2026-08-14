#include "receive_render.hpp"
#include "runtime_health.hpp"
#include "event_bridge.hpp"

#include <json.hpp>
#include <api/video/i420_buffer.h>
#include <third_party/libyuv/include/libyuv/convert_argb.h>
#include <third_party/libyuv/include/libyuv/scale.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdlib>
#include <cstdio>
#include <cstring>
#include <deque>
#include <limits>
#include <memory>
#include <mutex>
#include <thread>
#include <utility>

#include "PlatformCapture.h"
#include "../../../platform/AudioSpscRing.hpp"

using json = nlohmann::json;

namespace {

struct ReceiveEvent {
    lib_dspeak_media_receive_event_kind_t kind = LIB_DSPEAK_MEDIA_RECEIVE_EVENT_NONE;
    uint64_t event_id = 0;
    char* id = nullptr;
    char* payload_json = nullptr;
    uint8_t* data = nullptr;
    uint32_t data_len = 0;
};

std::mutex g_receive_event_mutex;
std::deque<ReceiveEvent> g_receive_events;
std::atomic<uint64_t> g_receive_event_id{1};
std::atomic<bool> g_video_frame_logged{false};
std::atomic<bool> g_local_video_frame_logged{false};
std::atomic<bool> g_local_camera_preview_enabled{true};
std::atomic<bool> g_local_screen_preview_enabled{false};
constexpr size_t kMaxReceiveEvents = 96;
constexpr int kLocalPreviewMaxWidth = 640;
constexpr int kLocalPreviewMaxHeight = 360;

bool convert_i420_to_rgba(const uint8_t* data_y,
                          int stride_y,
                          const uint8_t* data_u,
                          int stride_u,
                          const uint8_t* data_v,
                          int stride_v,
                          int width,
                          int height,
                          std::vector<uint8_t>& rgba) {
    if (width <= 0 || height <= 0) return false;
    const size_t width_size = static_cast<size_t>(width);
    const size_t height_size = static_cast<size_t>(height);
    if (width_size > std::numeric_limits<size_t>::max() / height_size / 4)
        return false;
    std::vector<uint8_t> packed_bgra(width_size * height_size * 4);
    if (libyuv::I420ToARGB(
            data_y, stride_y,
            data_u, stride_u,
            data_v, stride_v,
            packed_bgra.data(), width * 4, width, height) != 0)
        return false;
    rgba.resize(packed_bgra.size());
    for (size_t index = 0; index < packed_bgra.size(); index += 4) {
        rgba[index] = packed_bgra[index + 2];
        rgba[index + 1] = packed_bgra[index + 1];
        rgba[index + 2] = packed_bgra[index];
        rgba[index + 3] = packed_bgra[index + 3];
    }
    return true;
}

char* duplicate_string(const char* value) {
    if (!value) return nullptr;
    const size_t length = std::strlen(value);
    auto* copy = static_cast<char*>(std::malloc(length + 1));
    if (!copy) return nullptr;
    std::memcpy(copy, value, length + 1);
    return copy;
}

void release_event(ReceiveEvent& event) {
    std::free(event.id);
    std::free(event.payload_json);
    std::free(event.data);
    event = {};
}

void push_event(lib_dspeak_media_receive_event_kind_t kind,
                const char* id,
                const json& payload,
                const uint8_t* data = nullptr,
                uint32_t data_len = 0) {
    ReceiveEvent event;
    event.kind = kind;
    event.event_id = g_receive_event_id.fetch_add(1);
    event.id = duplicate_string(id);
    const auto serialized = payload.dump();
    event.payload_json = duplicate_string(serialized.c_str());
    if (data && data_len) {
        event.data = static_cast<uint8_t*>(std::malloc(data_len));
        if (!event.data) {
            release_event(event);
            return;
        }
        std::memcpy(event.data, data, data_len);
        event.data_len = data_len;
    }
    std::lock_guard<std::mutex> lock(g_receive_event_mutex);
    if ((kind == LIB_DSPEAK_MEDIA_RECEIVE_EVENT_VIDEO_FRAME ||
         kind == LIB_DSPEAK_MEDIA_RECEIVE_EVENT_LOCAL_VIDEO_FRAME ||
         kind == LIB_DSPEAK_MEDIA_RECEIVE_EVENT_AUDIO_LEVELS) && id) {
        for (auto it = g_receive_events.begin(); it != g_receive_events.end(); ++it) {
            if (it->kind == kind && it->id && std::strcmp(it->id, id) == 0) {
                release_event(*it);
                g_receive_events.erase(it);
                break;
            }
        }
    }
    while (g_receive_events.size() >= kMaxReceiveEvents) {
        release_event(g_receive_events.front());
        g_receive_events.pop_front();
    }
    g_receive_events.push_back(std::move(event));
    lib_dspeak_media_signal_event();
}

bool has_pending_video_frame(
    lib_dspeak_media_receive_event_kind_t kind,
    const char* id) {
    if (!id) return false;
    std::lock_guard<std::mutex> lock(g_receive_event_mutex);
    return std::any_of(
        g_receive_events.begin(),
        g_receive_events.end(),
        [kind, id](const ReceiveEvent& event) {
            return event.kind == kind && event.id && std::strcmp(event.id, id) == 0;
        });
}

}

#if !defined(__APPLE__) && !defined(_WIN32)
extern "C" int lib_dspeak_media_platform_set_output_device(const char*) {
    return -1;
}

extern "C" void* lib_dspeak_media_platform_audio_output_create(const char*) {
    return nullptr;
}

extern "C" void lib_dspeak_media_platform_audio_output_destroy(void*) {}

extern "C" int lib_dspeak_media_platform_audio_output_start(void*) {
    return -1;
}

extern "C" void lib_dspeak_media_platform_audio_output_stop(void*) {}

extern "C" void lib_dspeak_media_platform_audio_output_set_enabled(void*, bool) {}

extern "C" void lib_dspeak_media_platform_audio_output_set_volume(void*, double) {}

extern "C" void lib_dspeak_media_platform_audio_output_set_jitter_buffer(
    void*,
    int,
    int) {}

extern "C" void lib_dspeak_media_platform_audio_output_write(
    void*,
    const float*,
    uint32_t,
    uint32_t,
    uint8_t) {}

extern "C" void lib_dspeak_media_platform_audio_output_get_metrics(
    uint32_t* device_period_frames,
    uint32_t* render_period_frames,
    uint32_t* queue_frames,
    uint64_t* dropped_frames,
    uint32_t* target_frames,
    uint32_t* output_count) {
    if (device_period_frames) *device_period_frames = 0;
    if (render_period_frames) *render_period_frames = 0;
    if (queue_frames) *queue_frames = 0;
    if (dropped_frames) *dropped_frames = 0;
    if (target_frames) *target_frames = 0;
    if (output_count) *output_count = 0;
}
#endif

extern "C" int lib_dspeak_media_set_output_device(const char* device_id) {
    return lib_dspeak_media_platform_set_output_device(device_id);
}

extern "C" void* lib_dspeak_media_audio_output_create(const char* consumer_id) {
    return lib_dspeak_media_platform_audio_output_create(consumer_id);
}

extern "C" void lib_dspeak_media_audio_output_destroy(void* value) {
    lib_dspeak_media_platform_audio_output_destroy(value);
}

extern "C" int lib_dspeak_media_audio_output_start(void* value) {
    return lib_dspeak_media_platform_audio_output_start(value);
}

extern "C" void lib_dspeak_media_audio_output_stop(void* value) {
    lib_dspeak_media_platform_audio_output_stop(value);
}

extern "C" void lib_dspeak_media_audio_output_set_enabled(void* value, bool enabled) {
    lib_dspeak_media_platform_audio_output_set_enabled(value, enabled);
}

extern "C" void lib_dspeak_media_audio_output_set_volume(void* value, double volume) {
    lib_dspeak_media_platform_audio_output_set_volume(value, volume);
}

extern "C" void lib_dspeak_media_audio_output_set_jitter_buffer(
    void* value,
    int min_delay_ms,
    int target_delay_ms) {
    lib_dspeak_media_platform_audio_output_set_jitter_buffer(
        value, min_delay_ms, target_delay_ms);
}

extern "C" void lib_dspeak_media_audio_output_write(void* value,
                                                       const float* samples,
                                                       uint32_t frame_count,
                                                       uint32_t sample_rate,
                                                       uint8_t channels) {
    lib_dspeak_media_platform_audio_output_write(
        value, samples, frame_count, sample_rate, channels);
}

extern "C" int lib_dspeak_media_set_local_video_preview(
    const char* source,
    bool enabled) {
    if (!source) return -1;
    if (std::strcmp(source, "camera") == 0) {
        g_local_camera_preview_enabled.store(enabled, std::memory_order_release);
        return 0;
    }
    if (std::strcmp(source, "screen") == 0) {
        g_local_screen_preview_enabled.store(enabled, std::memory_order_release);
        return 0;
    }
    return -1;
}

extern "C" bool lib_dspeak_media_local_video_preview_enabled(const char* source) {
    if (!source) return false;
    if (std::strcmp(source, "camera") == 0)
        return g_local_camera_preview_enabled.load(std::memory_order_acquire);
    if (std::strcmp(source, "screen") == 0)
        return g_local_screen_preview_enabled.load(std::memory_order_acquire);
    return false;
}

struct NativeAudioConsumerState {
    StereoAudioSpscRing<9600> samples;
    std::atomic<double> volume{1.0};
    std::atomic<bool> enabled{true};
    std::atomic<uint32_t> target_frames{0};
    std::atomic<bool> primed{true};
};

namespace {

constexpr uint32_t kNativeAudioSampleRate = 48000;
constexpr uint32_t kNativeAudioMixFrames = 480;
constexpr size_t kNativeAudioMaxQueueFrames = 9600;
constexpr int kNativeAudioMixerPeriodMs = 10;
constexpr int kNativePlatformPlayoutTargetMs = 10;

class NativeAudioMixer final {
public:
    ~NativeAudioMixer() {
        std::thread thread;
        void* output = nullptr;
        {
            std::lock_guard<std::mutex> lifecycle_lock(lifecycle_mutex_);
            std::lock_guard<std::mutex> lock(mutex_);
            stop_requested_.store(true, std::memory_order_release);
            wake_.notify_one();
            thread = std::move(mixer_thread_);
            output = output_;
            output_ = nullptr;
            consumers_.clear();
        }
        if (thread.joinable()) thread.join();
        if (output) {
            lib_dspeak_media_audio_output_stop(output);
            lib_dspeak_media_audio_output_destroy(output);
        }
    }

    std::shared_ptr<NativeAudioConsumerState> add_consumer() {
        std::lock_guard<std::mutex> lifecycle_lock(lifecycle_mutex_);
        auto state = std::make_shared<NativeAudioConsumerState>();
        std::lock_guard<std::mutex> lock(mutex_);
        if (consumers_.empty()) {
            output_ = lib_dspeak_media_audio_output_create("shared-mixer");
            if (!output_) return nullptr;
            lib_dspeak_media_audio_output_set_jitter_buffer(
                output_, 0, kNativePlatformPlayoutTargetMs);
            if (lib_dspeak_media_audio_output_start(output_) != 0) {
                lib_dspeak_media_audio_output_destroy(output_);
                output_ = nullptr;
                return nullptr;
            }
            stop_requested_.store(false, std::memory_order_release);
            mixer_thread_ = std::thread(&NativeAudioMixer::run, this);
        }
        consumers_.push_back(state);
        wake_.notify_one();
        return state;
    }

    void remove_consumer(const std::shared_ptr<NativeAudioConsumerState>& state) {
        if (!state) return;
        std::lock_guard<std::mutex> lifecycle_lock(lifecycle_mutex_);
        std::thread thread;
        void* output = nullptr;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            consumers_.erase(
                std::remove(consumers_.begin(), consumers_.end(), state),
                consumers_.end());
            if (!consumers_.empty()) return;
            stop_requested_.store(true, std::memory_order_release);
            wake_.notify_one();
            thread = std::move(mixer_thread_);
            output = output_;
            output_ = nullptr;
        }
        if (thread.joinable()) thread.join();
        if (output) {
            lib_dspeak_media_audio_output_stop(output);
            lib_dspeak_media_audio_output_destroy(output);
        }
    }

private:
    void run() {
        std::array<float, kNativeAudioMixFrames * 2> mixed{};
        while (!stop_requested_.load(std::memory_order_acquire)) {
            const auto started = std::chrono::steady_clock::now();
            void* output = nullptr;
            {
                std::unique_lock<std::mutex> lock(mutex_);
                if (consumers_.empty()) {
                    wake_.wait_for(
                        lock,
                        std::chrono::milliseconds(kNativeAudioMixerPeriodMs),
                        [this] {
                            return stop_requested_.load(std::memory_order_acquire) ||
                                   !consumers_.empty();
                        });
                    continue;
                }
                output = output_;
                mixed.fill(0.0f);
                for (const auto& state : consumers_) mix_consumer(*state, mixed);
                for (float& sample : mixed)
                    sample = std::clamp(sample, -1.0f, 1.0f);
            }
            if (output)
                lib_dspeak_media_audio_output_write(
                    output, mixed.data(), kNativeAudioMixFrames,
                    kNativeAudioSampleRate, 2);
            const auto elapsed = std::chrono::steady_clock::now() - started;
            const auto period = std::chrono::milliseconds(kNativeAudioMixerPeriodMs);
            if (elapsed < period) {
                std::unique_lock<std::mutex> lock(mutex_);
                wake_.wait_for(lock, period - elapsed, [this] {
                    return stop_requested_.load(std::memory_order_acquire);
                });
            }
        }
    }

    static void mix_consumer(
        NativeAudioConsumerState& state,
        std::array<float, kNativeAudioMixFrames * 2>& mixed) {
        if (!state.enabled.load(std::memory_order_acquire)) {
            state.samples.reset();
            state.primed.store(
                state.target_frames.load(std::memory_order_acquire) == 0,
                std::memory_order_release);
            return;
        }
        const size_t queued = state.samples.available();
        if (queued > kNativeAudioMaxQueueFrames)
            state.samples.discard(queued - kNativeAudioMaxQueueFrames);
        const uint32_t target = state.target_frames.load(std::memory_order_acquire);
        if (!state.primed.load(std::memory_order_acquire)) {
            if (state.samples.available() < target) return;
            state.primed.store(true, std::memory_order_release);
        }
        const float volume = static_cast<float>(
            state.volume.load(std::memory_order_relaxed));
        bool underflow = false;
        for (uint32_t frame = 0; frame < kNativeAudioMixFrames; ++frame) {
            StereoAudioSpscRing<9600>::Frame sample;
            if (!state.samples.pop(sample)) {
                underflow = true;
                break;
            }
            mixed[static_cast<size_t>(frame) * 2] += sample.left * volume;
            mixed[static_cast<size_t>(frame) * 2 + 1] += sample.right * volume;
        }
        if (underflow) state.primed.store(false, std::memory_order_release);
    }

    std::mutex lifecycle_mutex_;
    std::mutex mutex_;
    std::condition_variable wake_;
    std::vector<std::shared_ptr<NativeAudioConsumerState>> consumers_;
    std::thread mixer_thread_;
    std::atomic<bool> stop_requested_{false};
    void* output_ = nullptr;
};

NativeAudioMixer& native_audio_mixer() {
    static NativeAudioMixer mixer;
    return mixer;
}

}

NativeReceiveAudioSink::NativeReceiveAudioSink(std::string consumer_id)
    : consumer_id_(std::move(consumer_id)),
      state_(native_audio_mixer().add_consumer()) {}

NativeReceiveAudioSink::~NativeReceiveAudioSink() {
    native_audio_mixer().remove_consumer(state_);
    state_.reset();
}

void NativeReceiveAudioSink::OnData(const void* audio_data,
                                    int bits_per_sample,
                                    int sample_rate,
                                    size_t number_of_channels,
                                    size_t number_of_frames,
                                    std::optional<int64_t>) {
    if (!state_ || !audio_data || sample_rate != 48000 || number_of_channels == 0 ||
        number_of_channels > 2 || number_of_frames == 0) return;
    const size_t sample_count = number_of_frames * number_of_channels;
    if (sample_count > samples_.size()) return;
    if (bits_per_sample == 32) {
        const auto* source = static_cast<const float*>(audio_data);
        std::copy(source, source + sample_count, samples_.begin());
    } else if (bits_per_sample == 16) {
        const auto* source = static_cast<const int16_t*>(audio_data);
        for (size_t index = 0; index < sample_count; ++index)
            samples_[index] = static_cast<float>(source[index]) / 32768.0f;
    } else {
        return;
    }
    for (size_t frame = 0; frame < number_of_frames; ++frame) {
        const float left = samples_[frame * number_of_channels];
        const float right = number_of_channels > 1
            ? samples_[frame * number_of_channels + 1]
            : left;
        state_->samples.push(left, right);
    }
    dspeak_media_runtime::audio_receive_ready.store(true);
}

void NativeReceiveAudioSink::SetEnabled(bool enabled) {
    if (!state_) return;
    state_->enabled.store(enabled, std::memory_order_release);
    if (!enabled) state_->samples.reset();
}

void NativeReceiveAudioSink::SetVolume(double volume) {
    if (state_)
        state_->volume.store(std::clamp(volume, 0.0, 2.0), std::memory_order_release);
}

void NativeReceiveAudioSink::SetJitterBuffer(int min_delay_ms, int target_delay_ms) {
    if (!state_) return;
    const int effective_delay_ms = std::min(
        200, std::max(0, std::max(min_delay_ms, target_delay_ms)));
    state_->target_frames.store(
        static_cast<uint32_t>(effective_delay_ms * kNativeAudioSampleRate / 1000),
        std::memory_order_release);
    state_->primed.store(effective_delay_ms == 0, std::memory_order_release);
}

NativeReceiveVideoSink::NativeReceiveVideoSink(std::string consumer_id, std::string handle)
    : consumer_id_(std::move(consumer_id)), handle_(std::move(handle)) {}

void NativeReceiveVideoSink::OnFrame(const webrtc::VideoFrame& frame) {
    if (!enabled_ || has_pending_video_frame(
            LIB_DSPEAK_MEDIA_RECEIVE_EVENT_VIDEO_FRAME, consumer_id_.c_str()))
        return;
    const auto buffer = frame.video_frame_buffer()->ToI420();
    if (!buffer) return;
    const int width = buffer->width();
    const int height = buffer->height();
    if (width <= 0 || height <= 0 || width > 8192 || height > 8192) return;
    std::vector<uint8_t> rgba;
    if (!convert_i420_to_rgba(
            buffer->DataY(), buffer->StrideY(),
            buffer->DataU(), buffer->StrideU(),
            buffer->DataV(), buffer->StrideV(),
            width, height, rgba))
        return;
    json payload = {
        {"consumerId", consumer_id_},
        {"width", width},
        {"height", height},
        {"timestamp", frame.timestamp_us()},
        {"timestampMs", frame.timestamp_us() / 1000},
        {"pixelFormat", "rgba"},
    };
    if (!handle_.empty()) payload["handle"] = handle_;
    push_event(
        LIB_DSPEAK_MEDIA_RECEIVE_EVENT_VIDEO_FRAME,
        consumer_id_.c_str(),
        payload,
        rgba.data(),
        static_cast<uint32_t>(rgba.size()));
    if (!g_video_frame_logged.exchange(true))
        std::fprintf(stderr, "[dspeak:media] native video frame received consumer=%s size=%dx%d\n",
                     consumer_id_.c_str(), width, height);
    dspeak_media_runtime::video_receive_ready.store(true);
}

void NativeReceiveVideoSink::SetEnabled(bool enabled) {
    enabled_ = enabled;
}

extern "C" void lib_dspeak_media_push_local_video_frame(const char* source,
                                                          const webrtc::VideoFrame& frame) {
    if (!source || !lib_dspeak_media_local_video_preview_enabled(source)) return;
    const auto input = frame.video_frame_buffer()->ToI420();
    if (!input) return;
    const int input_width = input->width();
    const int input_height = input->height();
    if (input_width <= 0 || input_height <= 0) return;

    const double scale = std::min(
        1.0,
        std::min(static_cast<double>(kLocalPreviewMaxWidth) / input_width,
                 static_cast<double>(kLocalPreviewMaxHeight) / input_height));
    int width = std::max(2, static_cast<int>(input_width * scale) & ~1);
    int height = std::max(2, static_cast<int>(input_height * scale) & ~1);
    width = std::min(width, kLocalPreviewMaxWidth);
    height = std::min(height, kLocalPreviewMaxHeight);

    const auto scaled = webrtc::I420Buffer::Create(width, height);
    if (libyuv::I420Scale(input->DataY(), input->StrideY(),
                          input->DataU(), input->StrideU(),
                          input->DataV(), input->StrideV(),
                          input_width, input_height,
                          scaled->MutableDataY(), scaled->StrideY(),
                          scaled->MutableDataU(), scaled->StrideU(),
                          scaled->MutableDataV(), scaled->StrideV(),
                          width, height, libyuv::kFilterBox) != 0)
        return;

    std::vector<uint8_t> rgba;
    if (!convert_i420_to_rgba(
            scaled->DataY(), scaled->StrideY(),
            scaled->DataU(), scaled->StrideU(),
            scaled->DataV(), scaled->StrideV(),
            width, height, rgba))
        return;
    push_event(
        LIB_DSPEAK_MEDIA_RECEIVE_EVENT_LOCAL_VIDEO_FRAME,
        source,
        {
            {"source", source},
            {"width", width},
            {"height", height},
            {"timestamp", frame.timestamp_us()},
            {"timestampMs", frame.timestamp_us() / 1000},
            {"pixelFormat", "rgba"},
        },
        rgba.data(),
        static_cast<uint32_t>(rgba.size()));
    if (!g_local_video_frame_logged.exchange(true))
        std::fprintf(stderr, "[dspeak:media] native local video frame source=%s size=%dx%d\n",
                     source ? source : "", width, height);
}

extern "C" void lib_dspeak_media_push_capture_error_event(const char* route,
                                                             int error_code,
                                                             const char* message) {
    push_event(
        LIB_DSPEAK_MEDIA_RECEIVE_EVENT_CAPTURE_ERROR,
        route,
        {
            {"route", route ? route : ""},
            {"errorCode", error_code},
            {"message", message ? message : "Native capture failed"},
        });
}

extern "C" void lib_dspeak_media_push_audio_levels_event(const char* payload_json) {
    if (!payload_json) return;
    try {
        const auto payload = json::parse(payload_json);
        push_event(LIB_DSPEAK_MEDIA_RECEIVE_EVENT_AUDIO_LEVELS, "audio-levels", payload);
    } catch (...) {}
}

extern "C" void lib_dspeak_media_push_receive_track_event(const char* event_name,
                                                            const char* consumer_id,
                                                            const char* producer_id,
                                                            const char* kind,
                                                            const char* app_data_json) {
    json payload = {
        {"event", event_name ? event_name : "consumer-created"},
        {"consumerId", consumer_id ? consumer_id : ""},
        {"producerId", producer_id ? producer_id : ""},
        {"kind", kind ? kind : ""},
        {"native", true},
        {"playback", kind && std::strcmp(kind, "audio") == 0 ? "coreaudio" : "native-frame"},
    };
    if (app_data_json) {
        try {
            const auto app_data = json::parse(app_data_json);
            if (app_data.is_object())
                for (const auto& [key, value] : app_data.items()) payload[key] = value;
        } catch (...) {}
    }
    push_event(LIB_DSPEAK_MEDIA_RECEIVE_EVENT_TRACK, consumer_id, payload);
}

extern "C" void lib_dspeak_media_push_receive_track_closed_event(const char* consumer_id,
                                                                   const char* producer_id,
                                                                   const char* kind) {
    push_event(LIB_DSPEAK_MEDIA_RECEIVE_EVENT_TRACK_CLOSED, consumer_id, {
        {"event", "consumer-closed"},
        {"consumerId", consumer_id ? consumer_id : ""},
        {"producerId", producer_id ? producer_id : ""},
        {"kind", kind ? kind : ""},
    });
}

extern "C" void lib_dspeak_media_push_p2p_event(uint64_t p2p_handle,
                                                 const char* event_name,
                                                 const char* track_id,
                                                 const char* kind,
                                                 const char* value) {
    json payload = {
        {"event", event_name ? event_name : "p2p-event"},
        {"handle", p2p_handle},
        {"trackId", track_id ? track_id : ""},
        {"kind", kind ? kind : ""},
        {"value", value ? value : ""},
        {"native", true},
    };
    if (value) {
        try {
            const auto metadata = json::parse(value);
            if (metadata.is_object())
                for (const auto& [key, item] : metadata.items()) payload[key] = item;
        } catch (...) {}
    }
    push_event(LIB_DSPEAK_MEDIA_RECEIVE_EVENT_P2P, track_id, payload);
}

extern "C" lib_dspeak_media_receive_event_t lib_dspeak_media_drain_receive_event(void) {
    std::lock_guard<std::mutex> lock(g_receive_event_mutex);
    if (g_receive_events.empty())
        return {LIB_DSPEAK_MEDIA_RECEIVE_EVENT_NONE, 0, nullptr, nullptr, nullptr, 0};
    ReceiveEvent event = std::move(g_receive_events.front());
    g_receive_events.pop_front();
    return {
        event.kind,
        event.event_id,
        event.id,
        event.payload_json,
        event.data,
        event.data_len,
    };
}

extern "C" void lib_dspeak_media_free_receive_event(lib_dspeak_media_receive_event_t* event) {
    if (!event) return;
    std::free(event->id);
    std::free(event->payload_json);
    std::free(event->data);
    *event = {};
}
