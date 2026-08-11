#include "receive_render.hpp"
#include "runtime_health.hpp"

#include <json.hpp>
#include <api/video/i420_buffer.h>
#include <common_video/libyuv/include/webrtc_libyuv.h>
#include <third_party/libyuv/include/libyuv/convert_argb.h>
#include <third_party/libyuv/include/libyuv/scale.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdlib>
#include <cstdio>
#include <cstring>
#include <deque>
#include <limits>
#include <mutex>
#include <utility>

#if defined(__APPLE__)
#include <AudioToolbox/AudioToolbox.h>
#include <CoreAudio/CoreAudioTypes.h>
#endif

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
constexpr size_t kMaxReceiveEvents = 96;
constexpr int kLocalPreviewMaxWidth = 640;
constexpr int kLocalPreviewMaxHeight = 360;

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
         kind == LIB_DSPEAK_MEDIA_RECEIVE_EVENT_LOCAL_VIDEO_FRAME) && id) {
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
}

#if defined(__APPLE__)
struct AudioOutput {
    AudioUnit unit = nullptr;
    std::mutex mutex;
    std::deque<float> samples;
    double volume = 1.0;
    bool enabled = true;
    bool running = false;
    uint32_t sample_rate = 48000;
    uint8_t channels = 2;
};

OSStatus render_audio(void* user_data,
                      AudioUnitRenderActionFlags*,
                      const AudioTimeStamp*,
                      UInt32,
                      UInt32 frame_count,
                      AudioBufferList* io_data) {
    auto* output = static_cast<AudioOutput*>(user_data);
    if (!output || !io_data) return noErr;
    std::lock_guard<std::mutex> lock(output->mutex);
    if (!output->enabled) output->samples.clear();
    const bool interleaved = io_data->mNumberBuffers == 1;
    if (interleaved) {
        auto& buffer = io_data->mBuffers[0];
        auto* destination = static_cast<float*>(buffer.mData);
        if (!destination) return noErr;
        const UInt32 channels = buffer.mNumberChannels ? buffer.mNumberChannels : 2;
        for (UInt32 frame = 0; frame < frame_count; ++frame) {
            for (UInt32 channel = 0; channel < channels; ++channel) {
                float value = 0.0f;
                if (output->enabled && !output->samples.empty()) {
                    value = output->samples.front() * static_cast<float>(output->volume);
                    output->samples.pop_front();
                }
                destination[frame * channels + channel] = value;
            }
        }
        return noErr;
    }
    for (UInt32 frame = 0; frame < frame_count; ++frame) {
        float left = 0.0f;
        float right = 0.0f;
        if (output->enabled && !output->samples.empty()) {
            left = output->samples.front();
            output->samples.pop_front();
            right = output->samples.empty() ? left : output->samples.front();
            if (!output->samples.empty()) output->samples.pop_front();
        }
        for (UInt32 buffer_index = 0; buffer_index < io_data->mNumberBuffers; ++buffer_index) {
            auto& buffer = io_data->mBuffers[buffer_index];
            auto* destination = static_cast<float*>(buffer.mData);
            if (!destination) continue;
            const UInt32 channels = buffer.mNumberChannels ? buffer.mNumberChannels : 1;
            const float value = buffer_index == 0 ? left : right;
            for (UInt32 channel = 0; channel < channels; ++channel)
                destination[frame * channels + channel] = value;
        }
    }
    return noErr;
}
#endif

}

extern "C" void* lib_dspeak_media_audio_output_create(const char*) {
#if defined(__APPLE__)
    auto* output = new(std::nothrow) AudioOutput();
    if (!output) return nullptr;
    AudioComponentDescription description{};
    description.componentType = kAudioUnitType_Output;
    description.componentSubType = kAudioUnitSubType_DefaultOutput;
    description.componentManufacturer = kAudioUnitManufacturer_Apple;
    const AudioComponent component = AudioComponentFindNext(nullptr, &description);
    if (!component || AudioComponentInstanceNew(component, &output->unit) != noErr) {
        delete output;
        return nullptr;
    }
    AudioStreamBasicDescription format{};
    format.mSampleRate = 48000;
    format.mFormatID = kAudioFormatLinearPCM;
    format.mFormatFlags = kAudioFormatFlagsNativeFloatPacked;
    format.mBytesPerPacket = sizeof(float) * 2;
    format.mFramesPerPacket = 1;
    format.mBytesPerFrame = sizeof(float) * 2;
    format.mChannelsPerFrame = 2;
    format.mBitsPerChannel = 32;
    if (AudioUnitSetProperty(output->unit,
                             kAudioUnitProperty_StreamFormat,
                             kAudioUnitScope_Input,
                             0,
                             &format,
                             sizeof(format)) != noErr) {
        AudioComponentInstanceDispose(output->unit);
        delete output;
        return nullptr;
    }
    AURenderCallbackStruct callback{};
    callback.inputProc = render_audio;
    callback.inputProcRefCon = output;
    if (AudioUnitSetProperty(output->unit,
                             kAudioUnitProperty_SetRenderCallback,
                             kAudioUnitScope_Input,
                             0,
                             &callback,
                             sizeof(callback)) != noErr) {
        AudioComponentInstanceDispose(output->unit);
        delete output;
        return nullptr;
    }
    if (AudioUnitInitialize(output->unit) != noErr) {
        AudioComponentInstanceDispose(output->unit);
        delete output;
        return nullptr;
    }
    if (AudioOutputUnitStart(output->unit) != noErr) {
        AudioUnitUninitialize(output->unit);
        AudioComponentInstanceDispose(output->unit);
        delete output;
        return nullptr;
    }
    output->running = true;
    return output;
#else
    return nullptr;
#endif
}

