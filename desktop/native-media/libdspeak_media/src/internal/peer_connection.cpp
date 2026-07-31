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


/* ── P2P (PeerConnection) transport ─────────────────── */


namespace {

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
    void OnDataChannel(webrtc::scoped_refptr<webrtc::DataChannelInterface>) override {}

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
            handle_->audio_sinks.push_back(std::move(sink));
        } else if (kind == "video") {
            auto sink = std::make_unique<NativeReceiveVideoSink>(track_id);
            static_cast<webrtc::VideoTrackInterface*>(track.get())->AddOrUpdateSink(
                sink.get(), webrtc::VideoSinkWants());
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

}

extern "C" lib_dspeak_media_p2p_handle_t* lib_dspeak_media_p2p_create(void)
{
    auto* h = new(std::nothrow) lib_dspeak_media_p2p_handle();
    if (!h) return nullptr;

    h->signaling_thread = webrtc::Thread::Create().release();
    h->signaling_thread->Start();
    h->worker_thread = webrtc::Thread::Create().release();
    h->worker_thread->Start();
    auto audio_device = webrtc::CreateAudioDeviceModule(
        webrtc::CreateEnvironment(),
        webrtc::AudioDeviceModule::kPlatformDefaultAudio);
    if (!audio_device) {
        delete h->signaling_thread;
        delete h->worker_thread;
        delete h;
        return nullptr;
    }

    h->factory = webrtc::CreatePeerConnectionFactory(
        /*network_thread=*/nullptr,
        h->worker_thread,
        h->signaling_thread,
        /*default_adm=*/audio_device,
        /*audio_encoder_factory=*/webrtc::CreateBuiltinAudioEncoderFactory(),
        /*audio_decoder_factory=*/webrtc::CreateBuiltinAudioDecoderFactory(),
        /*video_encoder_factory=*/nullptr,
        /*video_decoder_factory=*/nullptr,
        /*audio_mixer=*/nullptr,
        /*audio_processing=*/nullptr);
    if (!h->factory) {
        delete h->signaling_thread;
        delete h->worker_thread;
        delete h;
        return nullptr;
    }

    webrtc::PeerConnectionInterface::RTCConfiguration config;
    config.sdp_semantics = webrtc::SdpSemantics::kUnifiedPlan;

    auto* observer = new webrtc::RefCountedObject<P2pObserver>(h);
    auto result = h->factory->CreatePeerConnectionOrError(
        config, webrtc::PeerConnectionDependencies(observer));
    if (!result.ok()) {
        h->factory = nullptr;
        delete h->signaling_thread;
        delete h->worker_thread;
        delete h;
        return nullptr;
    }
    h->pc = std::move(result).value();
    if (!h->pc) {
        h->factory = nullptr;
        delete h->signaling_thread;
        delete h->worker_thread;
        delete h;
        return nullptr;
    }

    return h;
}

extern "C" void lib_dspeak_media_p2p_destroy(lib_dspeak_media_p2p_handle_t* h)
{
    if (!h) return;
    h->closed = true;
    dspeak_media_runtime::update_p2p_connection(h->connected, false);
    auto destroy = [h] {
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
    delete h->signaling_thread;
    delete h->worker_thread;
    delete h;
}

extern "C" int lib_dspeak_media_p2p_create_offer(lib_dspeak_media_p2p_handle_t* h, char** sdp_out)
{
    if (!h || !h->pc || !sdp_out) return -1;

    auto* obs = new webrtc::RefCountedObject<P2pOfferObserver>();
    auto future = obs->GetFuture();
    h->pc->CreateOffer(obs, webrtc::PeerConnectionInterface::RTCOfferAnswerOptions());

    try {
        std::string sdp = future.get();
        *sdp_out = lib_dspeak_media_strdup(sdp.c_str());

        auto desc = webrtc::CreateSessionDescription(webrtc::SdpType::kOffer, sdp);
        if (!desc) return -1;

        auto* set_obs = new webrtc::RefCountedObject<P2pSetObserver>();
        auto set_fut = set_obs->GetFuture();
        h->pc->SetLocalDescription(set_obs, desc.release());
        set_fut.get();
        return 0;
    } catch (...) {
        return -1;
    }
}

extern "C" int lib_dspeak_media_p2p_create_answer(lib_dspeak_media_p2p_handle_t* h, const char* remote_sdp, char** sdp_out)
{
    if (!h || !h->pc || !remote_sdp || !sdp_out) return -1;

    webrtc::SdpParseError error;
    auto desc = webrtc::CreateSessionDescription(webrtc::SdpType::kOffer, remote_sdp, &error);
    if (!desc) return -1;

    {
        auto* set_obs = new webrtc::RefCountedObject<P2pSetObserver>();
        auto set_fut = set_obs->GetFuture();
        h->pc->SetRemoteDescription(set_obs, desc.release());
        set_fut.get();
    }

    auto* obs = new webrtc::RefCountedObject<P2pOfferObserver>();
    auto future = obs->GetFuture();
    h->pc->CreateAnswer(obs, webrtc::PeerConnectionInterface::RTCOfferAnswerOptions());

    try {
        std::string sdp = future.get();
        *sdp_out = lib_dspeak_media_strdup(sdp.c_str());

        auto answer = webrtc::CreateSessionDescription(webrtc::SdpType::kAnswer, sdp);
        if (!answer) return -1;

        auto* set_obs2 = new webrtc::RefCountedObject<P2pSetObserver>();
        auto set_fut2 = set_obs2->GetFuture();
        h->pc->SetLocalDescription(set_obs2, answer.release());
        set_fut2.get();
        return 0;
    } catch (...) {
        return -1;
    }
}

extern "C" int lib_dspeak_media_p2p_set_remote_description(lib_dspeak_media_p2p_handle_t* h, const char* sdp)
{
    if (!h || !h->pc || !sdp) return -1;

    webrtc::SdpParseError error;
    auto desc = webrtc::CreateSessionDescription(webrtc::SdpType::kOffer, sdp, &error);
    if (!desc) {
        desc = webrtc::CreateSessionDescription(webrtc::SdpType::kAnswer, sdp, &error);
        if (!desc) return -1;
    }

    auto* obs = new webrtc::RefCountedObject<P2pSetObserver>();
    auto future = obs->GetFuture();
    h->pc->SetRemoteDescription(obs, desc.release());
    future.get();
    return 0;
}

extern "C" int lib_dspeak_media_p2p_add_ice_candidate(lib_dspeak_media_p2p_handle_t* h, const char* candidate)
{
    if (!h || !h->pc || !candidate) return -1;

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
    h->pc->AddIceCandidate(ice);
    return 0;
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

    webrtc::PeerConnectionInterface::RTCOfferAnswerOptions opts;
    opts.ice_restart = true;

    auto* obs = new webrtc::RefCountedObject<P2pOfferObserver>();
    auto future = obs->GetFuture();
    h->pc->CreateOffer(obs, opts);

    try {
        std::string sdp = future.get();
        *sdp_out = lib_dspeak_media_strdup(sdp.c_str());

        auto desc = webrtc::CreateSessionDescription(webrtc::SdpType::kOffer, sdp);
        if (!desc) return -1;

        auto* set_obs = new webrtc::RefCountedObject<P2pSetObserver>();
        auto set_fut = set_obs->GetFuture();
        h->pc->SetLocalDescription(set_obs, desc.release());
        set_fut.get();
        return 0;
    } catch (...) {
        return -1;
    }
}
