#ifndef LIB_DSPEAK_MEDIA_INTERNAL_MEDIA_HANDLES_HPP_
#define LIB_DSPEAK_MEDIA_INTERNAL_MEDIA_HANDLES_HPP_

#include "lib_dspeak_media/lib_dspeak_media.h"
#include <json.hpp>

#include <memory>
#include <vector>
#include <mutex>
#include <queue>
#include <string>
#include <optional>
#include <cstddef>
#include <media/base/adapted_video_track_source.h>
#include <media/base/audio_source.h>
#include <rtc_base/synchronization/mutex.h>

#include <Device.hpp>
#include <Transport.hpp>
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

#if defined(__APPLE__)
#include <CoreVideo/CoreVideo.h>
#else
using CVPixelBufferRef = void*;
#endif

class CxxSendListener;
class CxxRecvListener;
class CxxConsumerListener;
class P2pHealthDataChannelObserver;

#if defined(__APPLE__)
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

    void OnCapturedFrame(CVPixelBufferRef pixel_buffer, int64_t timestamp_ms) {
        webrtc::VideoFrame frame = ConvertPixelBuffer(pixel_buffer, timestamp_ms);
        OnFrame(frame);
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

    webrtc::VideoFrame ConvertPixelBuffer(CVPixelBufferRef pb, int64_t timestamp_ms) {
        size_t width = CVPixelBufferGetWidth(pb);
        size_t height = CVPixelBufferGetHeight(pb);

        CVPixelBufferLockBaseAddress(pb, kCVPixelBufferLock_ReadOnly);
        void* base_addr = CVPixelBufferGetBaseAddress(pb);
        size_t bytes_per_row = CVPixelBufferGetBytesPerRow(pb);

        webrtc::scoped_refptr<webrtc::I420Buffer> i420_buffer =
            webrtc::I420Buffer::Create(width, height);

        if (base_addr) {
            libyuv::BGRAToI420(
                static_cast<const uint8_t*>(base_addr),
                bytes_per_row,
                i420_buffer->MutableDataY(), i420_buffer->StrideY(),
                i420_buffer->MutableDataU(), i420_buffer->StrideU(),
                i420_buffer->MutableDataV(), i420_buffer->StrideV(),
                width, height);
        }

        CVPixelBufferUnlockBaseAddress(pb, kCVPixelBufferLock_ReadOnly);

        return webrtc::VideoFrame::Builder()
            .set_video_frame_buffer(i420_buffer)
            .set_timestamp_ms(timestamp_ms)
            .set_rotation(webrtc::kVideoRotation_0)
            .build();
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
        std::vector<int16_t> int16_data;
        const void* output_data = audio_data;
        int output_bps = bits_per_sample;

        if (bits_per_sample == 32) {
            int16_data.resize(number_of_frames * number_of_channels);
            for (size_t i = 0; i < number_of_frames * number_of_channels; ++i) {
                float sample = audio_data[i];
                sample = std::max(-1.0f, std::min(1.0f, sample));
                int16_data[i] = static_cast<int16_t>(sample * 32767.0f);
            }
            output_data = int16_data.data();
            output_bps = 16;
        }

        std::vector<webrtc::AudioTrackSinkInterface*> sinks_copy;
        {
            webrtc::MutexLock lock(&mutex_);
            sinks_copy = sinks_;
        }

        for (auto* sink : sinks_copy) {
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
};

#endif

/* ────────────────────────────────────────────────────────────────── */
/* Opaque handle structs for the C API                                */
/* ────────────────────────────────────────────────────────────────── */

/* ────────────────────────────────────────────────────────────────── */
/* C API: Create/Destroy tracks                                       */
/* ────────────────────────────────────────────────────────────────── */

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

struct lib_dspeak_media_video_track {
#if defined(__APPLE__)
    NativeVideoSource* source = nullptr;
#endif
    webrtc::scoped_refptr<webrtc::PeerConnectionFactoryInterface> factory;
    webrtc::Thread* signaling_thread = nullptr;
    webrtc::Thread* worker_thread = nullptr;
    webrtc::scoped_refptr<webrtc::VideoTrackInterface> track;
};

struct lib_dspeak_media_audio_track {
#if defined(__APPLE__)
    NativeAudioSource* source = nullptr;
#endif
    webrtc::scoped_refptr<webrtc::PeerConnectionFactoryInterface> factory;
    webrtc::Thread* signaling_thread = nullptr;
    webrtc::Thread* worker_thread = nullptr;
    webrtc::scoped_refptr<webrtc::AudioTrackInterface> track;
};

struct lib_dspeak_media_p2p_handle {
    webrtc::scoped_refptr<webrtc::PeerConnectionFactoryInterface> factory;
    webrtc::scoped_refptr<webrtc::PeerConnectionInterface> pc;
    webrtc::Thread* network_thread = nullptr;
    webrtc::Thread* signaling_thread = nullptr;
    webrtc::Thread* worker_thread = nullptr;
    std::queue<std::string> ice_candidates;
    std::mutex ice_mutex;
    bool connected = false;
    bool failed = false;
    bool closed = false;
    bool audio_stereo = false;
    webrtc::scoped_refptr<webrtc::DataChannelInterface> health_channel;
    std::unique_ptr<P2pHealthDataChannelObserver> health_observer;
    std::vector<std::unique_ptr<NativeReceiveAudioSink>> audio_sinks;
    std::vector<std::unique_ptr<NativeReceiveVideoSink>> video_sinks;
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
lib_dspeak_media_action_t lib_dspeak_media_poll_action_impl();




#endif
