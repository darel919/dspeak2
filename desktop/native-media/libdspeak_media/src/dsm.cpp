#include "dsm/dsm.h"

#include <cstring>
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
#include <libyuv/convert.h>
#endif

#if defined(__APPLE__)
#include "PlatformCapture.h"
#endif

using json = nlohmann::json;

/* ── Internal helpers ────────────────────────────── */

static char* strdup_c(const char* s)
{
    if (!s) return nullptr;
    auto* p = std::malloc(std::strlen(s) + 1);
    std::memcpy(p, s, std::strlen(s) + 1);
    return static_cast<char*>(p);
}

static json json_arg(const char* s)
{
    return s ? json::parse(s) : json::object();
}

static char* json_to_cstr(const json& j)
{
    auto s = j.dump();
    return strdup_c(s.c_str());
}

/* ── Action queue ─────────────────────────────────── */

struct CxxAction {
    dsm_action_kind_t kind;
    void*             transport_ptr;
    uint64_t          action_id;
    char*             params_json;
    char*             state;
};

static inline uint64_t next_action_id()
{
    static std::atomic<uint64_t> counter{1};
    return counter.fetch_add(1);
}

static std::mutex               g_action_mutex;
static std::queue<CxxAction>    g_actions;

#if defined(__APPLE__)
// Capture is deliberately kept as a separate platform bridge. This C ABI
// layer owns the bridge handles so callers cannot start a second capture
// before the first one has stopped.
static std::mutex g_capture_mutex;
static dsm_screen_capture* g_screen_capture = nullptr;
static dsm_audio_capture* g_system_audio_capture = nullptr;

static void discard_screen_frame(void*, void*) {}
static void discard_audio_frame(void*, const float*, uint32_t, uint32_t, uint8_t) {}
#endif

static void push_action(dsm_action_kind_t kind,
                        void* tport, uint64_t aid,
                    const json* params, const json* st)
{
    CxxAction act;
    act.kind         = kind;
    act.transport_ptr = tport;
    act.action_id    = aid;
    act.params_json  = params ? json_to_cstr(*params) : nullptr;
    act.state        = st     ? json_to_cstr(*st)     : nullptr;
    std::lock_guard<std::mutex> lock(g_action_mutex);
    g_actions.push(std::move(act));
}

/* ── Forward declarations for promise globals ───────── */
static std::mutex g_promise_mutex;
static std::map<void*, std::promise<void>>        g_connect_promises;
static std::map<uint64_t, std::promise<std::string>> g_produce_promises;

/* ── Listener: SendTransport ───────────────────────── */

class CxxSendListener : public mediasoupclient::SendTransport::Listener {
public:
    std::future<void> OnConnect(mediasoupclient::Transport* transport,
                                const json& dtlsParameters) override
    {
        auto p = std::promise<void>();
        auto f = p.get_future();
        {
            std::lock_guard<std::mutex> lock(g_promise_mutex);
            g_connect_promises[static_cast<void*>(transport)] = std::move(p);
        }
        push_action(DSM_ACTION_TRANSPORT_CONNECT,
                static_cast<void*>(transport), next_action_id(),
                &dtlsParameters, nullptr);
        return f;
    }

    void OnConnectionStateChange(mediasoupclient::Transport* transport,
                                 const std::string& connectionState) override
    {
        json j(connectionState);
        push_action(DSM_ACTION_NONE,
                static_cast<void*>(transport), 0,
                nullptr, &j);
    }

    std::future<std::string> OnProduce(
        mediasoupclient::SendTransport* transport,
        const std::string& kind,
        json rtpParameters,
        const json& appData) override
    {
        auto p = std::promise<std::string>();
        auto f = p.get_future();
        uint64_t aid = next_action_id();
        {
            std::lock_guard<std::mutex> lock(g_promise_mutex);
            g_produce_promises[aid] = std::move(p);
        }
        json params;
        params["kind"]           = kind;
        params["rtpParameters"]  = rtpParameters;
        params["appData"]        = appData;
        push_action(DSM_ACTION_PRODUCER_CREATED,
                static_cast<void*>(transport), aid,
                &params, nullptr);
        return f;
    }

