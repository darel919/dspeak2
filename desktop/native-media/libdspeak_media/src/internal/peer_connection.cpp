#include "lib_dspeak_media/lib_dspeak_media.h"
#include <json.hpp>
#include "media_handles.hpp"
#include "runtime_health.hpp"
#include "platform_video_codec_factories.hpp"

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
#include <cctype>
#include <chrono>
#include <optional>
#include <sstream>

#include <api/create_peerconnection_factory.h>
#include <api/audio/create_audio_device_module.h>
#include <api/audio_codecs/builtin_audio_encoder_factory.h>
#include <api/audio_codecs/builtin_audio_decoder_factory.h>
#include <api/environment/environment_factory.h>
#include <api/media_stream_interface.h>
#include <api/peer_connection_interface.h>
#include <api/stats/rtc_stats_collector_callback.h>
#include <api/stats/rtc_stats_report.h>
#include <api/data_channel_interface.h>
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

static std::string normalized_video_codec_name(std::string value) {
    if (value.rfind("video/", 0) == 0) value.erase(0, 6);
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::toupper(ch));
    });
    if (value == "HEVC" || value == "H.265") return "H265";
    return value;
}

static bool sdp_has_video_codec(
    const std::string& sdp,
    const std::string& preferred_codec) {
    const auto wanted = normalized_video_codec_name(preferred_codec);
    if (wanted.empty()) return true;
    const auto media_start = sdp.find("m=video ");
    if (media_start == std::string::npos) return false;
    const auto media_end = sdp.find("\nm=", media_start + 1);
    const auto section = sdp.substr(
        media_start,
        media_end == std::string::npos ? std::string::npos : media_end - media_start);
    std::string normalized = section;
    std::transform(normalized.begin(), normalized.end(), normalized.begin(),
                   [](unsigned char ch) {
                       return static_cast<char>(std::toupper(ch));
                   });
    return normalized.find(" " + wanted + "/") != std::string::npos;
}

static bool preferred_video_codecs_are_in_sdp(
    const lib_dspeak_media_p2p_handle_t* handle,
    const std::string& sdp) {
    if (!handle) return false;
    for (const auto& [key, codec] : handle->video_preferred_codecs)
        if (!sdp_has_video_codec(sdp, codec)) return false;
    return true;
}

static std::string sdp_parse_error_message(const webrtc::SdpParseError& error) {
    if (error.description.empty() && error.line.empty())
        return "SDP description could not be parsed";
    if (error.line.empty()) return "SDP parse failed: " + error.description;
    if (error.description.empty()) return "SDP parse failed at: " + error.line;
    return "SDP parse failed: " + error.description + " [" + error.line + "]";
}

/* ── P2P (PeerConnection) transport ─────────────────── */

static uint64_t p2p_event_handle(const lib_dspeak_media_p2p_handle* handle) {
    if (!handle) return 0;
    const auto event_handle = handle->event_handle.load(std::memory_order_acquire);
    return event_handle != 0 ? event_handle : reinterpret_cast<uint64_t>(handle);
}


class P2pHealthDataChannelObserver : public webrtc::DataChannelObserver {
public:
    P2pHealthDataChannelObserver(
        lib_dspeak_media_p2p_handle* handle,
        webrtc::scoped_refptr<webrtc::DataChannelInterface> channel)
        : handle_(handle), channel_(std::move(channel)) {}

    void OnStateChange() override {
        if (!handle_ || handle_->closed.load(std::memory_order_acquire) || !channel_) return;
        const auto state = channel_->state();
        lib_dspeak_media_push_p2p_event(
            p2p_event_handle(handle_),
            "data-channel-state", "", "",
            webrtc::DataChannelInterface::DataStateString(state));
    }

