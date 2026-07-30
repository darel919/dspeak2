#include "lib_dspeak_media/lib_dspeak_media.h"
#include <json.hpp>
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
        webrtc::PeerConnectionInterface::SignalingState
        /*new_state*/) override {}

    void OnIceCandidate(const webrtc::IceCandidateInterface* candidate) override {
        std::string sdp;
        if (candidate->ToString(&sdp)) {
            std::lock_guard<std::mutex> lock(handle_->ice_mutex);
            handle_->ice_candidates.push(sdp);
        }
    }

    void OnIceConnectionChange(
        webrtc::PeerConnectionInterface::IceConnectionState state) override {
        handle_->connected = (state == webrtc::PeerConnectionInterface::kIceConnectionConnected);
        handle_->failed    = (state == webrtc::PeerConnectionInterface::kIceConnectionFailed);
    }

    void OnIceGatheringChange(webrtc::PeerConnectionInterface::IceGatheringState) override {}
    void OnIceConnectionReceivingChange(bool) override {}
    void OnAddStream(webrtc::scoped_refptr<webrtc::MediaStreamInterface>) override {}
    void OnRemoveStream(webrtc::scoped_refptr<webrtc::MediaStreamInterface>) override {}
    void OnDataChannel(webrtc::scoped_refptr<webrtc::DataChannelInterface>) override {}
    void OnRenegotiationNeeded() override {}

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

    h->factory = webrtc::CreatePeerConnectionFactory(
        /*network_thread=*/nullptr,
        h->worker_thread,
        h->signaling_thread,
        /*default_adm=*/nullptr,
        /*audio_encoder_factory=*/nullptr,
        /*audio_decoder_factory=*/nullptr,
        /*video_encoder_factory=*/nullptr,
        /*video_decoder_factory=*/nullptr,
        /*audio_mixer=*/nullptr,
        /*audio_processing=*/nullptr);
    if (!h->factory) { delete h; return nullptr; }

    webrtc::PeerConnectionInterface::RTCConfiguration config;
    config.sdp_semantics = webrtc::SdpSemantics::kUnifiedPlan;

    auto* observer = new webrtc::RefCountedObject<P2pObserver>(h);
    auto result = h->factory->CreatePeerConnectionOrError(
        config, webrtc::PeerConnectionDependencies(observer));
    if (!result.ok()) { delete h; return nullptr; }
    h->pc = std::move(result).value();
    if (!h->pc) { delete h; return nullptr; }

    return h;
}

extern "C" void lib_dspeak_media_p2p_destroy(lib_dspeak_media_p2p_handle_t* h)
{
    if (!h) return;
    if (h->pc) { h->pc->Close(); h->pc = nullptr; }
    h->factory = nullptr;
    if (h->signaling_thread) { delete h->signaling_thread; }
    if (h->worker_thread) { delete h->worker_thread; }
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

    webrtc::SdpParseError error;
    auto* ice = webrtc::CreateIceCandidate("", 0, candidate, &error);
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
