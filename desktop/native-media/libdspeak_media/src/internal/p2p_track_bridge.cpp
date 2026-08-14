#include "lib_dspeak_media/lib_dspeak_media.h"
#include <json.hpp>
#include <api/video/i420_buffer.h>
#include <common_video/libyuv/include/webrtc_libyuv.h>
#include <media/base/adapted_video_track_source.h>
#include "media_handles.hpp"

#include <atomic>
#include <algorithm>
#include <chrono>
#include <cctype>
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

static std::string normalized_video_codec_name(std::string value) {
    if (value.rfind("video/", 0) == 0) value.erase(0, 6);
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::toupper(ch));
    });
    if (value == "HEVC" || value == "H.265") return "H265";
    return value;
}

static bool is_auxiliary_video_codec(const webrtc::RtpCodecCapability& codec) {
    const auto name = normalized_video_codec_name(codec.mime_type());
    return name == "RTX" || name == "RED" || name == "ULPFEC" ||
        name == "FLEXFEC";
}

static bool is_preferred_primary_video_codec(
    const webrtc::RtpCodecCapability& codec,
    const std::string& preferred_codec) {
    return !preferred_codec.empty() && !is_auxiliary_video_codec(codec) &&
        normalized_video_codec_name(codec.mime_type()) ==
            normalized_video_codec_name(preferred_codec);
}

static bool rtx_targets_primary_codec(
    const webrtc::RtpCodecCapability& codec,
    const std::vector<int>& primary_payload_types) {
    const auto apt = codec.parameters.find("apt");
    if (apt == codec.parameters.end() || apt->second.empty()) return false;
    char* end = nullptr;
    const auto payload_type = std::strtol(apt->second.c_str(), &end, 10);
    if (end == apt->second.c_str() || *end != '\0' || payload_type < 0 ||
        payload_type > 127)
        return false;
    return std::find(
               primary_payload_types.begin(), primary_payload_types.end(),
               static_cast<int>(payload_type)) != primary_payload_types.end();
}

static size_t video_codec_priority(
    const webrtc::RtpCodecCapability& codec,
    const std::string& preferred_codec) {
    const auto mime_type = normalized_video_codec_name(codec.mime_type());
    const auto preferred = normalized_video_codec_name(preferred_codec);
    if (!preferred.empty() && mime_type == preferred)
        return 0;
    if (mime_type == "AV1") return 1;
    if (mime_type == "H265") return 2;
    if (mime_type == "H264") return 3;
    if (mime_type == "VP9") return 4;
    if (mime_type == "VP8") return 5;
    return 6;
}