    void OnMessage(const webrtc::DataBuffer& buffer) override {
        if (!handle_ || handle_->closed.load(std::memory_order_acquire) || buffer.binary ||
            buffer.data.size() == 0)
            return;
        const std::string text(
            reinterpret_cast<const char*>(buffer.data.data()), buffer.data.size());
        try {
            const auto message = json::parse(text);
            const auto type = message.value("type", "");
            if (type != "health" && type != "health-ack") return;
            const auto sequence = message.value("sequence", 0U);
            lib_dspeak_media_push_p2p_event(
                p2p_event_handle(handle_), "health-received", "", "",
                std::to_string(sequence).c_str());
            if (type != "health") return;
            const auto channel = channel_;
            const auto signaling_thread = handle_->signaling_thread;
            if (!channel || !signaling_thread) return;
            const auto acknowledgement =
                json{{"type", "health-ack"}, {"sequence", sequence}}.dump();
            signaling_thread->PostTask([channel, acknowledgement] {
                if (channel->state() == webrtc::DataChannelInterface::kOpen)
                    channel->Send(webrtc::DataBuffer(acknowledgement));
            });
        } catch (...) {
        }
    }

private:
    lib_dspeak_media_p2p_handle* handle_;
    webrtc::scoped_refptr<webrtc::DataChannelInterface> channel_;
};

namespace {

void bind_health_channel(
    lib_dspeak_media_p2p_handle* handle,
    webrtc::scoped_refptr<webrtc::DataChannelInterface> channel) {
    if (!handle || !channel || channel->label() != "health") return;
    if (handle->health_channel) handle->health_channel->UnregisterObserver();
    handle->health_observer.reset();
    handle->health_channel = channel;
    handle->health_observer = std::make_unique<P2pHealthDataChannelObserver>(
        handle, channel);
    channel->RegisterObserver(handle->health_observer.get());
    lib_dspeak_media_push_p2p_event(
        p2p_event_handle(handle), "data-channel-state", "", "",
        webrtc::DataChannelInterface::DataStateString(channel->state()));
}

class P2pObserver : public webrtc::PeerConnectionObserver {
public:
    explicit P2pObserver(lib_dspeak_media_p2p_handle* h) : handle_(h) {}

    bool active() const {
        return handle_ && !handle_->closed.load(std::memory_order_acquire);
    }

    void OnSignalingChange(
        webrtc::PeerConnectionInterface::SignalingState new_state) override {
        if (!active()) return;
        lib_dspeak_media_push_p2p_event(
            p2p_event_handle(handle_),
            "signaling-state", "", "", std::to_string(static_cast<int>(new_state)).c_str());
    }

    void OnIceCandidate(const webrtc::IceCandidateInterface* candidate) override {
        if (!active() || !candidate) return;
        std::string sdp;
        if (candidate->ToString(&sdp)) {
            const auto payload = json{
                {"candidate", sdp},
                {"sdpMid", candidate->sdp_mid()},
                {"sdpMLineIndex", candidate->sdp_mline_index()},
            };
            const auto serialized = payload.dump();
            lib_dspeak_media_push_p2p_event(
                p2p_event_handle(handle_), "ice-candidate", "", "", serialized.c_str());
        }
    }

    void OnIceConnectionChange(
        webrtc::PeerConnectionInterface::IceConnectionState state) override {
        if (!active()) return;
        const bool next_connected =
            state == webrtc::PeerConnectionInterface::kIceConnectionConnected ||
            state == webrtc::PeerConnectionInterface::kIceConnectionCompleted;
        bool previous_connected =
            handle_->connected.exchange(next_connected, std::memory_order_acq_rel);
        dspeak_media_runtime::update_p2p_connection(
            previous_connected, next_connected);
        if (next_connected) handle_->failed.store(false, std::memory_order_release);
        else if (state == webrtc::PeerConnectionInterface::kIceConnectionFailed)
            handle_->failed.store(true, std::memory_order_release);
        lib_dspeak_media_push_p2p_event(
            p2p_event_handle(handle_),
            "ice-state", "", "", std::to_string(static_cast<int>(state)).c_str());
    }

    void OnIceGatheringChange(
        webrtc::PeerConnectionInterface::IceGatheringState state) override {
        if (!active()) return;
        lib_dspeak_media_push_p2p_event(
            p2p_event_handle(handle_),
            "ice-gathering-state", "", "", std::to_string(static_cast<int>(state)).c_str());
    }
    void OnIceConnectionReceivingChange(bool receiving) override {
        if (!active()) return;
        lib_dspeak_media_push_p2p_event(
            p2p_event_handle(handle_),
            "ice-receiving", "", "", receiving ? "true" : "false");
    }
    void OnAddStream(webrtc::scoped_refptr<webrtc::MediaStreamInterface>) override {}
    void OnRemoveStream(webrtc::scoped_refptr<webrtc::MediaStreamInterface>) override {}
    void OnDataChannel(
        webrtc::scoped_refptr<webrtc::DataChannelInterface> channel) override {
        if (!active()) return;
        bind_health_channel(handle_, std::move(channel));
    }