    std::future<std::string> OnProduceData(
        mediasoupclient::SendTransport* transport,
        const json& sctpStreamParameters,
        const std::string& label,
        const std::string& protocol,
        const json& appData) override
    {
        auto p = std::promise<std::string>();
        auto f = p.get_future();
        uint64_t aid = next_action_id();
        {
            std::lock_guard<std::mutex> lock(g_promise_mutex);
            g_produce_promises[aid] = std::move(p);
        }
        json params;
        params["sctpStreamParameters"] = sctpStreamParameters;
        params["label"]               = label;
        params["protocol"]            = protocol;
        params["appData"]             = appData;
        push_action(DSM_ACTION_CONSUMER_CREATED,
                static_cast<void*>(transport), aid,
                &params, nullptr);
        return f;
    }
};

/* ── Listener: RecvTransport ───────────────────────── */

class CxxRecvListener : public mediasoupclient::RecvTransport::Listener {
public:
    std::future<void> OnConnect(mediasoupclient::Transport* transport,
                                const json& dtlsParameters) override
    {
        auto p = std::promise<void>();
        auto f = p.get_future();
        {
            std::lock_guard<std::mutex> lock(g_promise_mutex);
            g_connect_promises[static_cast<void*>(transport)] = std::move(p);
        }
        push_action(DSM_ACTION_TRANSPORT_CONNECT,
                static_cast<void*>(transport), next_action_id(),
                &dtlsParameters, nullptr);
        return f;
    }

    void OnConnectionStateChange(mediasoupclient::Transport* transport,
                                 const std::string& connectionState) override
    {
        json j(connectionState);
        push_action(DSM_ACTION_NONE,
                static_cast<void*>(transport), 0,
                nullptr, &j);
    }
};

/* ── Global state ─────────────────────────────────── */

static std::vector<std::shared_ptr<CxxSendListener>> g_send_listeners;
static std::vector<std::shared_ptr<CxxRecvListener>> g_recv_listeners;

/* ── Lifecycle ─────────────────────────────────────── */

extern "C" int dsm_initialize(void)
{
    try {
        mediasoupclient::Initialize();
        return 0;
    } catch (...) {
        return -1;
    }
}

#if defined(__APPLE__)
extern "C" void dsm_stop_screen_capture(void);
extern "C" void dsm_stop_system_audio_capture(void);
#endif

extern "C" void dsm_shutdown(void)
{
#if defined(__APPLE__)
    dsm_stop_screen_capture();
    dsm_stop_system_audio_capture();
#endif
    try {
        mediasoupclient::Cleanup();
    } catch (...) {}
}

/* ── Capabilities ─────────────────────────────────── */

extern "C" char* dsm_get_capabilities(void)
{
    json caps;
    caps["nativeRtc"]          = false;
    caps["nativeBackendReady"] = false;
    caps["nativeScreenShare"]  = false;
    caps["nativeScreenAudio"]  = false;
    caps["nativeP2P"]          = false;
    caps["nativeSfu"]          = false;
    caps["nativeMicrophone"]   = false;
    caps["nativeCamera"]       = false;
    caps["nativeAudioReceive"] = false;
    caps["nativeVideoReceive"] = false;
    return json_to_cstr(caps);
}

/* ── Memory ───────────────────────────────────────── */

extern "C" void dsm_free_string(char* s)
{
    std::free(s);
}

/* ── Device ────────────────────────────────────────── */

struct dsm_device {
    std::unique_ptr<mediasoupclient::Device> device;
};

extern "C" dsm_device_t* dsm_create_device(
    const char* router_rtp_capabilities_json,
    int* error_out)
{
    if (error_out) *error_out = 0;
    try {
        auto d = std::make_unique<dsm_device>();
        d->device = std::make_unique<mediasoupclient::Device>();
        d->device->Load(json_arg(router_rtp_capabilities_json));
        return d.release();
    } catch (...) {
        if (error_out) *error_out = -1;
        return nullptr;
    }
}

