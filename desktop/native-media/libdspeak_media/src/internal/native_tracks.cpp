#include "lib_dspeak_media/lib_dspeak_media.h"
#include <json.hpp>
#include <api/video/i420_buffer.h>
#include <api/video/video_frame.h>
#include <common_video/libyuv/include/webrtc_libyuv.h>
#include <media/base/adapted_video_track_source.h>
#if defined(__APPLE__)
#include <CoreVideo/CoreVideo.h>
#endif
#include "media_handles.hpp"

#include <cstring>
#include <cstdlib>
#include <memory>
#include <mutex>
#include <queue>
#include <string>
#include <future>
#include <map>
#include <atomic>
#include <vector>
#include <algorithm>
#include <chrono>
#include <optional>

#include <mediasoupclient.hpp>
#include <Device.hpp>
#include <Transport.hpp>
#include <Producer.hpp>
#include <Consumer.hpp>
#include <api/create_peerconnection_factory.h>
#include <api/audio/create_audio_device_module.h>
#include <api/audio_codecs/builtin_audio_encoder_factory.h>
#include <api/audio_codecs/builtin_audio_decoder_factory.h>
#include <api/environment/environment_factory.h>
#include <api/media_stream_interface.h>
#include <api/peer_connection_interface.h>
#include <api/rtp_parameters.h>
#include <api/scoped_refptr.h>
#include <api/video/i420_buffer.h>
#include <api/video/video_frame.h>
#include <api/video/video_rotation.h>
#include <common_video/libyuv/include/webrtc_libyuv.h>
#include <media/base/adapted_video_track_source.h>
#include <rtc_base/ref_counted_object.h>
#include <rtc_base/synchronization/mutex.h>
#include <rtc_base/thread.h>

#if defined(__APPLE__)
#include <CoreMedia/CoreMedia.h>
#include <CoreVideo/CoreVideo.h>
#include "PlatformCapture.h"
#endif

using json = nlohmann::json;

static webrtc::Priority parse_priority(const json& value, webrtc::Priority fallback)
{
    if (!value.is_string()) return fallback;
    const auto priority = value.get<std::string>();
    if (priority == "very-low") return webrtc::Priority::kVeryLow;
    if (priority == "low") return webrtc::Priority::kLow;
    if (priority == "medium") return webrtc::Priority::kMedium;
    if (priority == "high") return webrtc::Priority::kHigh;
    return fallback;
}

static double priority_value(const json& value)
{
    switch (parse_priority(value, webrtc::Priority::kMedium)) {
        case webrtc::Priority::kVeryLow: return 0.5;
        case webrtc::Priority::kLow: return 1.0;
        case webrtc::Priority::kHigh: return 4.0;
        case webrtc::Priority::kMedium: return 2.0;
    }
    return 2.0;
}

static std::vector<webrtc::RtpEncodingParameters> parse_encodings(const json& app_data)
{
    std::vector<webrtc::RtpEncodingParameters> encodings;
    const auto value = app_data.value("encodings", json::array());
    if (!value.is_array()) return encodings;

    for (const auto& item : value) {
        if (!item.is_object()) continue;
        webrtc::RtpEncodingParameters encoding;
        if (item.contains("maxBitrate") && item["maxBitrate"].is_number_integer())
            encoding.max_bitrate_bps = item["maxBitrate"].get<int>();
        if (item.contains("minBitrate") && item["minBitrate"].is_number_integer())
            encoding.min_bitrate_bps = item["minBitrate"].get<int>();
        if (item.contains("maxFramerate") && item["maxFramerate"].is_number())
            encoding.max_framerate = item["maxFramerate"].get<double>();
        if (item.contains("scaleResolutionDownBy") && item["scaleResolutionDownBy"].is_number())
            encoding.scale_resolution_down_by = item["scaleResolutionDownBy"].get<double>();
        if (item.contains("scalabilityMode") && item["scalabilityMode"].is_string())
            encoding.scalability_mode = item["scalabilityMode"].get<std::string>();
        if (item.contains("rid") && item["rid"].is_string())
            encoding.rid = item["rid"].get<std::string>();
        if (item.contains("active") && item["active"].is_boolean())
            encoding.active = item["active"].get<bool>();
        if (item.contains("priority"))
            encoding.bitrate_priority = priority_value(item["priority"]);
        if (item.contains("networkPriority"))
            encoding.network_priority = parse_priority(item["networkPriority"], encoding.network_priority);
        encodings.push_back(std::move(encoding));
    }
    return encodings;
}

