#include "lib_dspeak_media/lib_dspeak_media.h"
#include <json.hpp>
#include "media_handles.hpp"
#include "runtime_health.hpp"
#include "event_bridge.hpp"
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

/* ── Action queue ─────────────────────────────────── */


uint64_t lib_dspeak_media_next_action_id()
{
    static std::atomic<uint64_t> counter{1};
    return counter.fetch_add(1);
}

static std::mutex               g_action_mutex;
static std::queue<CxxAction>    g_actions;


void lib_dspeak_media_push_action(lib_dspeak_media_action_kind_t kind,
                        void* tport, uint64_t aid,
                    const lib_dspeak_media_json* params, const lib_dspeak_media_json* st)
{
    CxxAction act;
    act.kind         = kind;
    act.transport_ptr = tport;
    act.action_id    = aid;
    act.params_json  = params ? lib_dspeak_media_json_to_cstr(*params) : nullptr;
    act.state        = st     ? lib_dspeak_media_json_to_cstr(*st)     : nullptr;
    std::lock_guard<std::mutex> lock(g_action_mutex);
    g_actions.push(std::move(act));
    lib_dspeak_media_signal_event();
}

/* ── Forward declarations for promise globals ───────── */

/* ── Listener: SendTransport ───────────────────────── */



static std::mutex g_promise_mutex;
static std::map<void*, std::promise<void>> g_connect_promises;
static std::map<uint64_t, std::promise<std::string>> g_produce_promises;

class CxxSendListener : public mediasoupclient::SendTransport::Listener {
public:
    explicit CxxSendListener(std::string direction)
        : direction_(std::move(direction)) {}

    std::future<void> OnConnect(mediasoupclient::Transport* transport,
                                const json& dtlsParameters) override
    {
        auto p = std::promise<void>();
        auto f = p.get_future();
        {
            std::lock_guard<std::mutex> lock(g_promise_mutex);
            g_connect_promises[static_cast<void*>(transport)] = std::move(p);
        }
        json params = dtlsParameters;
        params["direction"] = direction_;
        lib_dspeak_media_push_action(LIB_DSPEAK_MEDIA_ACTION_TRANSPORT_CONNECT,
                static_cast<void*>(transport), lib_dspeak_media_next_action_id(),
                &params, nullptr);
        return f;
    }

    void OnConnectionStateChange(mediasoupclient::Transport* transport,
                                 const std::string& connectionState) override
    {
        const bool next_connected = connectionState == "connected";
        dspeak_media_runtime::update_sfu_connection(
            connected_, next_connected);
        connected_ = next_connected;
        json j(connectionState);
        lib_dspeak_media_push_action(LIB_DSPEAK_MEDIA_ACTION_NONE,
                static_cast<void*>(transport), 0,
                nullptr, &j);
    }

    void ResetHealth()
    {
        dspeak_media_runtime::update_sfu_connection(connected_, false);
    }

    std::future<std::string> OnProduce(
        mediasoupclient::SendTransport* transport,
        const std::string& kind,
        json rtpParameters,
        const json& appData) override
    {
        auto p = std::promise<std::string>();
        auto f = p.get_future();
        uint64_t aid = lib_dspeak_media_next_action_id();
        {
            std::lock_guard<std::mutex> lock(g_promise_mutex);
            g_produce_promises[aid] = std::move(p);
        }
        json params;
        params["kind"]           = kind;
        params["rtpParameters"]  = rtpParameters;
        params["appData"]        = appData;
        lib_dspeak_media_push_action(LIB_DSPEAK_MEDIA_ACTION_PRODUCER_CREATED,
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
        uint64_t aid = lib_dspeak_media_next_action_id();
        {
            std::lock_guard<std::mutex> lock(g_promise_mutex);
            g_produce_promises[aid] = std::move(p);
        }
        json params;
        params["sctpStreamParameters"] = sctpStreamParameters;
        params["label"]               = label;
        params["protocol"]            = protocol;
        params["appData"]             = appData;
        lib_dspeak_media_push_action(LIB_DSPEAK_MEDIA_ACTION_CONSUMER_CREATED,
                static_cast<void*>(transport), aid,
                &params, nullptr);
        return f;
    }

private:
    std::string direction_;
    bool connected_ = false;
};

/* ── Listener: RecvTransport ───────────────────────── */

class CxxRecvListener : public mediasoupclient::RecvTransport::Listener {
public:
    explicit CxxRecvListener(std::string direction)
        : direction_(std::move(direction)) {}