static bool apply_video_codec_preferences(
    webrtc::PeerConnectionFactoryInterface* factory,
    const webrtc::scoped_refptr<webrtc::RtpTransceiverInterface>& transceiver,
    const std::string& preferred_codec) {
    if (!factory || !transceiver || !transceiver->sender() ||
        !transceiver->sender()->track() ||
        transceiver->sender()->track()->kind() != "video") return false;
    auto capabilities = factory->GetRtpSenderCapabilities(webrtc::MediaType::VIDEO).codecs;
    std::stable_sort(capabilities.begin(), capabilities.end(),
                     [&preferred_codec](const auto& left, const auto& right) {
                         return video_codec_priority(left, preferred_codec) <
                             video_codec_priority(right, preferred_codec);
                     });
    const bool preferred_codec_available = std::any_of(
        capabilities.begin(), capabilities.end(),
        [&preferred_codec](const auto& codec) {
            return is_preferred_primary_video_codec(codec, preferred_codec);
        });
    if (!preferred_codec.empty() && !preferred_codec_available) return false;
    if (preferred_codec_available) {
        capabilities.erase(
            std::remove_if(capabilities.begin(), capabilities.end(),
                           [&preferred_codec](const auto& codec) {
                               return !is_auxiliary_video_codec(codec) &&
                                   !is_preferred_primary_video_codec(
                                       codec, preferred_codec);
                           }),
            capabilities.end());
        std::vector<int> primary_payload_types;
        for (const auto& codec : capabilities) {
            if (!is_auxiliary_video_codec(codec) &&
                codec.preferred_payload_type.has_value())
                primary_payload_types.push_back(*codec.preferred_payload_type);
        }
        capabilities.erase(
            std::remove_if(capabilities.begin(), capabilities.end(),
                           [&primary_payload_types](const auto& codec) {
                               if (!is_auxiliary_video_codec(codec)) return false;
                               return normalized_video_codec_name(codec.mime_type()) !=
                                          "RTX" ||
                                   !rtx_targets_primary_codec(
                                       codec, primary_payload_types);
                           }),
            capabilities.end());
    }
    return transceiver->SetCodecPreferences(capabilities).ok();
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

static std::string p2p_sender_key(const char* key, const std::string& fallback) {
    return key && *key ? std::string(key) : fallback;
}

extern "C" int lib_dspeak_media_p2p_add_video_track_with_key(
    lib_dspeak_media_p2p_handle_t* handle,
    lib_dspeak_media_video_track_t* track,
    const char* preferred_codec,
    const char* track_key) {
    try {
        if (!handle || !handle->pc || !handle->signaling_thread || !track ||
            !track->track)
            return -1;
        const std::string preferred = preferred_codec ? preferred_codec : "";
        const std::string key = p2p_sender_key(track_key, track->track->id());
        return handle->signaling_thread->BlockingCall([handle, track, preferred, key] {
            auto result = handle->pc->AddTrack(track->track, {"stream0"});
            if (!result.ok()) return -1;
            const auto sender = result.value();
            bool preferences_applied = false;
            for (const auto& transceiver : handle->pc->GetTransceivers()) {
                if (transceiver->sender() == sender) {
                    preferences_applied = apply_video_codec_preferences(
                        handle->factory.get(), transceiver, preferred);
                    break;
                }
            }
            if (!preferences_applied) {
                handle->pc->RemoveTrackOrError(sender);
                return -1;
            }
            handle->video_senders[key] = sender;
            if (!preferred.empty())
                handle->video_preferred_codecs[key] =
                    normalized_video_codec_name(preferred);
            return 0;
        });
    } catch (...) {
        return -1;
    }
}

extern "C" int lib_dspeak_media_p2p_add_video_track(
    lib_dspeak_media_p2p_handle_t* handle,
    lib_dspeak_media_video_track_t* track,
    const char* preferred_codec) {
    return lib_dspeak_media_p2p_add_video_track_with_key(
        handle, track, preferred_codec, nullptr);
}

extern "C" int lib_dspeak_media_p2p_add_audio_track_with_key(
    lib_dspeak_media_p2p_handle_t* handle,
    lib_dspeak_media_audio_track_t* track,
    const char* track_key) {
    try {
        if (!handle || !handle->pc || !handle->signaling_thread || !track ||
            !track->track)
            return -1;
        const std::string key = p2p_sender_key(track_key, track->track->id());
        return handle->signaling_thread->BlockingCall([handle, track, key] {
            auto result = handle->pc->AddTrack(track->track, {"stream0"});
            if (!result.ok()) return -1;
            handle->audio_senders[key] = result.value();
            return 0;
        });
    } catch (...) {
        return -1;
    }
}

extern "C" int lib_dspeak_media_p2p_add_audio_track(
    lib_dspeak_media_p2p_handle_t* handle,
    lib_dspeak_media_audio_track_t* track) {
    return lib_dspeak_media_p2p_add_audio_track_with_key(handle, track, nullptr);
}

template <typename TrackHandle>
static int remove_p2p_track_with_key(
    lib_dspeak_media_p2p_handle_t* handle,
    TrackHandle* track,
    const char* track_key) {
    try {
        if (!handle || !handle->pc || !handle->signaling_thread || !track ||
            !track->track)
            return -1;
        const std::string key = p2p_sender_key(track_key, track->track->id());
        const bool video = track->track->kind() == "video";
        return handle->signaling_thread->BlockingCall([handle, track, key, video] {
            webrtc::scoped_refptr<webrtc::RtpSenderInterface> sender;
            if (video) {
                const auto found = handle->video_senders.find(key);
                if (found != handle->video_senders.end()) sender = found->second;
            } else {
                const auto found = handle->audio_senders.find(key);
                if (found != handle->audio_senders.end()) sender = found->second;
            }
            if (!sender) {
                for (const auto& candidate : handle->pc->GetSenders()) {
                    if (candidate->track() &&
                        candidate->track()->id() == track->track->id()) {
                        sender = candidate;
                        break;
                    }
                }
            }
            if (!sender) return -1;
            const auto error = handle->pc->RemoveTrackOrError(sender);
            if (!error.ok()) return -1;
            if (video)
                handle->video_senders.erase(key);
            else
                handle->audio_senders.erase(key);
            if (video) handle->video_preferred_codecs.erase(key);
            return 0;
        });
    } catch (...) {
        return -1;
    }
}

extern "C" int lib_dspeak_media_p2p_remove_video_track_with_key(
    lib_dspeak_media_p2p_handle_t* handle,
    lib_dspeak_media_video_track_t* track,
    const char* track_key) {
    return remove_p2p_track_with_key(handle, track, track_key);
}

extern "C" int lib_dspeak_media_p2p_remove_video_track(
    lib_dspeak_media_p2p_handle_t* handle,
    lib_dspeak_media_video_track_t* track) {
    return lib_dspeak_media_p2p_remove_video_track_with_key(handle, track, nullptr);
}

extern "C" int lib_dspeak_media_p2p_remove_audio_track_with_key(
    lib_dspeak_media_p2p_handle_t* handle,
    lib_dspeak_media_audio_track_t* track,
    const char* track_key) {
    return remove_p2p_track_with_key(handle, track, track_key);
}

extern "C" int lib_dspeak_media_p2p_remove_audio_track(
    lib_dspeak_media_p2p_handle_t* handle,
    lib_dspeak_media_audio_track_t* track) {
    return lib_dspeak_media_p2p_remove_audio_track_with_key(handle, track, nullptr);
}

template <typename TrackHandle>
static int replace_p2p_track(lib_dspeak_media_p2p_handle_t* handle,
                             TrackHandle* old_track,
                             TrackHandle* new_track,
                             const char* track_key) {
    try {
        if (!handle || !handle->pc || !handle->signaling_thread || !old_track ||
            !old_track->track || !new_track || !new_track->track)
            return -1;
        const std::string expected_id = old_track->track->id();
        const std::string key = p2p_sender_key(track_key, expected_id);
        const bool video = old_track->track->kind() == "video";
        return handle->signaling_thread->BlockingCall(
            [handle, expected_id, key, video, new_track] {
                webrtc::scoped_refptr<webrtc::RtpSenderInterface> sender;
                if (video) {
                    const auto found = handle->video_senders.find(key);
                    if (found != handle->video_senders.end()) sender = found->second;
                } else {
                    const auto found = handle->audio_senders.find(key);
                    if (found != handle->audio_senders.end()) sender = found->second;
                }
                if (!sender) {
                    for (const auto& candidate : handle->pc->GetSenders()) {
                        if (candidate->track() && candidate->track()->id() == expected_id) {
                            sender = candidate;
                            break;
                        }
                    }
                }
                if (!sender || !sender->SetTrack(new_track->track.get())) return -1;
                if (video)
                    handle->video_senders[key] = sender;
                else
                    handle->audio_senders[key] = sender;
                return 0;
            });
    } catch (...) {
        return -1;
    }
}

extern "C" int lib_dspeak_media_p2p_replace_video_track(
    lib_dspeak_media_p2p_handle_t* handle,
    lib_dspeak_media_video_track_t* old_track,
    lib_dspeak_media_video_track_t* new_track) {
    return replace_p2p_track(handle, old_track, new_track, nullptr);
}

extern "C" int lib_dspeak_media_p2p_replace_video_track_with_key(
    lib_dspeak_media_p2p_handle_t* handle,
    lib_dspeak_media_video_track_t* old_track,
    lib_dspeak_media_video_track_t* new_track,
    const char* track_key) {
    return replace_p2p_track(handle, old_track, new_track, track_key);
}

extern "C" int lib_dspeak_media_p2p_replace_audio_track(
    lib_dspeak_media_p2p_handle_t* handle,
    lib_dspeak_media_audio_track_t* old_track,
    lib_dspeak_media_audio_track_t* new_track) {
    return replace_p2p_track(handle, old_track, new_track, nullptr);
}

extern "C" int lib_dspeak_media_p2p_replace_audio_track_with_key(
    lib_dspeak_media_p2p_handle_t* handle,
    lib_dspeak_media_audio_track_t* old_track,
    lib_dspeak_media_audio_track_t* new_track,
    const char* track_key) {
    return replace_p2p_track(handle, old_track, new_track, track_key);
}

extern "C" int lib_dspeak_media_p2p_set_track_parameters_with_key(
    lib_dspeak_media_p2p_handle_t* handle,
    const char* track_key,
    const char* parameters_json) {
    try {
        if (!handle || !handle->pc || !handle->signaling_thread || !track_key ||
            !parameters_json)
            return -1;
        const std::string expected_key(track_key);
        const std::string parameters(parameters_json);
        return handle->signaling_thread->BlockingCall([handle, expected_key, parameters] {
            const auto value = json::parse(parameters);
            if (!value.is_object()) return -1;
            webrtc::scoped_refptr<webrtc::RtpSenderInterface> sender;
            const auto video = handle->video_senders.find(expected_key);
            if (video != handle->video_senders.end()) sender = video->second;
            if (!sender) {
                const auto audio = handle->audio_senders.find(expected_key);
                if (audio != handle->audio_senders.end()) sender = audio->second;
            }
            if (!sender || !sender->track()) {
                for (const auto& candidate : handle->pc->GetSenders()) {
                    if (candidate->track() && candidate->track()->id() == expected_key) {
                        sender = candidate;
                        break;
                    }
                }
            }
            if (sender && sender->track()) {
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
                if (value.contains("preferredCodec") &&
                    value["preferredCodec"].is_string() &&
                    sender->track()->kind() == "video") {
                    const auto preferred =
                        value["preferredCodec"].get<std::string>();
                    const auto normalized_preferred =
                        normalized_video_codec_name(preferred);
                    const auto existing_preference =
                        handle->video_preferred_codecs.find(expected_key);
                    const bool preference_changed =
                        existing_preference == handle->video_preferred_codecs.end()
                            ? !normalized_preferred.empty()
                            : existing_preference->second != normalized_preferred;
                    for (const auto& transceiver : handle->pc->GetTransceivers()) {
                        if (transceiver->sender() == sender) {
                            if (preference_changed) {
                                if (!apply_video_codec_preferences(
                                        handle->factory.get(), transceiver, preferred))
                                    return -1;
                                if (!normalized_preferred.empty())
                                    handle->video_preferred_codecs[expected_key] =
                                        normalized_preferred;
                                else
                                    handle->video_preferred_codecs.erase(expected_key);
                            }
                            break;
                        }
                    }
                }
                return sender->SetParameters(current).ok() ? 0 : -1;
            }
            return -1;
        });
    } catch (...) {
        return -1;
    }
}

extern "C" int lib_dspeak_media_p2p_set_track_parameters(
    lib_dspeak_media_p2p_handle_t* handle,
    const char* track_id,
    const char* parameters_json) {
    return lib_dspeak_media_p2p_set_track_parameters_with_key(
        handle, track_id, parameters_json);
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