/* ────────────────────────────────────────────────────────────────── */
/* Native track creation and mediasoup producer attachment            */
/* ────────────────────────────────────────────────────────────────── */

extern "C" lib_dspeak_media_video_track_t* lib_dspeak_media_create_video_track(const char* track_id, int* error_out)
{
    if (!track_id) {
        if (error_out) *error_out = -1;
        return nullptr;
    }

#if defined(__APPLE__)
    try {
        webrtc::Thread* signaling_thread = webrtc::Thread::Create().release();
        signaling_thread->Start();
        webrtc::Thread* worker_thread = webrtc::Thread::Create().release();
        worker_thread->Start();

        auto factory = webrtc::CreatePeerConnectionFactory(
            /*network_thread=*/nullptr,
            worker_thread,
            signaling_thread,
            /*default_adm=*/nullptr,
            /*audio_encoder_factory=*/webrtc::CreateBuiltinAudioEncoderFactory(),
            /*audio_decoder_factory=*/webrtc::CreateBuiltinAudioDecoderFactory(),
            /*video_encoder_factory=*/nullptr,
            /*video_decoder_factory=*/nullptr,
            /*audio_mixer=*/nullptr,
            /*audio_processing=*/nullptr);
        if (!factory) {
            delete signaling_thread;
            delete worker_thread;
            if (error_out) *error_out = -2;
            return nullptr;
        }

        auto* source = new webrtc::RefCountedObject<NativeVideoSource>(track_id);
        webrtc::scoped_refptr<webrtc::VideoTrackSourceInterface> video_source(source);
        webrtc::scoped_refptr<webrtc::VideoTrackInterface> track =
            factory->CreateVideoTrack(video_source, track_id);
        if (!track) {
            delete signaling_thread;
            delete worker_thread;
            if (error_out) *error_out = -3;
            return nullptr;
        }

        auto* handle = new lib_dspeak_media_video_track();
        handle->factory = factory;
        handle->signaling_thread = signaling_thread;
        handle->worker_thread = worker_thread;
        handle->source = source;
        handle->track = track;

        if (error_out) *error_out = 0;
        return handle;
    } catch (...) {
        if (error_out) *error_out = -99;
        return nullptr;
    }
#else
    if (error_out) *error_out = -99;
    return nullptr;
#endif
}

extern "C" lib_dspeak_media_audio_track_t* lib_dspeak_media_create_audio_track(const char* track_id, int* error_out)
{
    if (!track_id) {
        if (error_out) *error_out = -1;
        return nullptr;
    }

#if defined(__APPLE__)
    try {
        webrtc::Thread* signaling_thread = webrtc::Thread::Create().release();
        signaling_thread->Start();
        webrtc::Thread* worker_thread = webrtc::Thread::Create().release();
        worker_thread->Start();

        auto factory = webrtc::CreatePeerConnectionFactory(
            /*network_thread=*/nullptr,
            worker_thread,
            signaling_thread,
            /*default_adm=*/nullptr,
            /*audio_encoder_factory=*/webrtc::CreateBuiltinAudioEncoderFactory(),
            /*audio_decoder_factory=*/webrtc::CreateBuiltinAudioDecoderFactory(),
            /*video_encoder_factory=*/nullptr,
            /*video_decoder_factory=*/nullptr,
            /*audio_mixer=*/nullptr,
            /*audio_processing=*/nullptr);
        if (!factory) {
            delete signaling_thread;
            delete worker_thread;
            if (error_out) *error_out = -2;
            return nullptr;
        }

        auto* source = new webrtc::RefCountedObject<NativeAudioSource>(track_id);
        webrtc::scoped_refptr<webrtc::AudioSourceInterface> audio_source(source);
        if (!audio_source) {
            delete signaling_thread;
            delete worker_thread;
            if (error_out) *error_out = -3;
            return nullptr;
        }

        webrtc::scoped_refptr<webrtc::AudioTrackInterface> track =
            factory->CreateAudioTrack(track_id, audio_source.get());
        if (!track) {
            delete signaling_thread;
            delete worker_thread;
            if (error_out) *error_out = -4;
            return nullptr;
        }

        auto* handle = new lib_dspeak_media_audio_track();
        handle->factory = factory;
        handle->signaling_thread = signaling_thread;
        handle->worker_thread = worker_thread;
        handle->source = source;
        handle->track = track;

        if (error_out) *error_out = 0;
        return handle;
    } catch (...) {
        if (error_out) *error_out = -99;
        return nullptr;
    }
#else
    if (error_out) *error_out = -99;
    return nullptr;
#endif
}

