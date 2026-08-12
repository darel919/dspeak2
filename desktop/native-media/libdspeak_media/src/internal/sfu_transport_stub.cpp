#include "lib_dspeak_media/lib_dspeak_media.h"

namespace {

constexpr int kMediasoupUnavailable = -700;

void set_error(int* error_out)
{
    if (error_out) *error_out = kMediasoupUnavailable;
}

}

extern "C" lib_dspeak_media_device_t* lib_dspeak_media_create_device(
    const char*, int* error_out)
{
    set_error(error_out);
    return nullptr;
}

extern "C" void lib_dspeak_media_destroy_device(lib_dspeak_media_device_t*) {}

extern "C" char* lib_dspeak_media_device_get_rtp_capabilities(
    lib_dspeak_media_device_t*)
{
    return nullptr;
}

extern "C" lib_dspeak_media_send_transport_t* lib_dspeak_media_create_send_transport(
    lib_dspeak_media_device_t*, const char*, const char*, const char*, const char*,
    const char*, int* error_out)
{
    set_error(error_out);
    return nullptr;
}

extern "C" void lib_dspeak_media_destroy_send_transport(
    lib_dspeak_media_send_transport_t*) {}

extern "C" lib_dspeak_media_recv_transport_t* lib_dspeak_media_create_recv_transport(
    lib_dspeak_media_device_t*, const char*, const char*, const char*, const char*,
    const char*, int* error_out)
{
    set_error(error_out);
    return nullptr;
}

extern "C" void lib_dspeak_media_destroy_recv_transport(
    lib_dspeak_media_recv_transport_t*) {}

extern "C" lib_dspeak_media_action_t lib_dspeak_media_poll_action(void)
{
    return {};
}

extern "C" void lib_dspeak_media_complete_connect(void*) {}

extern "C" void lib_dspeak_media_fail_connect(void*, const char*) {}

extern "C" void lib_dspeak_media_complete_produce(uint64_t, const char*) {}

extern "C" void lib_dspeak_media_fail_produce(uint64_t, const char*) {}

extern "C" lib_dspeak_media_producer_t* lib_dspeak_media_produce_video_track(
    lib_dspeak_media_send_transport_t*, lib_dspeak_media_video_track_t*, const char*,
    int* error_out)
{
    set_error(error_out);
    return nullptr;
}

extern "C" lib_dspeak_media_producer_t* lib_dspeak_media_produce_audio_track(
    lib_dspeak_media_send_transport_t*, lib_dspeak_media_audio_track_t*, const char*,
    int* error_out)
{
    set_error(error_out);
    return nullptr;
}

extern "C" lib_dspeak_media_consumer_t* lib_dspeak_media_consume(
    lib_dspeak_media_recv_transport_t*, const char*, const char*, const char*, const char*,
    const char*, int* error_out)
{
    set_error(error_out);
    return nullptr;
}

extern "C" void lib_dspeak_media_destroy_producer(lib_dspeak_media_producer_t*) {}

extern "C" int lib_dspeak_media_producer_set_paused(
    lib_dspeak_media_producer_t*, bool)
{
    return kMediasoupUnavailable;
}

extern "C" int lib_dspeak_media_producer_set_parameters(
    lib_dspeak_media_producer_t*, const char*)
{
    return kMediasoupUnavailable;
}

extern "C" void lib_dspeak_media_destroy_consumer(lib_dspeak_media_consumer_t*) {}

extern "C" int lib_dspeak_media_consumer_set_enabled(
    lib_dspeak_media_consumer_t*, bool)
{
    return kMediasoupUnavailable;
}

extern "C" int lib_dspeak_media_consumer_set_volume(
    lib_dspeak_media_consumer_t*, double)
{
    return kMediasoupUnavailable;
}

extern "C" const char* lib_dspeak_media_producer_get_id(
    lib_dspeak_media_producer_t*)
{
    return nullptr;
}

extern "C" const char* lib_dspeak_media_consumer_get_id(
    lib_dspeak_media_consumer_t*)
{
    return nullptr;
}

extern "C" const char* lib_dspeak_media_consumer_get_producer_id(
    lib_dspeak_media_consumer_t*)
{
    return nullptr;
}

extern "C" const char* lib_dspeak_media_consumer_get_kind(
    lib_dspeak_media_consumer_t*)
{
    return nullptr;
}

extern "C" int lib_dspeak_media_send_transport_restart_ice(
    lib_dspeak_media_send_transport_t*, const char*)
{
    return kMediasoupUnavailable;
}

extern "C" int lib_dspeak_media_recv_transport_restart_ice(
    lib_dspeak_media_recv_transport_t*, const char*)
{
    return kMediasoupUnavailable;
}

extern "C" char* lib_dspeak_media_send_transport_get_stats(
    lib_dspeak_media_send_transport_t*)
{
    return nullptr;
}

extern "C" char* lib_dspeak_media_recv_transport_get_stats(
    lib_dspeak_media_recv_transport_t*)
{
    return nullptr;
}

extern "C" char* lib_dspeak_media_producer_get_stats(
    lib_dspeak_media_producer_t*)
{
    return nullptr;
}

extern "C" char* lib_dspeak_media_consumer_get_stats(
    lib_dspeak_media_consumer_t*)
{
    return nullptr;
}

extern "C" int lib_dspeak_media_producer_replace_video_track(
    lib_dspeak_media_producer_t*, lib_dspeak_media_video_track_t*, int* error_out)
{
    set_error(error_out);
    return kMediasoupUnavailable;
}

extern "C" int lib_dspeak_media_producer_replace_audio_track(
    lib_dspeak_media_producer_t*, lib_dspeak_media_audio_track_t*, int* error_out)
{
    set_error(error_out);
    return kMediasoupUnavailable;
}

extern "C" int lib_dspeak_media_consumer_set_jitter_buffer(
    lib_dspeak_media_consumer_t*, int, int)
{
    return kMediasoupUnavailable;
}