    void OnTrack(webrtc::scoped_refptr<webrtc::RtpTransceiverInterface> transceiver) override {
        if (!active()) return;
        if (!transceiver || !transceiver->receiver()) return;
        auto track = transceiver->receiver()->track();
        if (!track) return;
        const auto kind = track->kind();
        const auto track_id = track->id();
        const auto mid = transceiver->mid().value_or("");
        const auto metadata = json{{"mid", mid}}.dump();
        lib_dspeak_media_push_p2p_event(
            p2p_event_handle(handle_), "track-added", track_id.c_str(), kind.c_str(),
            metadata.c_str());
        if (kind == "audio") {
            handle_->audio_receivers[track_id] = transceiver->receiver();
            auto sink = std::make_unique<NativeReceiveAudioSink>(track_id);
            static_cast<webrtc::AudioTrackInterface*>(track.get())->AddSink(sink.get());
            sink->SetEnabled(true);
            handle_->audio_sinks_by_id[track_id] = sink.get();
            handle_->audio_sinks.push_back(std::move(sink));
        } else if (kind == "video") {
            auto sink = std::make_unique<NativeReceiveVideoSink>(
                track_id, std::to_string(p2p_event_handle(handle_)));
            static_cast<webrtc::VideoTrackInterface*>(track.get())->AddOrUpdateSink(
                sink.get(), webrtc::VideoSinkWants());
            sink->SetEnabled(true);
            handle_->video_sinks_by_id[track_id] = sink.get();
            handle_->video_sinks.push_back(std::move(sink));
        }
    }

    void OnRemoveTrack(
        webrtc::scoped_refptr<webrtc::RtpReceiverInterface> receiver) override {
        if (!active() || !receiver || !receiver->track()) return;
        const auto track = receiver->track();
        const auto track_id = track->id();
        if (track->kind() == "audio") {
            const auto sink = handle_->audio_sinks_by_id.find(track_id);
            if (sink != handle_->audio_sinks_by_id.end()) {
                static_cast<webrtc::AudioTrackInterface*>(track.get())->RemoveSink(
                    sink->second);
                const auto* sink_ptr = sink->second;
                handle_->audio_sinks_by_id.erase(sink);
                handle_->audio_sinks.erase(
                    std::remove_if(
                        handle_->audio_sinks.begin(), handle_->audio_sinks.end(),
                        [sink_ptr](const auto& candidate) {
                            return candidate.get() == sink_ptr;
                        }),
                    handle_->audio_sinks.end());
            }
            handle_->audio_receivers.erase(track_id);
        } else if (track->kind() == "video") {
            const auto sink = handle_->video_sinks_by_id.find(track_id);
            if (sink != handle_->video_sinks_by_id.end()) {
                static_cast<webrtc::VideoTrackInterface*>(track.get())->RemoveSink(
                    sink->second);
                const auto* sink_ptr = sink->second;
                handle_->video_sinks_by_id.erase(sink);
                handle_->video_sinks.erase(
                    std::remove_if(
                        handle_->video_sinks.begin(), handle_->video_sinks.end(),
                        [sink_ptr](const auto& candidate) {
                            return candidate.get() == sink_ptr;
                        }),
                    handle_->video_sinks.end());
            }
        }
        lib_dspeak_media_push_p2p_event(
            p2p_event_handle(handle_),
            "track-removed", track_id.c_str(), track->kind().c_str(), "");
    }

    void OnRenegotiationNeeded() override {
        if (!active()) return;
        lib_dspeak_media_push_p2p_event(
            p2p_event_handle(handle_), "renegotiation-needed", "", "", "");
    }

private:
    lib_dspeak_media_p2p_handle* handle_;
};

class P2pOfferObserver : public webrtc::CreateSessionDescriptionObserver {
public:
    explicit P2pOfferObserver(lib_dspeak_media_p2p_handle* handle)
        : handle_(handle), promise_(std::promise<std::string>()) {}
    std::future<std::string> GetFuture() { return promise_.get_future(); }