extern "C" void lib_dspeak_media_audio_output_destroy(void* value) {
#if defined(__APPLE__)
    auto* output = static_cast<AudioOutput*>(value);
    if (!output) return;
    if (output->running) AudioOutputUnitStop(output->unit);
    AudioUnitUninitialize(output->unit);
    AudioComponentInstanceDispose(output->unit);
    delete output;
#else
    (void)value;
#endif
}

extern "C" int lib_dspeak_media_audio_output_start(void* value) {
#if defined(__APPLE__)
    auto* output = static_cast<AudioOutput*>(value);
    if (!output) return -1;
    std::lock_guard<std::mutex> lock(output->mutex);
    if (output->running) return 0;
    const auto result = AudioOutputUnitStart(output->unit);
    output->running = result == noErr;
    return result == noErr ? 0 : -1;
#else
    (void)value;
    return -1;
#endif
}

extern "C" void lib_dspeak_media_audio_output_stop(void* value) {
#if defined(__APPLE__)
    auto* output = static_cast<AudioOutput*>(value);
    if (!output) return;
    std::lock_guard<std::mutex> lock(output->mutex);
    if (output->running) AudioOutputUnitStop(output->unit);
    output->running = false;
#else
    (void)value;
#endif
}

extern "C" void lib_dspeak_media_audio_output_set_enabled(void* value, bool enabled) {
#if defined(__APPLE__)
    auto* output = static_cast<AudioOutput*>(value);
    if (!output) return;
    std::lock_guard<std::mutex> lock(output->mutex);
    output->enabled = enabled;
    if (!enabled) output->samples.clear();
#else
    (void)value;
    (void)enabled;
#endif
}

extern "C" void lib_dspeak_media_audio_output_set_volume(void* value, double volume) {
#if defined(__APPLE__)
    auto* output = static_cast<AudioOutput*>(value);
    if (!output) return;
    std::lock_guard<std::mutex> lock(output->mutex);
    output->volume = std::max(0.0, std::min(2.0, volume));
#else
    (void)value;
    (void)volume;
#endif
}

extern "C" void lib_dspeak_media_audio_output_write(void* value,
                                                       const float* samples,
                                                       uint32_t frame_count,
                                                       uint32_t sample_rate,
                                                       uint8_t channels) {
#if defined(__APPLE__)
    auto* output = static_cast<AudioOutput*>(value);
    if (!output || !samples || !frame_count || !channels || sample_rate != 48000) return;
    std::lock_guard<std::mutex> lock(output->mutex);
    output->sample_rate = sample_rate;
    output->channels = channels;
    const size_t source_channels = channels;
    for (uint32_t frame = 0; frame < frame_count; ++frame) {
        const float left = samples[frame * source_channels];
        const float right = source_channels > 1 ? samples[frame * source_channels + 1] : left;
        output->samples.push_back(left);
        output->samples.push_back(right);
    }
    const size_t maximum_samples = 48000 * 2 / 2;
    while (output->samples.size() > maximum_samples) output->samples.pop_front();
#else
    (void)value;
    (void)samples;
    (void)frame_count;
    (void)sample_rate;
    (void)channels;
#endif
}

NativeReceiveAudioSink::NativeReceiveAudioSink(std::string consumer_id)
    : consumer_id_(std::move(consumer_id)),
      output_(lib_dspeak_media_audio_output_create(consumer_id_.c_str())) {}

NativeReceiveAudioSink::~NativeReceiveAudioSink() {
    if (output_) {
        lib_dspeak_media_audio_output_stop(output_);
        lib_dspeak_media_audio_output_destroy(output_);
        output_ = nullptr;
    }
}