extern "C" void dsm_destroy_device(dsm_device_t* device)
{
    delete device;
}

/* ── SendTransport ─────────────────────────────────── */

struct dsm_send_transport {
    mediasoupclient::SendTransport* transport;
    CxxSendListener*                listener;
};

extern "C" dsm_send_transport_t* dsm_create_send_transport(
    dsm_device_t* device,
    const char* id,
    const char* ice_parameters_json,
    const char* ice_candidates_json,
    const char* dtls_parameters_json,
    const char* app_data_json,
    int* error_out)
{
    if (error_out) *error_out = 0;
    try {
        auto st       = std::make_unique<dsm_send_transport>();
        auto listener = std::make_shared<CxxSendListener>();
        st->listener  = listener.get();
        g_send_listeners.push_back(std::move(listener));

        st->transport = device->device->CreateSendTransport(
            st->listener, id,
            json_arg(ice_parameters_json),
            json_arg(ice_candidates_json),
            json_arg(dtls_parameters_json));
        return st.release();
    } catch (...) {
        if (error_out) *error_out = -1;
        return nullptr;
    }
}

extern "C" void dsm_destroy_send_transport(dsm_send_transport_t* transport)
{
    if (!transport) return;
    transport->transport->Close();
    delete transport;
}

/* ── RecvTransport ─────────────────────────────────── */

struct dsm_recv_transport {
    mediasoupclient::RecvTransport* transport;
    CxxRecvListener*                listener;
};

extern "C" dsm_recv_transport_t* dsm_create_recv_transport(
    dsm_device_t* device,
    const char* id,
    const char* ice_parameters_json,
    const char* ice_candidates_json,
    const char* dtls_parameters_json,
    const char* app_data_json,
    int* error_out)
{
    if (error_out) *error_out = 0;
    try {
        auto rt       = std::make_unique<dsm_recv_transport>();
        auto listener = std::make_shared<CxxRecvListener>();
        rt->listener  = listener.get();
        g_recv_listeners.push_back(std::move(listener));

        rt->transport = device->device->CreateRecvTransport(
            rt->listener, id,
            json_arg(ice_parameters_json),
            json_arg(ice_candidates_json),
            json_arg(dtls_parameters_json));
        return rt.release();
    } catch (...) {
        if (error_out) *error_out = -1;
        return nullptr;
    }
}

extern "C" void dsm_destroy_recv_transport(dsm_recv_transport_t* transport)
{
    if (!transport) return;
    transport->transport->Close();
    delete transport;
}

/* ── Pending action polling ────────────────────────── */

extern "C" dsm_action_t dsm_poll_action(void)
{
    std::lock_guard<std::mutex> lock(g_action_mutex);
    if (g_actions.empty()) {
        return { DSM_ACTION_NONE, nullptr, 0, nullptr, nullptr };
    }
    auto cxx = std::move(g_actions.front());
    g_actions.pop();
    dsm_action_t out;
    out.kind          = cxx.kind;
    out.transport_ptr = cxx.transport_ptr;
    out.action_id     = cxx.action_id;
    out.params_json   = cxx.params_json;   // ownership transfer
    out.state         = cxx.state;
    return out;
}

/* ── Connect completion ───────────────────────────── */

extern "C" void dsm_complete_connect(void* transport_ptr)
{
    std::lock_guard<std::mutex> lock(g_promise_mutex);
    auto it = g_connect_promises.find(transport_ptr);
    if (it != g_connect_promises.end()) {
        it->second.set_value();
        g_connect_promises.erase(it);
    }
}

extern "C" void dsm_fail_connect(void* transport_ptr, const char* error_message)
{
    std::lock_guard<std::mutex> lock(g_promise_mutex);
    auto it = g_connect_promises.find(transport_ptr);
    if (it != g_connect_promises.end()) {
        it->second.set_exception(
            std::make_exception_ptr(std::runtime_error(
                error_message ? error_message : "connect failed")));
        g_connect_promises.erase(it);
    }
}

/* ── Complete / fail produce ──────────────────────── */