    void OnSuccess(webrtc::SessionDescriptionInterface* desc) override {
        std::string sdp;
        desc->ToString(&sdp);
        promise_.set_value(sdp);
    }

    void OnFailure(webrtc::RTCError error) override {
        if (handle_) handle_->last_error = error.message();
        promise_.set_exception(
            std::make_exception_ptr(std::runtime_error(error.message())));
    }

private:
    lib_dspeak_media_p2p_handle* handle_;
    std::promise<std::string> promise_;
};

class P2pSetObserver : public webrtc::SetSessionDescriptionObserver {
public:
    explicit P2pSetObserver(lib_dspeak_media_p2p_handle* handle)
        : handle_(handle), promise_(std::promise<void>()) {}
    std::future<void> GetFuture() { return promise_.get_future(); }

    void OnSuccess() override { promise_.set_value(); }
    void OnFailure(webrtc::RTCError error) override {
        if (handle_) handle_->last_error = error.message();
        promise_.set_exception(
            std::make_exception_ptr(std::runtime_error(error.message())));
    }

private:
    lib_dspeak_media_p2p_handle* handle_;
    std::promise<void> promise_;
};

class P2pStatsObserver : public webrtc::RTCStatsCollectorCallback {
public:
    P2pStatsObserver() : promise_(std::promise<std::string>()) {}

    std::future<std::string> GetFuture() { return promise_.get_future(); }

    void OnStatsDelivered(
        const webrtc::scoped_refptr<const webrtc::RTCStatsReport>& report) override {
        promise_.set_value(report ? report->ToJson() : "{}");
    }

private:
    std::promise<std::string> promise_;
};

void apply_ice_servers(
    webrtc::PeerConnectionInterface::RTCConfiguration& config,
    const char* ice_servers_json) {
    if (!ice_servers_json) return;
    try {
        const auto servers = json::parse(ice_servers_json);
        if (!servers.is_array()) return;
        for (const auto& value : servers) {
            if (!value.is_object()) continue;
            webrtc::PeerConnectionInterface::IceServer server;
            const auto urls = value.value("urls", json::array());
            if (urls.is_string()) {
                server.urls.push_back(urls.get<std::string>());
            } else if (urls.is_array()) {
                for (const auto& url : urls)
                    if (url.is_string()) server.urls.push_back(url.get<std::string>());
            }
            if (server.urls.empty()) continue;
            server.username = value.value("username", "");
            server.password = value.value("credential", "");
            config.servers.push_back(std::move(server));
        }
    } catch (...) {}
}

static std::optional<webrtc::SdpType> sdp_type_from_string(const char* value) {
    if (!value) return std::nullopt;
    const std::string type = value;
    if (type == "offer") return webrtc::SdpType::kOffer;
    if (type == "answer") return webrtc::SdpType::kAnswer;
    if (type == "pranswer") return webrtc::SdpType::kPrAnswer;
    return std::nullopt;
}

}