extern "C" void lib_dspeak_media_destroy_video_track(lib_dspeak_media_video_track_t* t)
{
    if (!t) return;
#if defined(__APPLE__)
    auto destroy = [t] {
        if (t->source)
            t->source->SetState(webrtc::MediaSourceInterface::kEnded);
        t->track = nullptr;
        t->factory = nullptr;
    };
    if (t->signaling_thread)
        t->signaling_thread->BlockingCall(destroy);
    else
        destroy();
#else
    t->track = nullptr;
    t->factory = nullptr;
#endif
    delete t->signaling_thread;
    delete t->worker_thread;
    delete t;
}

extern "C" void lib_dspeak_media_destroy_audio_track(lib_dspeak_media_audio_track_t* t)
{
    if (!t) return;
#if defined(__APPLE__)
    auto destroy = [t] {
        if (t->source)
            t->source->OnClose();
        t->track = nullptr;
        t->factory = nullptr;
    };
    if (t->signaling_thread)
        t->signaling_thread->BlockingCall(destroy);
    else
        destroy();
#else
    t->track = nullptr;
    t->factory = nullptr;
#endif
    delete t->signaling_thread;
    delete t->worker_thread;
    delete t;
}

extern "C" const char* lib_dspeak_media_video_track_get_id(lib_dspeak_media_video_track_t* t)
{
    if (!t || !t->track) return nullptr;
    return lib_dspeak_media_strdup(t->track->id().c_str());
}

extern "C" const char* lib_dspeak_media_audio_track_get_id(lib_dspeak_media_audio_track_t* t)
{
    if (!t || !t->track) return nullptr;
    return lib_dspeak_media_strdup(t->track->id().c_str());
}

extern "C" lib_dspeak_media_producer_t* lib_dspeak_media_produce_video_track(
    lib_dspeak_media_send_transport_t* transport,
    lib_dspeak_media_video_track_t* track,
    const char* app_data_json,
    int* error_out)
{
    if (error_out) *error_out = 0;
    if (!transport || !transport->transport || !track || !track->track) {
        if (error_out) *error_out = -1;
        return nullptr;
    }
    try {
        auto app_data = app_data_json ? nlohmann::json::parse(app_data_json) : nlohmann::json::object();
        auto encodings = parse_encodings(app_data);
        auto* producer = transport->transport->Produce(
            nullptr, track->track.get(), encodings.empty() ? nullptr : &encodings, nullptr, nullptr, app_data);
        return reinterpret_cast<lib_dspeak_media_producer_t*>(producer);
    } catch (...) {
        if (error_out) *error_out = -1;
        return nullptr;
    }
}

extern "C" lib_dspeak_media_producer_t* lib_dspeak_media_produce_audio_track(
    lib_dspeak_media_send_transport_t* transport,
    lib_dspeak_media_audio_track_t* track,
    const char* app_data_json,
    int* error_out)
{
    if (error_out) *error_out = 0;
    if (!transport || !transport->transport || !track || !track->track) {
        if (error_out) *error_out = -1;
        return nullptr;
    }
    try {
        auto app_data = app_data_json ? nlohmann::json::parse(app_data_json) : nlohmann::json::object();
        auto encodings = parse_encodings(app_data);
        auto* producer = transport->transport->Produce(
            nullptr, track->track.get(), encodings.empty() ? nullptr : &encodings, nullptr, nullptr, app_data);
        return reinterpret_cast<lib_dspeak_media_producer_t*>(producer);
    } catch (...) {
        if (error_out) *error_out = -1;
        return nullptr;
    }
}