extern "C" void dsm_complete_produce(uint64_t action_id, const char* producer_id)
{
    std::lock_guard<std::mutex> lock(g_promise_mutex);
    auto it = g_produce_promises.find(action_id);
    if (it != g_produce_promises.end()) {
        it->second.set_value(producer_id ? producer_id : "");
        g_produce_promises.erase(it);
    }
}

extern "C" void dsm_fail_produce(uint64_t action_id, const char* error_message)
{
    std::lock_guard<std::mutex> lock(g_promise_mutex);
    auto it = g_produce_promises.find(action_id);
    if (it != g_produce_promises.end()) {
        it->second.set_exception(
            std::make_exception_ptr(std::runtime_error(
                error_message ? error_message : "produce failed")));
        g_produce_promises.erase(it);
    }
}

/* ── Produce / Consume ──────────────────────────────── */

extern "C" dsm_producer_t* dsm_produce(
    dsm_send_transport_t* transport,
    const char* kind,
    const char* app_data_json,
    int* error_out)
{
    if (error_out) *error_out = 0;
    try {
        auto* producer = transport->transport->Produce(
            /* producerListener = */ nullptr,
            /* track = */ nullptr,
            /* encodings = */ nullptr,
            /* codecOptions = */ nullptr,
            /* codec = */ nullptr,
            json_arg(app_data_json));
        return reinterpret_cast<dsm_producer_t*>(producer);
    } catch (...) {
        if (error_out) *error_out = -1;
        return nullptr;
    }
}

extern "C" dsm_consumer_t* dsm_consume(
    dsm_recv_transport_t* transport,
    const char* id,
    const char* producer_id,
    const char* kind,
    const char* rtp_parameters_json,
    const char* app_data_json,
    int* error_out)
{
    if (error_out) *error_out = 0;
    try {
        auto rtpParams = json_arg(rtp_parameters_json);
        auto* consumer = transport->transport->Consume(
            /* consumerListener = */ nullptr,
            id, producer_id, kind, &rtpParams,
            json_arg(app_data_json));
        return reinterpret_cast<dsm_consumer_t*>(consumer);
    } catch (...) {
        if (error_out) *error_out = -1;
        return nullptr;
    }
}

extern "C" void dsm_destroy_producer(dsm_producer_t* producer)
{
    if (!producer) return;
    reinterpret_cast<mediasoupclient::Producer*>(producer)->Close();
}

extern "C" void dsm_destroy_consumer(dsm_consumer_t* consumer)
{
    if (!consumer) return;
    reinterpret_cast<mediasoupclient::Consumer*>(consumer)->Close();
}

extern "C" const char* dsm_producer_get_id(dsm_producer_t* producer)
{
    auto* p = reinterpret_cast<mediasoupclient::Producer*>(producer);
    return strdup_c(p->GetId().c_str());
}

extern "C" const char* dsm_consumer_get_id(dsm_consumer_t* consumer)
{
    auto* c = reinterpret_cast<mediasoupclient::Consumer*>(consumer);
    return strdup_c(c->GetId().c_str());
}


/* ── P2P (PeerConnection) transport ─────────────────── */

struct dsm_p2p_handle {
    webrtc::scoped_refptr<webrtc::PeerConnectionFactoryInterface> factory;
    webrtc::scoped_refptr<webrtc::PeerConnectionInterface>        pc;
    webrtc::Thread*                                       signaling_thread = nullptr;
    webrtc::Thread*                                       worker_thread = nullptr;
    std::queue<std::string>                               ice_candidates;
    std::mutex                                            ice_mutex;
    bool                                                  connected = false;
    bool                                                  failed    = false;
    bool                                                  closed    = false;
};