void NativeReceiveAudioSink::OnData(const void* audio_data,
                                    int bits_per_sample,
                                    int sample_rate,
                                    size_t number_of_channels,
                                    size_t number_of_frames,
                                    std::optional<int64_t>) {
    if (!output_ || !audio_data || sample_rate != 48000 || number_of_channels == 0 ||
        number_of_channels > 2 || number_of_frames == 0) return;
    std::vector<float> samples(number_of_frames * number_of_channels);
    if (bits_per_sample == 32) {
        const auto* source = static_cast<const float*>(audio_data);
        std::copy(source, source + samples.size(), samples.begin());
    } else if (bits_per_sample == 16) {
        const auto* source = static_cast<const int16_t*>(audio_data);
        for (size_t index = 0; index < samples.size(); ++index)
            samples[index] = static_cast<float>(source[index]) / 32768.0f;
    } else {
        return;
    }
    lib_dspeak_media_audio_output_write(output_, samples.data(),
                                        static_cast<uint32_t>(number_of_frames),
                                        static_cast<uint32_t>(sample_rate),
                                        static_cast<uint8_t>(number_of_channels));
    dspeak_media_runtime::audio_receive_ready.store(true);
}

void NativeReceiveAudioSink::SetEnabled(bool enabled) {
    lib_dspeak_media_audio_output_set_enabled(output_, enabled);
    if (enabled) {
        lib_dspeak_media_audio_output_start(output_);
    } else {
        lib_dspeak_media_audio_output_stop(output_);
    }
}

void NativeReceiveAudioSink::SetVolume(double volume) {
    lib_dspeak_media_audio_output_set_volume(output_, volume);
}

NativeReceiveVideoSink::NativeReceiveVideoSink(std::string consumer_id, std::string handle)
    : consumer_id_(std::move(consumer_id)), handle_(std::move(handle)) {}

void NativeReceiveVideoSink::OnFrame(const webrtc::VideoFrame& frame) {
    if (!enabled_) return;
    const auto buffer = frame.video_frame_buffer()->ToI420();
    if (!buffer) return;
    const int width = buffer->width();
    const int height = buffer->height();
    if (width <= 0 || height <= 0 || width > 8192 || height > 8192) return;
    const size_t width_size = static_cast<size_t>(width);
    const size_t height_size = static_cast<size_t>(height);
    if (width_size > std::numeric_limits<size_t>::max() / height_size / 4)
        return;
    std::vector<uint8_t> rgba(width_size * height_size * 4);
    if (libyuv::I420ToRGBA(buffer->DataY(), buffer->StrideY(),
                           buffer->DataU(), buffer->StrideU(),
                           buffer->DataV(), buffer->StrideV(),
                           rgba.data(), width * 4, width, height) != 0) return;
    json payload = {
        {"consumerId", consumer_id_},
        {"width", width},
        {"height", height},
        {"timestampMs", frame.timestamp_us() / 1000},
        {"pixelFormat", "rgba"},
    };
    if (!handle_.empty()) payload["handle"] = handle_;
    push_event(LIB_DSPEAK_MEDIA_RECEIVE_EVENT_VIDEO_FRAME, consumer_id_.c_str(), payload, rgba.data(),
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

    std::vector<uint8_t> rgba(static_cast<size_t>(width) * height * 4);
    if (libyuv::I420ToRGBA(scaled->DataY(), scaled->StrideY(),
                           scaled->DataU(), scaled->StrideU(),
                           scaled->DataV(), scaled->StrideV(),
                           rgba.data(), width * 4, width, height) != 0)
        return;
    push_event(LIB_DSPEAK_MEDIA_RECEIVE_EVENT_LOCAL_VIDEO_FRAME,
               source,
               {
                   {"source", source ? source : ""},
                   {"width", width},
                   {"height", height},
                   {"timestampMs", frame.timestamp_us() / 1000},
                   {"pixelFormat", "rgba"},
               },
               rgba.data(), static_cast<uint32_t>(rgba.size()));
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
        {"playback", kind && std::strcmp(kind, "audio") == 0 ? "coreaudio" : "canvas"},
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

extern "C" lib_dspeak_media_receive_event_t lib_dspeak_media_poll_receive_event(void) {
    std::lock_guard<std::mutex> lock(g_receive_event_mutex);
    if (g_receive_events.empty())
        return {LIB_DSPEAK_MEDIA_RECEIVE_EVENT_NONE, 0, nullptr, nullptr, nullptr, 0};
    ReceiveEvent event = std::move(g_receive_events.front());
    g_receive_events.pop_front();
    return {event.kind, event.event_id, event.id, event.payload_json, event.data, event.data_len};
}

extern "C" void lib_dspeak_media_free_receive_event(lib_dspeak_media_receive_event_t* event) {
    if (!event) return;
    std::free(event->id);
    std::free(event->payload_json);
    std::free(event->data);
    *event = {};
}
