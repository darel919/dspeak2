#include "lib_dspeak_media/lib_dspeak_media.h"
#include <json.hpp>
#include "media_handles.hpp"
#include "runtime_health.hpp"

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
#include <sstream>

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
#include <api/video_codecs/video_decoder_factory_template.h>
#include <api/video_codecs/video_decoder_factory_template_dav1d_adapter.h>
#include <api/video_codecs/video_decoder_factory_template_libvpx_vp8_adapter.h>
#include <api/video_codecs/video_decoder_factory_template_libvpx_vp9_adapter.h>
#include <api/video_codecs/video_decoder_factory_template_open_h264_adapter.h>
#include <api/video_codecs/video_encoder_factory_template.h>
#include <api/video_codecs/video_encoder_factory_template_libaom_av1_adapter.h>
#include <api/video_codecs/video_encoder_factory_template_libvpx_vp8_adapter.h>
#include <api/video_codecs/video_encoder_factory_template_libvpx_vp9_adapter.h>
#include <api/video_codecs/video_encoder_factory_template_open_h264_adapter.h>
#include <api/media_stream_interface.h>
#include <api/peer_connection_interface.h>
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

static std::string apply_native_opus_profile(std::string sdp, bool stereo)
{
    const auto audio_start = sdp.find("m=audio ");
    if (audio_start == std::string::npos) return sdp;
    const auto next_media = sdp.find("\nm=", audio_start + 1);
    const auto audio_end = next_media == std::string::npos ? sdp.size() : next_media;
    std::string section = sdp.substr(audio_start, audio_end - audio_start);
    auto rtp_start = section.find("a=rtpmap:");
    size_t rtp_end = std::string::npos;
    while (rtp_start != std::string::npos) {
        rtp_end = section.find_first_of("\r\n", rtp_start);
        const auto rtp_line = section.substr(rtp_start, rtp_end - rtp_start);
        if (rtp_line.find(" opus/48000/2") != std::string::npos) break;
        rtp_start = section.find("a=rtpmap:", rtp_end == std::string::npos ? section.size() : rtp_end);
    }
    if (rtp_start == std::string::npos) return sdp;
    const auto payload_start = rtp_start + 9;
    const auto payload_end = section.find(' ', payload_start);
    if (payload_end == std::string::npos) return sdp;
    const auto payload = section.substr(payload_start, payload_end - payload_start);
    const std::string fmtp_prefix = "a=fmtp:" + payload + " ";
    const std::string stereo_value = stereo ? "1" : "0";
    const std::string required[] = {
        "stereo=" + stereo_value, "sprop-stereo=" + stereo_value,
        "useinbandfec=1", "usedtx=0", "minptime=10",
    };
    const auto fmtp_start = section.find(fmtp_prefix);
    if (fmtp_start == std::string::npos) {
        section.insert(rtp_end == std::string::npos ? section.size() : rtp_end,
                       fmtp_prefix + "stereo=" + stereo_value + ";sprop-stereo=" +
                           stereo_value + ";useinbandfec=1;usedtx=0;minptime=10\r\n");
    } else {
        const auto fmtp_end = section.find_first_of("\r\n", fmtp_start);
        const auto existing = section.substr(fmtp_start + fmtp_prefix.size(), fmtp_end - fmtp_start - fmtp_prefix.size());
        std::vector<std::string> parameters;
        std::stringstream stream(existing);
        std::string parameter;
        while (std::getline(stream, parameter, ';')) {
            const auto equals = parameter.find('=');
            const auto key = parameter.substr(0, equals);
            if (key != "stereo" && key != "sprop-stereo" && key != "useinbandfec" &&
                key != "usedtx" && key != "minptime")
                parameters.push_back(parameter);
        }
        for (const auto& value : required) parameters.push_back(value);
        std::string next_fmtp = fmtp_prefix;
        for (size_t index = 0; index < parameters.size(); ++index) {
            if (index) next_fmtp += ";";
            next_fmtp += parameters[index];
        }
        section.replace(fmtp_start, fmtp_end - fmtp_start, next_fmtp);
    }
    const auto ptime_start = section.find("a=ptime:");
    if (ptime_start == std::string::npos) {
        section += "a=ptime:10\r\n";
    } else {
        const auto ptime_end = section.find_first_of("\r\n", ptime_start);
        section.replace(ptime_start, ptime_end - ptime_start, "a=ptime:10");
    }
    sdp.replace(audio_start, audio_end - audio_start, section);
    return sdp;
}