extern "C" lib_dspeak_media_p2p_handle_t* lib_dspeak_media_p2p_create(
    const char* ice_servers_json, bool offerer, uint64_t event_handle)
{
    try {
        auto* h = new(std::nothrow) lib_dspeak_media_p2p_handle();
        if (!h) return nullptr;
        h->event_handle.store(event_handle, std::memory_order_release);

        h->network_thread = webrtc::Thread::CreateWithSocketServer().release();
        h->network_thread->SetName("dspeak_p2p_network", nullptr);
        dspeak_native::start_media_thread(h->network_thread);
        h->signaling_thread = webrtc::Thread::Create().release();
        h->signaling_thread->SetName("dspeak_p2p_signaling", nullptr);
        dspeak_native::start_media_thread(h->signaling_thread);
        h->worker_thread = webrtc::Thread::Create().release();
        h->worker_thread->SetName("dspeak_p2p_worker", nullptr);
        dspeak_native::start_media_thread(h->worker_thread);

        auto null_adm = webrtc::CreateAudioDeviceModule(
            webrtc::CreateEnvironment(),
            webrtc::AudioDeviceModule::kDummyAudio);
        if (!null_adm) {
            delete h->network_thread;
            delete h->signaling_thread;
            delete h->worker_thread;
            delete h;
            return nullptr;
        }

        h->factory = webrtc::CreatePeerConnectionFactory(
            h->network_thread,
            h->worker_thread,
            h->signaling_thread,
            /*default_adm=*/null_adm,
            /*audio_encoder_factory=*/webrtc::CreateBuiltinAudioEncoderFactory(),
            /*audio_decoder_factory=*/webrtc::CreateBuiltinAudioDecoderFactory(),
            dspeak_native::create_video_encoder_factory(),
            dspeak_native::create_video_decoder_factory(),
            /*audio_mixer=*/nullptr,
            /*audio_processing=*/nullptr);
        if (!h->factory) {
            delete h->network_thread;
            delete h->signaling_thread;
            delete h->worker_thread;
            delete h;
            return nullptr;
        }

        webrtc::PeerConnectionInterface::RTCConfiguration config;
        config.sdp_semantics = webrtc::SdpSemantics::kUnifiedPlan;
        apply_ice_servers(config, ice_servers_json);

        h->p2p_observer_raw = new P2pObserver(h);
        auto* observer = h->p2p_observer_raw;
        auto result = h->factory->CreatePeerConnectionOrError(
            config, webrtc::PeerConnectionDependencies(observer));
        if (!result.ok()) {
            h->factory = nullptr;
            delete h->network_thread;
            delete h->signaling_thread;
            delete h->worker_thread;
            delete h;
            return nullptr;
        }
        h->pc = std::move(result).value();
        if (!h->pc) {
            h->factory = nullptr;
            delete h->network_thread;
            delete h->signaling_thread;
            delete h->worker_thread;
            delete h;
            return nullptr;
        }

        h->signaling_thread->BlockingCall([h, offerer] {
            if (!offerer) return;
            webrtc::DataChannelInit config;
            config.ordered = false;
            config.maxRetransmits = 0;
            auto result = h->pc->CreateDataChannelOrError("health", &config);
            if (!result.ok()) return;
            bind_health_channel(h, result.MoveValue());
        });

        return h;
    } catch (...) {
        return nullptr;
    }
}

extern "C" void lib_dspeak_media_p2p_destroy(lib_dspeak_media_p2p_handle_t* h)
{
    try {
        if (!h) return;
        h->closed.store(true, std::memory_order_release);
        bool was_connected = h->connected.exchange(false, std::memory_order_acq_rel);
        dspeak_media_runtime::update_p2p_connection(was_connected, false);
        auto destroy = [h] {
            if (h->health_channel) h->health_channel->UnregisterObserver();
            h->health_observer.reset();
            h->health_channel = nullptr;
            if (h->pc) {
                for (const auto& receiver : h->pc->GetReceivers()) {
                    if (!receiver || !receiver->track()) continue;
                    const auto track = receiver->track();
                    const auto track_id = track->id();
                    if (track->kind() == "audio") {
                        const auto sink = h->audio_sinks_by_id.find(track_id);
                        if (sink != h->audio_sinks_by_id.end())
                            static_cast<webrtc::AudioTrackInterface*>(track.get())
                                ->RemoveSink(sink->second);
                    } else if (track->kind() == "video") {
                        const auto sink = h->video_sinks_by_id.find(track_id);
                        if (sink != h->video_sinks_by_id.end())
                            static_cast<webrtc::VideoTrackInterface*>(track.get())
                                ->RemoveSink(sink->second);
                    }
                }
                h->pc->Close();
                h->pc = nullptr;
            }
            h->audio_sinks_by_id.clear();
            h->video_sinks_by_id.clear();
            h->audio_receivers.clear();
            h->audio_senders.clear();
            h->video_senders.clear();
            h->audio_sinks.clear();
            h->video_sinks.clear();
            h->factory = nullptr;
            delete h->p2p_observer_raw;
            h->p2p_observer_raw = nullptr;
        };
        if (h->signaling_thread)
            h->signaling_thread->BlockingCall(destroy);
        else
            destroy();
        delete h->network_thread;
        delete h->signaling_thread;
        delete h->worker_thread;
        delete h;
    } catch (...) {
        // ignore exceptions in destructor
    }
}