    std::future<void> OnConnect(mediasoupclient::Transport* transport,
                                const json& dtlsParameters) override
    {
        auto p = std::promise<void>();
        auto f = p.get_future();
        {
            std::lock_guard<std::mutex> lock(g_promise_mutex);
            g_connect_promises[static_cast<void*>(transport)] = std::move(p);
        }
        json params = dtlsParameters;
        params["direction"] = direction_;
        lib_dspeak_media_push_action(LIB_DSPEAK_MEDIA_ACTION_TRANSPORT_CONNECT,
                static_cast<void*>(transport), lib_dspeak_media_next_action_id(),
                &params, nullptr);
        return f;
    }

    void OnConnectionStateChange(mediasoupclient::Transport* transport,
                                 const std::string& connectionState) override
    {
        const bool next_connected = connectionState == "connected";
        dspeak_media_runtime::update_sfu_connection(
            connected_, next_connected);
        connected_ = next_connected;
        json j(connectionState);
        lib_dspeak_media_push_action(LIB_DSPEAK_MEDIA_ACTION_NONE,
                static_cast<void*>(transport), 0,
                nullptr, &j);
    }

    void ResetHealth()
    {
        dspeak_media_runtime::update_sfu_connection(connected_, false);
    }

private:
    std::string direction_;
    bool connected_ = false;
};

class CxxConsumerListener : public mediasoupclient::Consumer::Listener {
public:
    void OnTransportClose(mediasoupclient::Consumer* consumer) override
    {
        if (!consumer) return;
        lib_dspeak_media_push_receive_track_closed_event(
            consumer->GetId().c_str(),
            consumer->GetProducerId().c_str(),
            consumer->GetKind().c_str());
    }
};

/* ── Global state ─────────────────────────────────── */

std::vector<std::shared_ptr<CxxSendListener>> g_send_listeners;
std::vector<std::shared_ptr<CxxRecvListener>> g_recv_listeners;
std::mutex g_listener_mutex;

static void clear_connect_promise(mediasoupclient::Transport* transport)
{
    std::lock_guard<std::mutex> lock(g_promise_mutex);
    g_connect_promises.erase(static_cast<void*>(transport));
}

/* ── Lifecycle ─────────────────────────────────────── */


/* ── Device ────────────────────────────────────────── */


extern "C" lib_dspeak_media_device_t* lib_dspeak_media_create_device(
    const char* router_rtp_capabilities_json,
    int* error_out)
{
    if (error_out) *error_out = 0;
    try {
        auto d = std::make_unique<lib_dspeak_media_device>();
        d->network_thread = webrtc::Thread::CreateWithSocketServer().release();
        d->network_thread->SetName("dspeak_network", nullptr);
        d->signaling_thread = webrtc::Thread::Create().release();
        d->signaling_thread->SetName("dspeak_signaling", nullptr);
        d->worker_thread = webrtc::Thread::Create().release();
        d->worker_thread->SetName("dspeak_worker", nullptr);
        dspeak_native::start_media_thread(d->network_thread);
        dspeak_native::start_media_thread(d->signaling_thread);
        dspeak_native::start_media_thread(d->worker_thread);
        auto null_adm = webrtc::CreateAudioDeviceModule(
            webrtc::CreateEnvironment(),
            webrtc::AudioDeviceModule::kDummyAudio);
        if (!null_adm) {
            delete d->network_thread;
            delete d->signaling_thread;
            delete d->worker_thread;
            if (error_out) *error_out = -2;
            return nullptr;
        }
        d->factory = webrtc::CreatePeerConnectionFactory(
            d->network_thread,
            d->worker_thread,
            d->signaling_thread,
            null_adm,
            webrtc::CreateBuiltinAudioEncoderFactory(),
            webrtc::CreateBuiltinAudioDecoderFactory(),
            dspeak_native::create_video_encoder_factory(),
            dspeak_native::create_video_decoder_factory(),
            /*audio_mixer=*/nullptr,
            /*audio_processing=*/nullptr);
        if (!d->factory) {
            d->factory = nullptr;
            delete d->network_thread;
            delete d->signaling_thread;
            delete d->worker_thread;
            if (error_out) *error_out = -3;
            return nullptr;
        }
        mediasoupclient::PeerConnection::Options options;
        options.factory = d->factory.get();
        d->device = std::make_unique<mediasoupclient::Device>();
        d->device->Load(
            lib_dspeak_media_json_arg(router_rtp_capabilities_json), &options, false);
        return d.release();
    } catch (const std::exception& ex) {
        fprintf(stderr, "[dspeak:media] create-device exception: %s\n", ex.what());
        if (error_out) *error_out = -4;
        return nullptr;
    } catch (...) {
        if (error_out) *error_out = -1;
        return nullptr;
    }
}

extern "C" void lib_dspeak_media_destroy_device(lib_dspeak_media_device_t* device)
{
    if (!device) return;
    device->device.reset();
    device->factory = nullptr;
    delete device->network_thread;
    delete device->signaling_thread;
    delete device->worker_thread;
    delete device;
}

extern "C" char* lib_dspeak_media_device_get_rtp_capabilities(lib_dspeak_media_device_t* device)
{
    if (!device || !device->device) return nullptr;
    try {
        return lib_dspeak_media_json_to_cstr(device->device->GetRtpCapabilities());
    } catch (...) {
        return nullptr;
    }
}

/* ── SendTransport ─────────────────────────────────── */


extern "C" lib_dspeak_media_send_transport_t* lib_dspeak_media_create_send_transport(
    lib_dspeak_media_device_t* device,
    const char* id,
    const char* ice_parameters_json,
    const char* ice_candidates_json,
    const char* dtls_parameters_json,
    const char* app_data_json,
    int* error_out)
{
    if (error_out) *error_out = 0;
    try {
        auto st       = std::make_unique<lib_dspeak_media_send_transport>();
        auto listener = std::make_shared<CxxSendListener>("send");
        st->listener  = listener.get();
        g_send_listeners.push_back(std::move(listener));

        mediasoupclient::PeerConnection::Options options;
        options.factory = device->factory.get();
        st->transport = device->device->CreateSendTransport(
            st->listener, id,
            lib_dspeak_media_json_arg(ice_parameters_json),
            lib_dspeak_media_json_arg(ice_candidates_json),
            lib_dspeak_media_json_arg(dtls_parameters_json),
            &options);
        return st.release();
    } catch (...) {
        if (error_out) *error_out = -1;
        return nullptr;
    }
}

extern "C" void lib_dspeak_media_destroy_send_transport(lib_dspeak_media_send_transport_t* transport)
{
    if (!transport) return;
    auto* listener = transport->listener;
    listener->ResetHealth();
    clear_connect_promise(transport->transport);
    transport->transport->Close();
    {
        std::lock_guard<std::mutex> lock(g_listener_mutex);
        g_send_listeners.erase(
            std::remove_if(g_send_listeners.begin(), g_send_listeners.end(),
                           [listener](const auto& candidate) { return candidate.get() == listener; }),
            g_send_listeners.end());
    }
    delete transport;
}

/* ── RecvTransport ─────────────────────────────────── */


extern "C" lib_dspeak_media_recv_transport_t* lib_dspeak_media_create_recv_transport(
    lib_dspeak_media_device_t* device,
    const char* id,
    const char* ice_parameters_json,
    const char* ice_candidates_json,
    const char* dtls_parameters_json,
    const char* app_data_json,
    int* error_out)
{
    if (error_out) *error_out = 0;
    try {
        auto rt       = std::make_unique<lib_dspeak_media_recv_transport>();
        auto listener = std::make_shared<CxxRecvListener>("recv");
        rt->listener  = listener.get();
        g_recv_listeners.push_back(std::move(listener));

        mediasoupclient::PeerConnection::Options options;
        options.factory = device->factory.get();
        rt->transport = device->device->CreateRecvTransport(
            rt->listener, id,
            lib_dspeak_media_json_arg(ice_parameters_json),
            lib_dspeak_media_json_arg(ice_candidates_json),
            lib_dspeak_media_json_arg(dtls_parameters_json),
            &options);
        return rt.release();
    } catch (...) {
        if (error_out) *error_out = -1;
        return nullptr;
    }
}

extern "C" void lib_dspeak_media_destroy_recv_transport(lib_dspeak_media_recv_transport_t* transport)
{
    if (!transport) return;
    auto* listener = transport->listener;
    listener->ResetHealth();
    clear_connect_promise(transport->transport);
    transport->transport->Close();
    {
        std::lock_guard<std::mutex> lock(g_listener_mutex);
        g_recv_listeners.erase(
            std::remove_if(g_recv_listeners.begin(), g_recv_listeners.end(),
                           [listener](const auto& candidate) { return candidate.get() == listener; }),
            g_recv_listeners.end());
    }
    delete transport;
}

/* ── Pending action queue drain ─────────────────────── */

extern "C" lib_dspeak_media_action_t lib_dspeak_media_drain_action(void)
{
    std::lock_guard<std::mutex> lock(g_action_mutex);
    if (g_actions.empty()) {
        return { LIB_DSPEAK_MEDIA_ACTION_NONE, nullptr, 0, nullptr, nullptr };
    }
    auto cxx = std::move(g_actions.front());
    g_actions.pop();
    lib_dspeak_media_action_t out;
    out.kind          = cxx.kind;
    out.transport_ptr = cxx.transport_ptr;
    out.action_id     = cxx.action_id;
    out.params_json   = cxx.params_json;
    out.state         = cxx.state;
    return out;
}

/* ── Connect completion ───────────────────────────── */

extern "C" void lib_dspeak_media_complete_connect(void* transport_ptr)
{
    std::lock_guard<std::mutex> lock(g_promise_mutex);
    auto it = g_connect_promises.find(transport_ptr);
    if (it != g_connect_promises.end()) {
        it->second.set_value();
        g_connect_promises.erase(it);
    }
}

extern "C" void lib_dspeak_media_fail_connect(void* transport_ptr, const char* error_message)
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

extern "C" void lib_dspeak_media_complete_produce(uint64_t action_id, const char* producer_id)
{
    std::lock_guard<std::mutex> lock(g_promise_mutex);
    auto it = g_produce_promises.find(action_id);
    if (it != g_produce_promises.end()) {
        it->second.set_value(producer_id ? producer_id : "");
        g_produce_promises.erase(it);
    }
}

extern "C" void lib_dspeak_media_fail_produce(uint64_t action_id, const char* error_message)
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

extern "C" lib_dspeak_media_consumer_t* lib_dspeak_media_consume(
    lib_dspeak_media_recv_transport_t* transport,
    const char* id,
    const char* producer_id,
    const char* kind,
    const char* rtp_parameters_json,
    const char* app_data_json,
    int* error_out)
{
    if (error_out) *error_out = 0;
    if (!transport || !transport->transport || !id || !producer_id || !kind ||
        !rtp_parameters_json) {
        if (error_out) *error_out = -1;
        return nullptr;
    }
    try {
        auto result = std::make_unique<lib_dspeak_media_consumer>();
        result->listener = new CxxConsumerListener();
        auto rtpParams = lib_dspeak_media_json_arg(rtp_parameters_json);
        auto app_data = lib_dspeak_media_json_arg(app_data_json);
        result->consumer = transport->transport->Consume(
            result->listener,
            id, producer_id, kind, &rtpParams,
            app_data);
        if (!result->consumer) {
            delete result->listener;
            if (error_out) *error_out = -2;
            return nullptr;
        }
        auto* track = result->consumer->GetTrack();
        if (std::strcmp(kind, "audio") == 0 && track) {
            result->audio_sink = std::make_unique<NativeReceiveAudioSink>(id);
            static_cast<webrtc::AudioTrackInterface*>(track)->AddSink(result->audio_sink.get());
            result->audio_sink->SetEnabled(true);
        } else if (std::strcmp(kind, "video") == 0 && track) {
            result->video_sink = std::make_unique<NativeReceiveVideoSink>(id);
            static_cast<webrtc::VideoTrackInterface*>(track)->AddOrUpdateSink(
                result->video_sink.get(), webrtc::VideoSinkWants());
            result->video_sink->SetEnabled(true);
        } else {
            result->consumer->Close();
            delete result->listener;
            if (error_out) *error_out = -3;
            return nullptr;
        }
        const auto app_data_text = app_data.dump();
        std::fprintf(stderr, "[dspeak:media] native consumer created id=%s kind=%s producer=%s\n",
                     id, kind, producer_id);
        lib_dspeak_media_push_receive_track_event(
            "consumer-created", id, producer_id, kind, app_data_text.c_str());
        return result.release();
    } catch (...) {
        if (error_out) *error_out = -1;
        return nullptr;
    }
}

extern "C" void lib_dspeak_media_destroy_producer(lib_dspeak_media_producer_t* producer)
{
    try {
        if (!producer) return;
        reinterpret_cast<mediasoupclient::Producer*>(producer)->Close();
    } catch (...) {
        // ignore exceptions in destructor
    }
}

extern "C" int lib_dspeak_media_producer_set_paused(
    lib_dspeak_media_producer_t* producer, bool paused)
{
    try {
        if (!producer) return -1;
        auto* value = reinterpret_cast<mediasoupclient::Producer*>(producer);
        if (paused && !value->IsPaused()) value->Pause();
        if (!paused && value->IsPaused()) value->Resume();
        return 0;
    } catch (...) {
        return -1;
    }
}

extern "C" int lib_dspeak_media_producer_set_parameters(
    lib_dspeak_media_producer_t* producer, const char* parameters_json)
{
    try {
        if (!producer || !parameters_json) return -1;
        auto* value = reinterpret_cast<mediasoupclient::Producer*>(producer);
        const auto parameters = lib_dspeak_media_json_arg(parameters_json);
        if (!parameters.is_object()) return -1;
        auto* sender = value->GetRtpSender();
        if (!sender) return -1;
        auto current = sender->GetParameters();
        for (auto& encoding : current.encodings) {
            if (parameters.contains("active") && parameters["active"].is_boolean())
                encoding.active = parameters["active"].get<bool>();
            if (parameters.contains("maxBitrate") && parameters["maxBitrate"].is_number_integer())
                encoding.max_bitrate_bps = parameters["maxBitrate"].get<int>();
            if (parameters.contains("maxFramerate") && parameters["maxFramerate"].is_number())
                encoding.max_framerate = parameters["maxFramerate"].get<double>();
            if (parameters.contains("scaleResolutionDownBy") && parameters["scaleResolutionDownBy"].is_number())
                encoding.scale_resolution_down_by = parameters["scaleResolutionDownBy"].get<double>();
            if (parameters.contains("priority") && parameters["priority"].is_string())
                encoding.bitrate_priority = native_priority_value(parameters["priority"]);
            if (parameters.contains("networkPriority") && parameters["networkPriority"].is_string())
                encoding.network_priority = native_priority(parameters["networkPriority"], webrtc::Priority::kLow);
        }
        return sender->SetParameters(current).ok() ? 0 : -1;
    } catch (...) {
        return -1;
    }
}

extern "C" void lib_dspeak_media_destroy_consumer(lib_dspeak_media_consumer_t* consumer)
{
    try {
        if (!consumer) return;
        if (consumer->consumer) {
            auto track = consumer->consumer->GetTrack();
            if (track && consumer->audio_sink && track->kind() == "audio") {
                static_cast<webrtc::AudioTrackInterface*>(track)
                    ->RemoveSink(consumer->audio_sink.get());
            }
            if (track && consumer->video_sink && track->kind() == "video") {
                static_cast<webrtc::VideoTrackInterface*>(track)
                    ->RemoveSink(consumer->video_sink.get());
            }
            lib_dspeak_media_push_receive_track_closed_event(
                consumer->consumer->GetId().c_str(),
                consumer->consumer->GetProducerId().c_str(),
                consumer->consumer->GetKind().c_str());
            consumer->consumer->Close();
        }
        consumer->audio_sink.reset();
        consumer->video_sink.reset();
        delete consumer->listener;
        delete consumer;
    } catch (...) {
        // ignore exceptions in destructor
    }
}

extern "C" int lib_dspeak_media_consumer_set_enabled(
    lib_dspeak_media_consumer_t* consumer, bool enabled)
{
    try {
        if (!consumer || !consumer->consumer) return -1;
        if (consumer->audio_sink) consumer->audio_sink->SetEnabled(enabled);
        if (consumer->video_sink) consumer->video_sink->SetEnabled(enabled);
        return 0;
    } catch (...) {
        return -1;
    }
}

extern "C" int lib_dspeak_media_consumer_set_volume(
    lib_dspeak_media_consumer_t* consumer, double volume)
{
    try {
        if (!consumer || !consumer->consumer || !consumer->audio_sink) return -1;
        consumer->audio_sink->SetVolume(volume);
        return 0;
    } catch (...) {
        return -1;
    }
}

extern "C" const char* lib_dspeak_media_producer_get_id(lib_dspeak_media_producer_t* producer)
{
    try {
        auto* p = reinterpret_cast<mediasoupclient::Producer*>(producer);
        return lib_dspeak_media_strdup(p->GetId().c_str());
    } catch (...) {
        return nullptr;
    }
}

extern "C" const char* lib_dspeak_media_consumer_get_id(lib_dspeak_media_consumer_t* consumer)
{
    try {
        if (!consumer || !consumer->consumer) return nullptr;
        return lib_dspeak_media_strdup(consumer->consumer->GetId().c_str());
    } catch (...) {
        return nullptr;
    }
}

extern "C" const char* lib_dspeak_media_consumer_get_producer_id(
    lib_dspeak_media_consumer_t* consumer)
{
    try {
        if (!consumer || !consumer->consumer) return nullptr;
        return lib_dspeak_media_strdup(consumer->consumer->GetProducerId().c_str());
    } catch (...) {
        return nullptr;
    }
}

extern "C" const char* lib_dspeak_media_consumer_get_kind(
    lib_dspeak_media_consumer_t* consumer)
{
    try {
        if (!consumer || !consumer->consumer) return nullptr;
        return lib_dspeak_media_strdup(consumer->consumer->GetKind().c_str());
    } catch (...) {
        return nullptr;
    }
}

/* ══════════════════════════════════════════════════════
   New: Transport ICE restart (SFU)
   ══════════════════════════════════════════════════════ */

extern "C" int lib_dspeak_media_send_transport_restart_ice(
    lib_dspeak_media_send_transport_t* t, const char* ice_parameters_json)
{
    try {
        if (!t || !t->transport || !ice_parameters_json) return -1;
        t->transport->RestartIce(lib_dspeak_media_json_arg(ice_parameters_json));
        return 0;
    } catch (...) {
        return -1;
    }
}

extern "C" int lib_dspeak_media_recv_transport_restart_ice(
    lib_dspeak_media_recv_transport_t* t, const char* ice_parameters_json)
{
    try {
        if (!t || !t->transport || !ice_parameters_json) return -1;
        t->transport->RestartIce(lib_dspeak_media_json_arg(ice_parameters_json));
        return 0;
    } catch (...) {
        return -1;
    }
}

/* ══════════════════════════════════════════════════════
   New: Stats collection
   ══════════════════════════════════════════════════════ */

extern "C" char* lib_dspeak_media_send_transport_get_stats(
    lib_dspeak_media_send_transport_t* t)
{
    try {
        if (!t || !t->transport) return nullptr;
        auto stats = t->transport->GetStats();
        return lib_dspeak_media_json_to_cstr(stats);
    } catch (...) {
        return nullptr;
    }
}

extern "C" char* lib_dspeak_media_recv_transport_get_stats(
    lib_dspeak_media_recv_transport_t* t)
{
    try {
        if (!t || !t->transport) return nullptr;
        auto stats = t->transport->GetStats();
        return lib_dspeak_media_json_to_cstr(stats);
    } catch (...) {
        return nullptr;
    }
}

extern "C" char* lib_dspeak_media_producer_get_stats(
    lib_dspeak_media_producer_t* p)
{
    try {
        if (!p) return nullptr;
        auto* producer = reinterpret_cast<mediasoupclient::Producer*>(p);
        auto stats = producer->GetStats();
        return lib_dspeak_media_json_to_cstr(stats);
    } catch (...) {
        return nullptr;
    }
}

extern "C" char* lib_dspeak_media_consumer_get_stats(
    lib_dspeak_media_consumer_t* c)
{
    try {
        if (!c || !c->consumer) return nullptr;
        auto stats = c->consumer->GetStats();
        return lib_dspeak_media_json_to_cstr(stats);
    } catch (...) {
        return nullptr;
    }
}

/* ══════════════════════════════════════════════════════
   New: Producer replaceTrack
   ══════════════════════════════════════════════════════ */

extern "C" int lib_dspeak_media_producer_replace_video_track(
    lib_dspeak_media_producer_t* p,
    lib_dspeak_media_video_track_t* track,
    int* error_out)
{
    if (error_out) *error_out = 0;
    try {
        if (!p || !track || !track->track) {
            if (error_out) *error_out = -1;
            return -1;
        }
        auto* producer = reinterpret_cast<mediasoupclient::Producer*>(p);
        producer->ReplaceTrack(track->track.get());
        return 0;
    } catch (...) {
        if (error_out) *error_out = -1;
        return -1;
    }
}

extern "C" int lib_dspeak_media_producer_replace_audio_track(
    lib_dspeak_media_producer_t* p,
    lib_dspeak_media_audio_track_t* track,
    int* error_out)
{
    if (error_out) *error_out = 0;
    try {
        if (!p || !track || !track->track) {
            if (error_out) *error_out = -1;
            return -1;
        }
        auto* producer = reinterpret_cast<mediasoupclient::Producer*>(p);
        producer->ReplaceTrack(track->track.get());
        return 0;
    } catch (...) {
        if (error_out) *error_out = -1;
        return -1;
    }
}

/* ══════════════════════════════════════════════════════
   New: Jitter buffer configuration
   ══════════════════════════════════════════════════════ */

extern "C" int lib_dspeak_media_consumer_set_jitter_buffer(
    lib_dspeak_media_consumer_t* c,
    int min_delay_ms,
    int target_delay_ms)
{
    try {
        if (!c || !c->consumer) return -1;
        auto* receiver = c->consumer->GetRtpReceiver();
        if (!receiver) return -1;
        const auto minimum_delay_ms = std::max(0, min_delay_ms);
        const auto target_delay = std::max(0, target_delay_ms);
        receiver->SetJitterBufferMinimumDelay(
            static_cast<double>(minimum_delay_ms) / 1000.0);
        if (c->audio_sink)
            c->audio_sink->SetJitterBuffer(minimum_delay_ms, target_delay);
        return 0;
    } catch (...) {
        return -1;
    }
}