/* ── P2P (PeerConnection) transport ─────────────────── */


class P2pHealthDataChannelObserver : public webrtc::DataChannelObserver {
public:
    P2pHealthDataChannelObserver(
        lib_dspeak_media_p2p_handle* handle,
        webrtc::scoped_refptr<webrtc::DataChannelInterface> channel)
        : handle_(handle), channel_(std::move(channel)) {}

    void OnStateChange() override {
        if (!handle_ || !channel_) return;
        const auto state = channel_->state();
        lib_dspeak_media_push_p2p_event(
            reinterpret_cast<uint64_t>(handle_),
            "data-channel-state", "", "",
            webrtc::DataChannelInterface::DataStateString(state));
    }

    void OnMessage(const webrtc::DataBuffer& buffer) override {
        if (!handle_ || buffer.binary || buffer.data.size() == 0) return;
        const std::string text(
            reinterpret_cast<const char*>(buffer.data.data()), buffer.data.size());
        try {
            const auto message = json::parse(text);
            const auto type = message.value("type", "");
            if (type != "health" && type != "health-ack") return;
            const auto sequence = message.value("sequence", 0U);
            lib_dspeak_media_push_p2p_event(
                reinterpret_cast<uint64_t>(handle_), "health-received", "", "",
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
        reinterpret_cast<uint64_t>(handle), "data-channel-state", "", "",
        webrtc::DataChannelInterface::DataStateString(channel->state()));
}

class P2pObserver : public webrtc::PeerConnectionObserver {
public:
    explicit P2pObserver(lib_dspeak_media_p2p_handle* h) : handle_(h) {}

    void OnSignalingChange(
        webrtc::PeerConnectionInterface::SignalingState new_state) override {
        lib_dspeak_media_push_p2p_event(
            reinterpret_cast<uint64_t>(handle_),
            "signaling-state", "", "", std::to_string(static_cast<int>(new_state)).c_str());
    }

    void OnIceCandidate(const webrtc::IceCandidateInterface* candidate) override {
        if (!candidate) return;
        std::string sdp;
        if (candidate->ToString(&sdp)) {
            const auto payload = json{
                {"candidate", sdp},
                {"sdpMid", candidate->sdp_mid()},
                {"sdpMLineIndex", candidate->sdp_mline_index()},
            };
            const auto serialized = payload.dump();
            {
                std::lock_guard<std::mutex> lock(handle_->ice_mutex);
                handle_->ice_candidates.push(serialized);
            }
            lib_dspeak_media_push_p2p_event(
                reinterpret_cast<uint64_t>(handle_), "ice-candidate", "", "", serialized.c_str());
        }
    }

    void OnIceConnectionChange(
        webrtc::PeerConnectionInterface::IceConnectionState state) override {
        const bool connected =
            state == webrtc::PeerConnectionInterface::kIceConnectionConnected ||
            state == webrtc::PeerConnectionInterface::kIceConnectionCompleted;
        dspeak_media_runtime::update_p2p_connection(handle_->connected, connected);
        handle_->failed = state == webrtc::PeerConnectionInterface::kIceConnectionFailed;
        lib_dspeak_media_push_p2p_event(
            reinterpret_cast<uint64_t>(handle_),
            "ice-state", "", "", std::to_string(static_cast<int>(state)).c_str());
    }

    void OnIceGatheringChange(
        webrtc::PeerConnectionInterface::IceGatheringState state) override {
        lib_dspeak_media_push_p2p_event(
            reinterpret_cast<uint64_t>(handle_),
            "ice-gathering-state", "", "", std::to_string(static_cast<int>(state)).c_str());
    }
    void OnIceConnectionReceivingChange(bool receiving) override {
        lib_dspeak_media_push_p2p_event(
            reinterpret_cast<uint64_t>(handle_),
            "ice-receiving", "", "", receiving ? "true" : "false");
    }
    void OnAddStream(webrtc::scoped_refptr<webrtc::MediaStreamInterface>) override {}
    void OnRemoveStream(webrtc::scoped_refptr<webrtc::MediaStreamInterface>) override {}
    void OnDataChannel(
        webrtc::scoped_refptr<webrtc::DataChannelInterface> channel) override {
        bind_health_channel(handle_, std::move(channel));
    }

    void OnTrack(webrtc::scoped_refptr<webrtc::RtpTransceiverInterface> transceiver) override {
        if (!transceiver || !transceiver->receiver()) return;
        auto track = transceiver->receiver()->track();
        if (!track) return;
        const auto kind = track->kind();
        const auto track_id = track->id();
        lib_dspeak_media_push_p2p_event(
            reinterpret_cast<uint64_t>(handle_), "track-added", track_id.c_str(), kind.c_str(), "");
        if (kind == "audio") {
            auto sink = std::make_unique<NativeReceiveAudioSink>(track_id);
            static_cast<webrtc::AudioTrackInterface*>(track.get())->AddSink(sink.get());
            sink->SetEnabled(true);
            handle_->audio_sinks.push_back(std::move(sink));
        } else if (kind == "video") {
            auto sink = std::make_unique<NativeReceiveVideoSink>(track_id);
            static_cast<webrtc::VideoTrackInterface*>(track.get())->AddOrUpdateSink(
                sink.get(), webrtc::VideoSinkWants());
            sink->SetEnabled(true);
            handle_->video_sinks.push_back(std::move(sink));
        }
    }

    void OnRemoveTrack(
        webrtc::scoped_refptr<webrtc::RtpReceiverInterface> receiver) override {
        if (!receiver || !receiver->track()) return;
        lib_dspeak_media_push_p2p_event(
            reinterpret_cast<uint64_t>(handle_),
            "track-removed", receiver->track()->id().c_str(), receiver->track()->kind().c_str(), "");
    }

    void OnRenegotiationNeeded() override {
        lib_dspeak_media_push_p2p_event(
            reinterpret_cast<uint64_t>(handle_), "renegotiation-needed", "", "", "");
    }

private:
    lib_dspeak_media_p2p_handle* handle_;
};

class P2pOfferObserver : public webrtc::CreateSessionDescriptionObserver {
public:
    P2pOfferObserver() : promise_(std::promise<std::string>()) {}
    std::future<std::string> GetFuture() { return promise_.get_future(); }

    void OnSuccess(webrtc::SessionDescriptionInterface* desc) override {
        std::string sdp;
        desc->ToString(&sdp);
        promise_.set_value(sdp);
    }

    void OnFailure(webrtc::RTCError error) override {
        promise_.set_exception(
            std::make_exception_ptr(std::runtime_error(error.message())));
    }

private:
    std::promise<std::string> promise_;
};

class P2pSetObserver : public webrtc::SetSessionDescriptionObserver {
public:
    P2pSetObserver() : promise_(std::promise<void>()) {}
    std::future<void> GetFuture() { return promise_.get_future(); }

    void OnSuccess() override { promise_.set_value(); }
    void OnFailure(webrtc::RTCError error) override {
        promise_.set_exception(
            std::make_exception_ptr(std::runtime_error(error.message())));
    }

private:
    std::promise<void> promise_;
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

}

extern "C" lib_dspeak_media_p2p_handle_t* lib_dspeak_media_p2p_create(
    const char* ice_servers_json, bool offerer)
{
    try {
        auto* h = new(std::nothrow) lib_dspeak_media_p2p_handle();
        if (!h) return nullptr;

        h->network_thread = webrtc::Thread::CreateWithSocketServer().release();
        h->network_thread->SetName("dspeak_p2p_network", nullptr);
        h->network_thread->Start();
        h->signaling_thread = webrtc::Thread::Create().release();
        h->signaling_thread->SetName("dspeak_p2p_signaling", nullptr);
        h->signaling_thread->Start();
        h->worker_thread = webrtc::Thread::Create().release();
        h->worker_thread->SetName("dspeak_p2p_worker", nullptr);
        h->worker_thread->Start();

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
            std::make_unique<webrtc::VideoEncoderFactoryTemplate<
                webrtc::LibvpxVp8EncoderTemplateAdapter,
                webrtc::LibvpxVp9EncoderTemplateAdapter,
                webrtc::OpenH264EncoderTemplateAdapter,
                webrtc::LibaomAv1EncoderTemplateAdapter>>(),
            std::make_unique<webrtc::VideoDecoderFactoryTemplate<
                webrtc::LibvpxVp8DecoderTemplateAdapter,
                webrtc::LibvpxVp9DecoderTemplateAdapter,
                webrtc::OpenH264DecoderTemplateAdapter,
                webrtc::Dav1dDecoderTemplateAdapter>>(),
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

        auto* observer = new webrtc::RefCountedObject<P2pObserver>(h);
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
        h->closed = true;
        dspeak_media_runtime::update_p2p_connection(h->connected, false);
        auto destroy = [h] {
            if (h->health_channel) h->health_channel->UnregisterObserver();
            h->health_observer.reset();
            h->health_channel = nullptr;
            if (h->pc) {
                h->pc->Close();
                h->pc = nullptr;
            }
            h->audio_sinks.clear();
            h->video_sinks.clear();
            h->factory = nullptr;
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
    if (!h || !h->pc || !message || h->closed) return -1;
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
        auto* obs = new webrtc::RefCountedObject<P2pOfferObserver>();
        auto future = obs->GetFuture();
        h->signaling_thread->BlockingCall([h, obs] {
            h->pc->CreateOffer(obs, webrtc::PeerConnectionInterface::RTCOfferAnswerOptions());
        });
        std::string sdp = apply_native_opus_profile(future.get(), h->audio_stereo);
        *sdp_out = lib_dspeak_media_strdup(sdp.c_str());
        auto desc = webrtc::CreateSessionDescription(webrtc::SdpType::kOffer, sdp);
        if (!desc) return -1;
        auto* set_obs = new webrtc::RefCountedObject<P2pSetObserver>();
        auto set_fut = set_obs->GetFuture();
        h->signaling_thread->BlockingCall([h, set_obs, description = desc.release()] {
            h->pc->SetLocalDescription(set_obs, description);
        });
        set_fut.get();
        return 0;
    } catch (...) {
        return -1;
    }
}

extern "C" int lib_dspeak_media_p2p_create_answer(lib_dspeak_media_p2p_handle_t* h, const char* remote_sdp, char** sdp_out)
{
    if (!h || !h->pc || !remote_sdp || !sdp_out) return -1;
    try {
        webrtc::SdpParseError error;
        auto desc = webrtc::CreateSessionDescription(webrtc::SdpType::kOffer, remote_sdp, &error);
        if (!desc) return -1;
        auto* set_obs = new webrtc::RefCountedObject<P2pSetObserver>();
        auto set_fut = set_obs->GetFuture();
        h->signaling_thread->BlockingCall([h, set_obs, description = desc.release()] {
            h->pc->SetRemoteDescription(set_obs, description);
        });
        set_fut.get();
        auto* obs = new webrtc::RefCountedObject<P2pOfferObserver>();
        auto future = obs->GetFuture();
        h->signaling_thread->BlockingCall([h, obs] {
            h->pc->CreateAnswer(obs, webrtc::PeerConnectionInterface::RTCOfferAnswerOptions());
        });
        std::string sdp = apply_native_opus_profile(future.get(), h->audio_stereo);
        *sdp_out = lib_dspeak_media_strdup(sdp.c_str());
        auto answer = webrtc::CreateSessionDescription(webrtc::SdpType::kAnswer, sdp);
        if (!answer) return -1;
        auto* set_obs2 = new webrtc::RefCountedObject<P2pSetObserver>();
        auto set_fut2 = set_obs2->GetFuture();
        h->signaling_thread->BlockingCall([h, set_obs2, description = answer.release()] {
            h->pc->SetLocalDescription(set_obs2, description);
        });
        set_fut2.get();
        return 0;
    } catch (...) {
        return -1;
    }
}

extern "C" int lib_dspeak_media_p2p_set_remote_description(lib_dspeak_media_p2p_handle_t* h, const char* sdp)
{
    if (!h || !h->pc || !sdp) return -1;
    try {
        webrtc::SdpParseError error;
        auto desc = webrtc::CreateSessionDescription(webrtc::SdpType::kOffer, sdp, &error);
        if (!desc) {
            desc = webrtc::CreateSessionDescription(webrtc::SdpType::kAnswer, sdp, &error);
            if (!desc) return -1;
        }
        auto* obs = new webrtc::RefCountedObject<P2pSetObserver>();
        auto future = obs->GetFuture();
        h->signaling_thread->BlockingCall([h, obs, description = desc.release()] {
            h->pc->SetRemoteDescription(obs, description);
        });
        future.get();
        return 0;
    } catch (...) {
        return -1;
    }
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

extern "C" char* lib_dspeak_media_p2p_poll_ice_candidate(lib_dspeak_media_p2p_handle_t* h)
{
    if (!h) return nullptr;
    std::lock_guard<std::mutex> lock(h->ice_mutex);
    if (h->ice_candidates.empty()) return nullptr;
    auto s = h->ice_candidates.front();
    h->ice_candidates.pop();
    return lib_dspeak_media_strdup(s.c_str());
}

extern "C" int lib_dspeak_media_p2p_ice_connection_state(lib_dspeak_media_p2p_handle_t* h)
{
    if (!h || !h->pc) return -1;
    if (h->closed)  return 3;
    if (h->failed)  return 2;
    if (h->connected) return 1;
    return 0;
}

extern "C" int lib_dspeak_media_p2p_restart_ice(lib_dspeak_media_p2p_handle_t* h, char** sdp_out)
{
    if (!h || !h->pc || !sdp_out) return -1;
    try {
        webrtc::PeerConnectionInterface::RTCOfferAnswerOptions opts;
        opts.ice_restart = true;
        auto* obs = new webrtc::RefCountedObject<P2pOfferObserver>();
        auto future = obs->GetFuture();
        h->signaling_thread->BlockingCall([h, obs, opts] {
            h->pc->CreateOffer(obs, opts);
        });
        std::string sdp = apply_native_opus_profile(future.get(), h->audio_stereo);
        *sdp_out = lib_dspeak_media_strdup(sdp.c_str());
        auto desc = webrtc::CreateSessionDescription(webrtc::SdpType::kOffer, sdp);
        if (!desc) return -1;
        auto* set_obs = new webrtc::RefCountedObject<P2pSetObserver>();
        auto set_fut = set_obs->GetFuture();
        h->signaling_thread->BlockingCall([h, set_obs, description = desc.release()] {
            h->pc->SetLocalDescription(set_obs, description);
        });
        set_fut.get();
        return 0;
    } catch (...) {
        return -1;
    }
}