extern "C" int lib_dspeak_media_p2p_send_health(
    lib_dspeak_media_p2p_handle_t* h, const char* message)
{
    if (!h || !h->pc || !message || h->closed.load(std::memory_order_acquire)) return -1;
    try {
        const std::string payload = message;
        return h->signaling_thread->BlockingCall([h, payload] {
            if (!h->health_channel ||
                h->health_channel->state() != webrtc::DataChannelInterface::kOpen)
                return -1;
            return h->health_channel->Send(webrtc::DataBuffer(payload)) ? 0 : -1;
        });
    } catch (...) {
        return -1;
    }
}

extern "C" int lib_dspeak_media_p2p_set_audio_stereo(
    lib_dspeak_media_p2p_handle_t* h, bool stereo)
{
    if (!h || !h->signaling_thread) return -1;
    return h->signaling_thread->BlockingCall([h, stereo] {
        h->audio_stereo = stereo;
        return 0;
    });
}

extern "C" int lib_dspeak_media_p2p_create_offer(lib_dspeak_media_p2p_handle_t* h, char** sdp_out)
{
    if (!h || !h->pc || !sdp_out) return -1;
    try {
        h->last_error.clear();
        auto* obs = new webrtc::RefCountedObject<P2pOfferObserver>(h);
        auto future = obs->GetFuture();
        h->signaling_thread->BlockingCall([h, obs] {
            h->pc->CreateOffer(obs, webrtc::PeerConnectionInterface::RTCOfferAnswerOptions());
        });
        const auto generated_sdp = future.get();
        if (!preferred_video_codecs_are_in_sdp(h, generated_sdp)) {
            h->last_error = "preferred video codec is absent from generated offer";
            return -1;
        }
        webrtc::SdpParseError parse_error;
        auto desc = webrtc::CreateSessionDescription(
            webrtc::SdpType::kOffer, generated_sdp, &parse_error);
        if (!desc) {
            h->last_error = sdp_parse_error_message(parse_error);
            return -1;
        }
        auto* set_obs = new webrtc::RefCountedObject<P2pSetObserver>(h);
        auto set_fut = set_obs->GetFuture();
        h->signaling_thread->BlockingCall([h, set_obs, description = desc.release()] {
            h->pc->SetLocalDescription(set_obs, description);
        });
        set_fut.get();
        std::string local_sdp;
        h->signaling_thread->BlockingCall([h, &local_sdp] {
            const auto* description = h->pc->local_description();
            if (!description) {
                throw std::runtime_error("native local offer is unavailable");
            }
            description->ToString(&local_sdp);
            if (local_sdp.empty())
                throw std::runtime_error("native local offer is empty");
        });
        if (!preferred_video_codecs_are_in_sdp(h, local_sdp)) {
            h->last_error = "preferred video codec is absent from local offer";
            return -1;
        }
        *sdp_out = lib_dspeak_media_strdup(local_sdp.c_str());
        return 0;
    } catch (const std::exception& error) {
        h->last_error = error.what();
        return -1;
    } catch (...) {
        h->last_error = "unknown native offer creation error";
        return -1;
    }
}

