#include "lib_dspeak_media/lib_dspeak_media.h"
#include <json.hpp>
#include <api/video/i420_buffer.h>
#include <common_video/libyuv/include/webrtc_libyuv.h>
#include <media/base/adapted_video_track_source.h>
#include "media_handles.hpp"

#include <atomic>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include <api/create_peerconnection_factory.h>
#include <api/media_stream_interface.h>
#include <api/peer_connection_interface.h>
#include <api/scoped_refptr.h>
#include <api/video/video_frame.h>
#include <rtc_base/ref_counted_object.h>
#include <rtc_base/synchronization/mutex.h>
#include <rtc_base/thread.h>

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

template <typename TrackHandle>
static int replace_p2p_track(lib_dspeak_media_p2p_handle_t* handle,
                             TrackHandle* old_track,
                             TrackHandle* new_track) {
    try {
        if (!handle || !handle->pc || !handle->signaling_thread || !old_track ||
            !old_track->track || !new_track || !new_track->track)
            return -1;
        const std::string expected_id = old_track->track->id();
        return handle->signaling_thread->BlockingCall(
            [handle, expected_id, new_track] {
                for (const auto& sender : handle->pc->GetSenders()) {
                    if (!sender->track() || sender->track()->id() != expected_id)
                        continue;
                    return sender->SetTrack(new_track->track.get()) ? 0 : -1;
                }
                return -1;
            });
    } catch (...) {
        return -1;
    }
}

extern "C" int lib_dspeak_media_p2p_replace_video_track(
    lib_dspeak_media_p2p_handle_t* handle,
    lib_dspeak_media_video_track_t* old_track,
    lib_dspeak_media_video_track_t* new_track) {
    return replace_p2p_track(handle, old_track, new_track);
}

extern "C" int lib_dspeak_media_p2p_replace_audio_track(
    lib_dspeak_media_p2p_handle_t* handle,
    lib_dspeak_media_audio_track_t* old_track,
    lib_dspeak_media_audio_track_t* new_track) {
    return replace_p2p_track(handle, old_track, new_track);
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
                if (value.contains("degradationPreference") &&
                    value["degradationPreference"].is_string()) {
                    const auto preference = value["degradationPreference"].get<std::string>();
                    if (preference == "maintain-framerate")
                        current.degradation_preference =
                            webrtc::DegradationPreference::MAINTAIN_FRAMERATE;
                    else if (preference == "maintain-resolution")
                        current.degradation_preference =
                            webrtc::DegradationPreference::MAINTAIN_RESOLUTION;
                    else if (preference == "balanced")
                        current.degradation_preference =
                            webrtc::DegradationPreference::BALANCED;
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

extern "C" int lib_dspeak_media_p2p_set_receive_volume(
    lib_dspeak_media_p2p_handle_t* handle,
    const char* track_id,
    double volume) {
    try {
        if (!handle || !handle->signaling_thread || !track_id) return -1;
        const std::string expected_id(track_id);
        const double normalized = std::max(0.0, std::min(2.0, volume));
        return handle->signaling_thread->BlockingCall([handle, expected_id, normalized] {
            const auto sink = handle->audio_sinks_by_id.find(expected_id);
            if (sink == handle->audio_sinks_by_id.end() || !sink->second) return -1;
            sink->second->SetVolume(normalized);
            return 0;
        });
    } catch (...) {
        return -1;
    }
}
