#ifndef LIB_DSPEAK_MEDIA_INTERNAL_MEDIA_HANDLES_HPP_
#define LIB_DSPEAK_MEDIA_INTERNAL_MEDIA_HANDLES_HPP_

#include "lib_dspeak_media/lib_dspeak_media.h"
#include <json.hpp>

#include <memory>
#include <algorithm>
#include <array>
#include <atomic>
#include <vector>
#include <mutex>
#include <string>
#include <map>
#include <optional>
#include <cstddef>
#include <media/base/adapted_video_track_source.h>
#include <media/base/audio_source.h>
#include <rtc_base/synchronization/mutex.h>

#if !defined(DSPEAK_MEDIA_WITH_MEDIASOUP)
#define DSPEAK_MEDIA_WITH_MEDIASOUP 1
#endif

#if DSPEAK_MEDIA_WITH_MEDIASOUP
#include <Device.hpp>
#include <Transport.hpp>
#endif
#include <api/media_stream_interface.h>
#include <api/peer_connection_interface.h>
#include <api/data_channel_interface.h>
#include <api/scoped_refptr.h>
#include <rtc_base/thread.h>
#include <api/video/i420_buffer.h>
#include <api/video/video_frame.h>
#include <common_video/libyuv/include/webrtc_libyuv.h>
#include <third_party/libyuv/include/libyuv/convert.h>
#include "receive_render.hpp"
#include "NativeThreadScheduler.h"

class CxxSendListener;
class CxxRecvListener;
class CxxConsumerListener;
class P2pHealthDataChannelObserver;

namespace dspeak_native {
struct SharedTrackFactory;
}

class NativeVideoSource : public webrtc::AdaptedVideoTrackSource {
public:
    explicit NativeVideoSource(const char* track_id)
        : AdaptedVideoTrackSource(0), track_id_(track_id) {}

    webrtc::MediaSourceInterface::SourceState state() const override {
        webrtc::MutexLock lock(&mutex_);
        return state_;
    }

    bool remote() const override { return false; }
    bool is_screencast() const override { return is_screencast_; }
    std::optional<bool> needs_denoising() const override { return std::nullopt; }
    bool GetStats(Stats* stats) override { return false; }

    void SetScreencast(bool value) {
        webrtc::MutexLock lock(&mutex_);
        is_screencast_ = value;
    }

    void OnCapturedFrame(const uint8_t* data,
                         uint32_t width,
                         uint32_t height,
                         uint32_t stride,
                         int64_t timestamp_ms) {
        const bool camera = track_id_.find("camera") != std::string::npos;
        const auto frame = ConvertFrame(data, width, height, stride, timestamp_ms);
        if (!frame) return;
        const char* source = camera ? "camera" : "screen";
        if (lib_dspeak_media_local_video_preview_enabled(source))
            lib_dspeak_media_push_local_video_frame(source, *frame);
        OnFrame(*frame);
    }

    void SetState(webrtc::MediaSourceInterface::SourceState new_state) {
        {
            webrtc::MutexLock lock(&mutex_);
            if (state_ == new_state) return;
            state_ = new_state;
        }
        FireOnChanged();
    }

    const std::string& track_id() const { return track_id_; }

private:
    std::string track_id_;
    mutable webrtc::Mutex mutex_;
    webrtc::MediaSourceInterface::SourceState state_ RTC_GUARDED_BY(mutex_) =
        webrtc::MediaSourceInterface::kLive;
    bool is_screencast_ RTC_GUARDED_BY(mutex_) = true;

    std::optional<webrtc::VideoFrame> ConvertFrame(const uint8_t* data,
                                                    uint32_t width,
                                                    uint32_t height,
                                                    uint32_t stride,
                                                    int64_t timestamp_ms) {
        if (!data || width == 0 || height == 0 || width > 8192 || height > 8192)
            return std::nullopt;
        if (stride < width * 4)
            return std::nullopt;
        const int frame_width = static_cast<int>(width);
        const int frame_height = static_cast<int>(height);

        webrtc::scoped_refptr<webrtc::I420Buffer> i420_buffer =
            webrtc::I420Buffer::Create(frame_width, frame_height);

        const bool valid_input = i420_buffer.get() != nullptr;
        const int conversion_result = valid_input
            ? libyuv::ARGBToI420(
                  data, static_cast<int>(stride),
                  i420_buffer->MutableDataY(), i420_buffer->StrideY(),
                  i420_buffer->MutableDataU(), i420_buffer->StrideU(),
                  i420_buffer->MutableDataV(), i420_buffer->StrideV(),
                  frame_width, frame_height)
            : -1;

        if (conversion_result != 0) return std::nullopt;

        return std::optional<webrtc::VideoFrame>(
            webrtc::VideoFrame::Builder()
                .set_video_frame_buffer(i420_buffer)
                .set_timestamp_ms(timestamp_ms)
                .set_rotation(webrtc::kVideoRotation_0)
                .build());
    }
};