extern "C" int lib_dspeak_media_p2p_create_answer(lib_dspeak_media_p2p_handle_t* h, const char* remote_sdp, char** sdp_out)
{
    if (!h || !h->pc || !remote_sdp || !sdp_out) return -1;
    try {
        h->last_error.clear();
        webrtc::SdpParseError error;
        auto desc = webrtc::CreateSessionDescription(webrtc::SdpType::kOffer, remote_sdp, &error);
        if (!desc) {
            h->last_error = sdp_parse_error_message(error);
            return -1;
        }
        auto* set_obs = new webrtc::RefCountedObject<P2pSetObserver>(h);
        auto set_fut = set_obs->GetFuture();
        h->signaling_thread->BlockingCall([h, set_obs, description = desc.release()] {
            h->pc->SetRemoteDescription(set_obs, description);
        });
        set_fut.get();
        auto* obs = new webrtc::RefCountedObject<P2pOfferObserver>(h);
        auto future = obs->GetFuture();
        h->signaling_thread->BlockingCall([h, obs] {
            h->pc->CreateAnswer(obs, webrtc::PeerConnectionInterface::RTCOfferAnswerOptions());
        });
        const auto generated_sdp = future.get();
        if (!preferred_video_codecs_are_in_sdp(h, generated_sdp)) {
            h->last_error = "preferred video codec is absent from generated answer";
            return -1;
        }
        const auto& sdp = generated_sdp;
        *sdp_out = lib_dspeak_media_strdup(sdp.c_str());
        webrtc::SdpParseError answer_error;
        auto answer = webrtc::CreateSessionDescription(
            webrtc::SdpType::kAnswer, sdp, &answer_error);
        if (!answer) {
            h->last_error = sdp_parse_error_message(answer_error);
            return -1;
        }
        auto* set_obs2 = new webrtc::RefCountedObject<P2pSetObserver>(h);
        auto set_fut2 = set_obs2->GetFuture();
        h->signaling_thread->BlockingCall([h, set_obs2, description = answer.release()] {
            h->pc->SetLocalDescription(set_obs2, description);
        });
        set_fut2.get();
        return 0;
    } catch (const std::exception& error) {
        h->last_error = error.what();
        return -1;
    } catch (...) {
        h->last_error = "unknown native answer creation error";
        return -1;
    }
}

extern "C" int lib_dspeak_media_p2p_set_remote_description(
    lib_dspeak_media_p2p_handle_t* h,
    const char* sdp_type,
    const char* sdp)
{
    if (!h || !h->pc || !sdp_type || !sdp) return -1;
    try {
        h->last_error.clear();
        const auto type = sdp_type_from_string(sdp_type);
        if (!type) {
            h->last_error = "unsupported SDP type";
            return -1;
        }
        webrtc::SdpParseError error;
        auto desc = webrtc::CreateSessionDescription(*type, sdp, &error);
        if (!desc) {
            h->last_error = sdp_parse_error_message(error);
            return -1;
        }
        auto* obs = new webrtc::RefCountedObject<P2pSetObserver>(h);
        auto future = obs->GetFuture();
        h->signaling_thread->BlockingCall([h, obs, description = desc.release()] {
            h->pc->SetRemoteDescription(obs, description);
        });
        future.get();
        return 0;
    } catch (const std::exception& error) {
        h->last_error = error.what();
        return -1;
    } catch (...) {
        h->last_error = "unknown native remote description error";
        return -1;
    }
}

extern "C" int lib_dspeak_media_p2p_rollback_local_description(
    lib_dspeak_media_p2p_handle_t* h)
{
    if (!h || !h->pc || !h->signaling_thread) return -1;
    try {
        h->last_error.clear();
        auto description = webrtc::CreateSessionDescription(
            webrtc::SdpType::kRollback, "");
        if (!description) {
            h->last_error = "local rollback description could not be created";
            return -1;
        }
        auto* observer = new webrtc::RefCountedObject<P2pSetObserver>(h);
        auto future = observer->GetFuture();
        h->signaling_thread->BlockingCall(
            [h, observer, description = description.release()] {
                h->pc->SetLocalDescription(observer, description);
            });
        future.get();
        return 0;
    } catch (const std::exception& error) {
        h->last_error = error.what();
        return -1;
    } catch (...) {
        h->last_error = "unknown native local rollback error";
        return -1;
    }
}

extern "C" const char* lib_dspeak_media_p2p_last_error(
    lib_dspeak_media_p2p_handle_t* h)
{
    return h ? h->last_error.c_str() : nullptr;
}

extern "C" int lib_dspeak_media_p2p_add_ice_candidate(lib_dspeak_media_p2p_handle_t* h, const char* candidate)
{
    if (!h || !h->pc || !candidate) return -1;
    try {
        std::string candidate_text = candidate;
        std::string sdp_mid;
        int sdp_mline_index = 0;
        try {
            const auto payload = json::parse(candidate);
            if (payload.is_object() && payload.contains("candidate")) {
                candidate_text = payload.value("candidate", "");
                sdp_mid = payload.value("sdpMid", "");
                sdp_mline_index = payload.value("sdpMLineIndex", 0);
            }
        } catch (...) {}
        if (candidate_text.empty()) return -1;
        webrtc::SdpParseError error;
        auto* ice = webrtc::CreateIceCandidate(
            sdp_mid, sdp_mline_index, candidate_text, &error);
        if (!ice) return -1;
        return h->signaling_thread->BlockingCall([h, ice] {
            return h->pc->AddIceCandidate(ice) ? 0 : -1;
        });
    } catch (...) {
        return -1;
    }
}