namespace {

class P2pObserver : public webrtc::PeerConnectionObserver {
public:
    explicit P2pObserver(dsm_p2p_handle* h) : handle_(h) {}

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
    dsm_p2p_handle* handle_;
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

} // namespace

extern "C" dsm_p2p_handle_t* dsm_p2p_create(void)
{
    auto* h = new(std::nothrow) dsm_p2p_handle();
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

extern "C" void dsm_p2p_destroy(dsm_p2p_handle_t* h)
{
    if (!h) return;
    if (h->pc) { h->pc->Close(); h->pc = nullptr; }
    h->factory = nullptr;
    if (h->signaling_thread) { delete h->signaling_thread; }
    if (h->worker_thread) { delete h->worker_thread; }
    delete h;
}

extern "C" int dsm_p2p_create_offer(dsm_p2p_handle_t* h, char** sdp_out)
{
    if (!h || !h->pc || !sdp_out) return -1;

    auto* obs = new webrtc::RefCountedObject<P2pOfferObserver>();
    auto future = obs->GetFuture();
    h->pc->CreateOffer(obs, webrtc::PeerConnectionInterface::RTCOfferAnswerOptions());

    try {
        std::string sdp = future.get();
        *sdp_out = strdup_c(sdp.c_str());

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

extern "C" int dsm_p2p_create_answer(dsm_p2p_handle_t* h, const char* remote_sdp, char** sdp_out)
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
        *sdp_out = strdup_c(sdp.c_str());

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

extern "C" int dsm_p2p_set_remote_description(dsm_p2p_handle_t* h, const char* sdp)
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

extern "C" int dsm_p2p_add_ice_candidate(dsm_p2p_handle_t* h, const char* candidate)
{
    if (!h || !h->pc || !candidate) return -1;

    webrtc::SdpParseError error;
    auto* ice = webrtc::CreateIceCandidate("", 0, candidate, &error);
    if (!ice) return -1;
    h->pc->AddIceCandidate(ice);
    return 0;
}

extern "C" char* dsm_p2p_poll_ice_candidate(dsm_p2p_handle_t* h)
{
    if (!h) return nullptr;
    std::lock_guard<std::mutex> lock(h->ice_mutex);
    if (h->ice_candidates.empty()) return nullptr;
    auto s = h->ice_candidates.front();
    h->ice_candidates.pop();
    return strdup_c(s.c_str());
}

extern "C" int dsm_p2p_ice_connection_state(dsm_p2p_handle_t* h)
{
    if (!h || !h->pc) return -1;
    if (h->closed)  return 3;
    if (h->failed)  return 2;
    if (h->connected) return 1;
    return 0;
}

extern "C" int dsm_p2p_restart_ice(dsm_p2p_handle_t* h, char** sdp_out)
{
    if (!h || !h->pc || !sdp_out) return -1;

    webrtc::PeerConnectionInterface::RTCOfferAnswerOptions opts;
    opts.ice_restart = true;

    auto* obs = new webrtc::RefCountedObject<P2pOfferObserver>();
    auto future = obs->GetFuture();
    h->pc->CreateOffer(obs, opts);

    try {
        std::string sdp = future.get();
        *sdp_out = strdup_c(sdp.c_str());

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


/* ────────────────────────────────────────────────────────────────── */
/* Native Video Track Source: bridges ScreenCaptureKit → libwebrtc    */
/* ────────────────────────────────────────────────────────────────── */

#if defined(__APPLE__)
class NativeVideoSource : public webrtc::AdaptedVideoTrackSource {
public:
    explicit NativeVideoSource(const char* track_id)
        : AdaptedVideoTrackSource(0), track_id_(track_id) {}

    // VideoTrackSourceInterface implementation
    webrtc::MediaSourceInterface::SourceState state() const override {
        webrtc::MutexLock lock(&mutex_);
        return state_;
    }

    bool remote() const override { return false; }
    bool is_screencast() const override { return true; }
    std::optional<bool> needs_denoising() const override { return std::nullopt; }
    bool GetStats(Stats* stats) override { return false; }

    // Called from capture thread with CVPixelBuffer
    void OnCapturedFrame(CVPixelBufferRef pixel_buffer, int64_t timestamp_ms) {
        webrtc::VideoFrame frame = ConvertPixelBuffer(pixel_buffer, timestamp_ms);
        OnFrame(frame);
    }

    void SetState(webrtc::MediaSourceInterface::SourceState new_state) {
        webrtc::MutexLock lock(&mutex_);
        if (state_ == new_state) return;
        state_ = new_state;
        FireOnChanged();
    }

    const std::string& track_id() const { return track_id_; }

private:
    std::string track_id_;
    mutable webrtc::Mutex mutex_;
    webrtc::MediaSourceInterface::SourceState state_ RTC_GUARDED_BY(mutex_) =
        webrtc::MediaSourceInterface::kLive;

    webrtc::VideoFrame ConvertPixelBuffer(CVPixelBufferRef pb, int64_t timestamp_ms) {
        size_t width = CVPixelBufferGetWidth(pb);
        size_t height = CVPixelBufferGetHeight(pb);

        CVPixelBufferLockBaseAddress(pb, kCVPixelBufferLock_ReadOnly);
        void* base_addr = CVPixelBufferGetBaseAddress(pb);
        size_t bytes_per_row = CVPixelBufferGetBytesPerRow(pb);

        webrtc::scoped_refptr<webrtc::I420Buffer> i420_buffer =
            webrtc::I420Buffer::Create(width, height);

        if (base_addr) {
            libyuv::ARGBToI420(
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

    // AudioSourceInterface implementation
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

    // Called from CoreAudio callback thread with captured audio data
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

        // Deliver to all registered sinks
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
        webrtc::MutexLock lock(&mutex_);
        state_ = webrtc::MediaSourceInterface::kEnded;
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

#endif // __APPLE__

/* ────────────────────────────────────────────────────────────────── */
/* Opaque handle structs for the C API                                */
/* ────────────────────────────────────────────────────────────────── */

struct dsm_video_track {
#if defined(__APPLE__)
    webrtc::scoped_refptr<NativeVideoSource> source;
#endif
    webrtc::scoped_refptr<webrtc::VideoTrackInterface> track;
};

struct dsm_audio_track {
#if defined(__APPLE__)
    webrtc::scoped_refptr<NativeAudioSource> source;
#endif
    webrtc::scoped_refptr<webrtc::AudioTrackInterface> track;
};

/* ────────────────────────────────────────────────────────────────── */
/* C API: Create/Destroy tracks                                       */
/* ────────────────────────────────────────────────────────────────── */

extern "C" dsm_video_track_t* dsm_create_video_track(const char* track_id, int* error_out)
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
            /*audio_encoder_factory=*/nullptr,
            /*audio_decoder_factory=*/nullptr,
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

        auto* handle = new dsm_video_track();
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

extern "C" dsm_audio_track_t* dsm_create_audio_track(const char* track_id, int* error_out)
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
            /*audio_encoder_factory=*/nullptr,
            /*audio_decoder_factory=*/nullptr,
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

        webrtc::AudioOptions audio_options;
        webrtc::scoped_refptr<webrtc::AudioSourceInterface> audio_source =
            factory->CreateAudioSource(audio_options);
        if (!audio_source) {
            delete signaling_thread;
            delete worker_thread;
            if (error_out) *error_out = -3;
            return nullptr;
        }

        // CreateAudioTrack takes (label, AudioSourceInterface*)
        webrtc::scoped_refptr<webrtc::AudioTrackInterface> track =
            factory->CreateAudioTrack(track_id, audio_source.get());
        if (!track) {
            delete signaling_thread;
            delete worker_thread;
            if (error_out) *error_out = -4;
            return nullptr;
        }

        auto* handle = new dsm_audio_track();
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

extern "C" void dsm_destroy_video_track(dsm_video_track_t* t)
{
    if (!t) return;
#if defined(__APPLE__)
    if (t->source) {
        t->source->SetState(webrtc::MediaSourceInterface::kEnded);
    }
#endif
    t->track = nullptr;
    delete t;
}

extern "C" void dsm_destroy_audio_track(dsm_audio_track_t* t)
{
    if (!t) return;
#if defined(__APPLE__)
    if (t->source) {
        t->source->OnClose();
    }
#endif
    t->track = nullptr;
    delete t;
}

extern "C" const char* dsm_video_track_get_id(dsm_video_track_t* t)
{
    if (!t || !t->track) return nullptr;
    return strdup_c(t->track->id().c_str());
}

extern "C" const char* dsm_audio_track_get_id(dsm_audio_track_t* t)
{
    if (!t || !t->track) return nullptr;
    return strdup_c(t->track->id().c_str());
}

extern "C" dsm_producer_t* dsm_produce_video_track(
    dsm_send_transport_t* transport,
    dsm_video_track_t* track,
    const char* app_data_json,
    int* error_out)
{
    if (error_out) *error_out = 0;
    if (!transport || !transport->transport || !track || !track->track) {
        if (error_out) *error_out = -1;
        return nullptr;
    }
    try {
        auto* producer = transport->transport->Produce(
            nullptr, track->track.get(), nullptr, nullptr, nullptr,
            app_data_json ? nlohmann::json::parse(app_data_json) : nlohmann::json::object());
        return reinterpret_cast<dsm_producer_t*>(producer);
    } catch (...) {
        if (error_out) *error_out = -1;
        return nullptr;
    }
}

extern "C" dsm_producer_t* dsm_produce_audio_track(
    dsm_send_transport_t* transport,
    dsm_audio_track_t* track,
    const char* app_data_json,
    int* error_out)
{
    if (error_out) *error_out = 0;
    if (!transport || !transport->transport || !track || !track->track) {
        if (error_out) *error_out = -1;
        return nullptr;
    }
    try {
        auto* producer = transport->transport->Produce(
            nullptr, track->track.get(), nullptr, nullptr, nullptr,
            app_data_json ? nlohmann::json::parse(app_data_json) : nlohmann::json::object());
        return reinterpret_cast<dsm_producer_t*>(producer);
    } catch (...) {
        if (error_out) *error_out = -1;
        return nullptr;
    }
}

/* ────────────────────────────────────────────────────────────────── */
/* C API: P2P track attachment                                        */
/* ────────────────────────────────────────────────────────────────── */

extern "C" int dsm_p2p_add_video_track(dsm_p2p_handle_t* h, dsm_video_track_t* track)
{
    if (!h || !h->pc || !track || !track->track) return -1;

    auto result = h->pc->AddTrack(track->track, {"stream0"});
    return result.ok() ? 0 : -1;
}

extern "C" int dsm_p2p_add_audio_track(dsm_p2p_handle_t* h, dsm_audio_track_t* track)
{
    if (!h || !h->pc || !track || !track->track) return -1;

    auto result = h->pc->AddTrack(track->track, {"stream0"});
    return result.ok() ? 0 : -1;
}

extern "C" int dsm_p2p_remove_video_track(dsm_p2p_handle_t* h, dsm_video_track_t* track)
{
    if (!h || !h->pc || !track || !track->track) return -1;

    auto senders = h->pc->GetSenders();
    for (auto& sender : senders) {
        if (sender->track() && sender->track()->id() == track->track->id()) {
            auto error = h->pc->RemoveTrackOrError(sender);
            return error.ok() ? 0 : -1;
        }
    }
    return -1;
}

extern "C" int dsm_p2p_remove_audio_track(dsm_p2p_handle_t* h, dsm_audio_track_t* track)
{
    if (!h || !h->pc || !track || !track->track) return -1;

    auto senders = h->pc->GetSenders();
    for (auto& sender : senders) {
        if (sender->track() && sender->track()->id() == track->track->id()) {
            auto error = h->pc->RemoveTrackOrError(sender);
            return error.ok() ? 0 : -1;
        }
    }
    return -1;
}

/* ────────────────────────────────────────────────────────────────── */
/* Capture bridge: wire PlatformCapture → NativeVideoSource/AudioSource */
/* ────────────────────────────────────────────────────────────────── */

#if defined(__APPLE__)
static std::mutex g_track_mutex;
static dsm_video_track_t* g_video_track = nullptr;
static dsm_audio_track_t* g_audio_track = nullptr;

static void on_screen_frame(void* user_data, void* sample_buffer) {
    (void)user_data;
    if (!g_video_track || !g_video_track->source) return;

    CMSampleBufferRef sb = static_cast<CMSampleBufferRef>(sample_buffer);
    if (!sb) return;

    CVPixelBufferRef pb = CMSampleBufferGetImageBuffer(sb);
    if (!pb) return;

    CMTime pts = CMSampleBufferGetPresentationTimeStamp(sb);
    int64_t timestamp_ms = (pts.value * 1000) / pts.timescale;

    g_video_track->source->OnCapturedFrame(pb, timestamp_ms);
}

static void on_audio_frame(void* user_data, const float* data,
                           uint32_t frame_count, uint32_t sample_rate, uint8_t channels) {
    (void)user_data;
    if (!g_audio_track || !g_audio_track->source) return;

    int64_t timestamp_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count();

    g_audio_track->source->OnCapturedData(data, 32, sample_rate, channels, frame_count, timestamp_ms);
}

extern "C" int dsm_start_screen_capture(uint64_t display_id, int* error_out)
{
    if (error_out) *error_out = 0;
    std::lock_guard<std::mutex> lock(g_capture_mutex);
    if (g_screen_capture) {
        if (error_out) *error_out = -2;
        return -1;
    }

    // Create or get the video track
    std::lock_guard<std::mutex> track_lock(g_track_mutex);
    if (!g_video_track) {
        int err = 0;
        g_video_track = dsm_create_video_track("screen_capture", &err);
        if (!g_video_track) {
            if (error_out) *error_out = err;
            return -1;
        }
    }

    auto* capture = dsm_platform_screen_capture_create(display_id);
    if (!capture) {
        if (error_out) *error_out = -1;
        return -1;
    }

    const int result = dsm_platform_screen_capture_start(
        capture, on_screen_frame, nullptr);
    if (result != 0) {
        dsm_platform_screen_capture_destroy(capture);
        if (error_out) *error_out = result;
        return result;
    }
    g_screen_capture = capture;
    return 0;
}

extern "C" void dsm_stop_screen_capture(void)
{
    std::lock_guard<std::mutex> lock(g_capture_mutex);
    if (!g_screen_capture) return;
    dsm_platform_screen_capture_stop(g_screen_capture);
    dsm_platform_screen_capture_destroy(g_screen_capture);
    g_screen_capture = nullptr;

    std::lock_guard<std::mutex> track_lock(g_track_mutex);
    if (g_video_track) {
        dsm_destroy_video_track(g_video_track);
        g_video_track = nullptr;
    }
}

extern "C" int dsm_start_system_audio_capture(int* error_out)
{
    if (error_out) *error_out = 0;
    std::lock_guard<std::mutex> lock(g_capture_mutex);
    if (g_system_audio_capture) {
        if (error_out) *error_out = -2;
        return -1;
    }

    std::lock_guard<std::mutex> track_lock(g_track_mutex);
    if (!g_audio_track) {
        int err = 0;
        g_audio_track = dsm_create_audio_track("system_audio", &err);
        if (!g_audio_track) {
            if (error_out) *error_out = err;
            return -1;
        }
    }

    auto* capture = dsm_platform_audio_capture_create();
    if (!capture) {
        if (error_out) *error_out = -1;
        return -1;
    }

    const int result = dsm_platform_audio_capture_start(
        capture, on_audio_frame, nullptr);
    if (result != 0) {
        dsm_platform_audio_capture_destroy(capture);
        if (error_out) *error_out = result;
        return result;
    }
    g_system_audio_capture = capture;
    return 0;
}

extern "C" void dsm_stop_system_audio_capture(void)
{
    std::lock_guard<std::mutex> lock(g_capture_mutex);
    if (!g_system_audio_capture) return;
    dsm_platform_audio_capture_stop(g_system_audio_capture);
    dsm_platform_audio_capture_destroy(g_system_audio_capture);
    g_system_audio_capture = nullptr;

    std::lock_guard<std::mutex> track_lock(g_track_mutex);
    if (g_audio_track) {
        dsm_destroy_audio_track(g_audio_track);
        g_audio_track = nullptr;
    }
}

#endif /* __APPLE__ */