/* ────────────────────────────────────────────────────────────────── */
/* Native Audio Track Source: bridges CoreAudio → libwebrtc          */
/* ────────────────────────────────────────────────────────────────── */

class NativeAudioSource : public webrtc::Notifier<webrtc::AudioSourceInterface> {
public:
    explicit NativeAudioSource(const char* track_id)
        : Notifier<webrtc::AudioSourceInterface>(), track_id_(track_id) {}

    webrtc::MediaSourceInterface::SourceState state() const override {
        webrtc::MutexLock lock(&mutex_);
        return state_;
    }
    bool remote() const override { return false; }

    void SetVolume(double volume) override { (void)volume; }

    void RegisterAudioObserver(
        webrtc::AudioSourceInterface::AudioObserver* observer) override {
        (void)observer;
    }
    void UnregisterAudioObserver(
        webrtc::AudioSourceInterface::AudioObserver* observer) override {
        (void)observer;
    }

    void AddSink(webrtc::AudioTrackSinkInterface* sink) override {
        webrtc::MutexLock lock(&mutex_);
        sinks_.push_back(sink);
    }
    void RemoveSink(webrtc::AudioTrackSinkInterface* sink) override {
        webrtc::MutexLock lock(&mutex_);
        sinks_.erase(
            std::remove(sinks_.begin(), sinks_.end(), sink), sinks_.end());
    }

    const webrtc::AudioOptions options() const override {
        return webrtc::AudioOptions();
    }

    void OnCapturedData(const float* audio_data,
                        int bits_per_sample,
                        int sample_rate,
                        size_t number_of_channels,
                        size_t number_of_frames,
        std::optional<int64_t> absolute_capture_timestamp_ms) {
        const void* output_data = audio_data;
        int output_bps = bits_per_sample;

        if (bits_per_sample == 32) {
            const size_t sample_count = number_of_frames * number_of_channels;
            if (sample_count > capture_conversion_buffer_.size()) return;
            for (size_t i = 0; i < sample_count; ++i) {
                float sample = audio_data[i];
                sample = std::max(-1.0f, std::min(1.0f, sample));
                capture_conversion_buffer_[i] = static_cast<int16_t>(sample * 32767.0f);
            }
            output_data = capture_conversion_buffer_.data();
            output_bps = 16;
        }

        webrtc::MutexLock lock(&mutex_);
        for (auto* sink : sinks_) {
            sink->OnData(output_data, output_bps, sample_rate, number_of_channels,
                         number_of_frames, absolute_capture_timestamp_ms);
        }
    }

    void OnClose() {
        {
            webrtc::MutexLock lock(&mutex_);
            state_ = webrtc::MediaSourceInterface::kEnded;
        }
        FireOnChanged();
    }

    int NumPreferredChannels() const { return 2; }

    const std::string& track_id() const { return track_id_; }

private:
    std::string track_id_;
    mutable webrtc::Mutex mutex_;
    webrtc::MediaSourceInterface::SourceState state_ RTC_GUARDED_BY(mutex_) =
        webrtc::MediaSourceInterface::kLive;
    std::vector<webrtc::AudioTrackSinkInterface*> sinks_ RTC_GUARDED_BY(mutex_);
    std::array<int16_t, 1920> capture_conversion_buffer_{};
};

/* ────────────────────────────────────────────────────────────────── */
/* Opaque handle structs for the C API                                */
/* ────────────────────────────────────────────────────────────────── */

/* ────────────────────────────────────────────────────────────────── */
/* C API: Create/Destroy tracks                                       */
/* ────────────────────────────────────────────────────────────────── */