extern "C" int lib_dspeak_media_p2p_ice_connection_state(lib_dspeak_media_p2p_handle_t* h)
{
    if (!h || !h->pc) return -1;
    if (h->closed.load(std::memory_order_acquire)) return 3;
    if (h->failed.load(std::memory_order_acquire)) return 2;
    if (h->connected.load(std::memory_order_acquire)) return 1;
    return 0;
}

extern "C" int lib_dspeak_media_p2p_set_jitter_buffer(
    lib_dspeak_media_p2p_handle_t* h,
    const char* track_id,
    int min_delay_ms,
    int target_delay_ms)
{
    if (!h || !h->signaling_thread || !track_id) return -1;
    const std::string id = track_id;
    const auto minimum_delay_ms = std::max(0, min_delay_ms);
    const auto target_delay = std::max(0, target_delay_ms);
    return h->signaling_thread->BlockingCall([h, id, minimum_delay_ms, target_delay] {
        const auto receiver = h->audio_receivers.find(id);
        if (receiver == h->audio_receivers.end() || !receiver->second) return -1;
        receiver->second->SetJitterBufferMinimumDelay(
            static_cast<double>(minimum_delay_ms) / 1000.0);
        const auto sink = h->audio_sinks_by_id.find(id);
        if (sink == h->audio_sinks_by_id.end() || !sink->second) return -1;
        sink->second->SetJitterBuffer(minimum_delay_ms, target_delay);
        return 0;
    });
}

extern "C" int lib_dspeak_media_p2p_restart_ice(lib_dspeak_media_p2p_handle_t* h, char** sdp_out)
{
    if (!h || !h->pc || !sdp_out) return -1;
    try {
        webrtc::PeerConnectionInterface::RTCOfferAnswerOptions opts;
        opts.ice_restart = true;
        h->last_error.clear();
        auto* obs = new webrtc::RefCountedObject<P2pOfferObserver>(h);
        auto future = obs->GetFuture();
        h->signaling_thread->BlockingCall([h, obs, opts] {
            h->pc->CreateOffer(obs, opts);
        });
        const auto generated_sdp = future.get();
        if (!preferred_video_codecs_are_in_sdp(h, generated_sdp)) {
            h->last_error = "preferred video codec is absent from ICE restart offer";
            return -1;
        }
        const auto& sdp = generated_sdp;
        *sdp_out = lib_dspeak_media_strdup(sdp.c_str());
        webrtc::SdpParseError parse_error;
        auto desc = webrtc::CreateSessionDescription(
            webrtc::SdpType::kOffer, sdp, &parse_error);
        if (!desc) {
            h->last_error = sdp_parse_error_message(parse_error);
            return -1;
        }
        auto* set_obs = new webrtc::RefCountedObject<P2pSetObserver>(h);
        auto set_fut = set_obs->GetFuture();
        h->signaling_thread->BlockingCall([h, set_obs, description = desc.release()] {
            h->pc->SetLocalDescription(set_obs, description);
        });
        set_fut.get();
        return 0;
    } catch (const std::exception& error) {
        h->last_error = error.what();
        return -1;
    } catch (...) {
        h->last_error = "unknown native ICE restart error";
        return -1;
    }
}

extern "C" char* lib_dspeak_media_p2p_get_stats(lib_dspeak_media_p2p_handle_t* h)
{
    if (!h || !h->pc || !h->signaling_thread ||
        h->closed.load(std::memory_order_acquire))
        return nullptr;
    try {
        auto observer = webrtc::make_ref_counted<P2pStatsObserver>();
        auto future = observer->GetFuture();
        h->signaling_thread->BlockingCall([h, observer] {
            h->pc->GetStats(observer.get());
        });
        const auto stats = future.get();
        return lib_dspeak_media_strdup(stats.c_str());
    } catch (...) {
        return nullptr;
    }
}