#if DSPEAK_MEDIA_WITH_MEDIASOUP
struct lib_dspeak_media_device {
    std::unique_ptr<mediasoupclient::Device> device;
    webrtc::scoped_refptr<webrtc::PeerConnectionFactoryInterface> factory;
    webrtc::Thread* network_thread = nullptr;
    webrtc::Thread* signaling_thread = nullptr;
    webrtc::Thread* worker_thread = nullptr;
};

struct lib_dspeak_media_consumer {
    mediasoupclient::Consumer* consumer = nullptr;
    CxxConsumerListener* listener = nullptr;
    std::unique_ptr<NativeReceiveAudioSink> audio_sink;
    std::unique_ptr<NativeReceiveVideoSink> video_sink;
};

struct lib_dspeak_media_send_transport {
    mediasoupclient::SendTransport* transport = nullptr;
    CxxSendListener* listener = nullptr;
};

struct lib_dspeak_media_recv_transport {
    mediasoupclient::RecvTransport* transport = nullptr;
    CxxRecvListener* listener = nullptr;
};
#else
struct lib_dspeak_media_device {};
struct lib_dspeak_media_consumer {};
struct lib_dspeak_media_send_transport {};
struct lib_dspeak_media_recv_transport {};
#endif

struct lib_dspeak_media_video_track {
    NativeVideoSource* source = nullptr;
    webrtc::scoped_refptr<webrtc::PeerConnectionFactoryInterface> factory;
    webrtc::Thread* signaling_thread = nullptr;
    webrtc::Thread* worker_thread = nullptr;
    std::shared_ptr<dspeak_native::SharedTrackFactory> runtime;
    webrtc::scoped_refptr<webrtc::VideoTrackInterface> track;
};

struct lib_dspeak_media_audio_track {
    NativeAudioSource* source = nullptr;
    webrtc::scoped_refptr<webrtc::PeerConnectionFactoryInterface> factory;
    webrtc::Thread* signaling_thread = nullptr;
    webrtc::Thread* worker_thread = nullptr;
    std::shared_ptr<dspeak_native::SharedTrackFactory> runtime;
    webrtc::scoped_refptr<webrtc::AudioTrackInterface> track;
};

struct lib_dspeak_media_p2p_handle {
    webrtc::scoped_refptr<webrtc::PeerConnectionFactoryInterface> factory;
    webrtc::scoped_refptr<webrtc::PeerConnectionInterface> pc;
    webrtc::Thread* network_thread = nullptr;
    webrtc::Thread* signaling_thread = nullptr;
    webrtc::Thread* worker_thread = nullptr;
    std::atomic<uint64_t> event_handle{0};
    std::atomic<bool> connected{false};
    std::atomic<bool> failed{false};
    std::atomic<bool> closed{false};
    bool audio_stereo = false;
    webrtc::scoped_refptr<webrtc::DataChannelInterface> health_channel;
    std::unique_ptr<P2pHealthDataChannelObserver> health_observer;
    std::vector<std::unique_ptr<NativeReceiveAudioSink>> audio_sinks;
    std::vector<std::unique_ptr<NativeReceiveVideoSink>> video_sinks;
    std::map<std::string, webrtc::scoped_refptr<webrtc::RtpReceiverInterface>> audio_receivers;
    std::map<std::string, NativeReceiveAudioSink*> audio_sinks_by_id;
    std::map<std::string, NativeReceiveVideoSink*> video_sinks_by_id;
    webrtc::PeerConnectionObserver* p2p_observer_raw = nullptr;
};

using lib_dspeak_media_json = nlohmann::json;
char* lib_dspeak_media_strdup(const char* value);
lib_dspeak_media_json lib_dspeak_media_json_arg(const char* value);
char* lib_dspeak_media_json_to_cstr(const lib_dspeak_media_json& value);
struct CxxAction {
    lib_dspeak_media_action_kind_t kind;
    void* transport_ptr;
    uint64_t action_id;
    char* params_json;
    char* state;
};

uint64_t lib_dspeak_media_next_action_id();
void lib_dspeak_media_push_action(lib_dspeak_media_action_kind_t kind, void* transport,
                                  uint64_t action_id, const lib_dspeak_media_json* params,
                                  const lib_dspeak_media_json* state);
lib_dspeak_media_action_t lib_dspeak_media_drain_action_impl();




#endif
