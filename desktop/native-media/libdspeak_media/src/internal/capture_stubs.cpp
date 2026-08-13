#include "lib_dspeak_media/lib_dspeak_media.h"

#include <cstdlib>
#include <cstring>

#if !defined(__APPLE__) && !defined(_WIN32)

static char* empty_sources() {
    const char value[] = "[]";
    char* result = static_cast<char*>(std::malloc(sizeof(value)));
    if (result) std::memcpy(result, value, sizeof(value));
    return result;
}

extern "C" char* lib_dspeak_media_list_capture_sources(void) {
    return empty_sources();
}

extern "C" char* lib_dspeak_media_list_capture_devices(void) {
    return empty_sources();
}

extern "C" int lib_dspeak_media_set_microphone_device(const char* device_id, int* error_out) {
    (void)device_id;
    if (error_out) *error_out = -100;
    return -1;
}

extern "C" int lib_dspeak_media_set_camera_device(const char* device_id, int* error_out) {
    (void)device_id;
    if (error_out) *error_out = -100;
    return -1;
}

extern "C" int lib_dspeak_media_set_shared_audio_volume(double volume) {
    (void)volume;
    return -1;
}

extern "C" int lib_dspeak_media_set_shared_audio_attenuation(
    int enabled,
    double reduction_percent,
    int attack_ms,
    int release_ms) {
    (void)enabled;
    (void)reduction_percent;
    (void)attack_ms;
    (void)release_ms;
    return -1;
}

extern "C" char* lib_dspeak_media_get_audio_levels(void) {
    const char value[] =
        "{\"microphoneDbfs\":-60,\"sharedAudioDbfs\":-60,\"sharedAudioLevel\":0,\"microphoneReady\":false,\"sharedAudioReady\":false}";
    char* result = static_cast<char*>(std::malloc(sizeof(value)));
    if (result) std::memcpy(result, value, sizeof(value));
    return result;
}

extern "C" int lib_dspeak_media_start_microphone_check(void) {
    return -100;
}

extern "C" uint8_t* lib_dspeak_media_stop_microphone_check(size_t* length_out) {
    if (length_out) *length_out = 0;
    return nullptr;
}

extern "C" void lib_dspeak_media_free_buffer(uint8_t* buffer) {
    std::free(buffer);
}

extern "C" int lib_dspeak_media_start_microphone_capture(int* error_out) {
    if (error_out) *error_out = -100;
    return -1;
}

extern "C" int lib_dspeak_media_stop_microphone_capture(int* error_out) {
    if (error_out) *error_out = 0;
    return 0;
}

extern "C" int lib_dspeak_media_start_camera_capture(int* error_out) {
    if (error_out) *error_out = -100;
    return -1;
}

extern "C" int lib_dspeak_media_stop_camera_capture(int* error_out) {
    if (error_out) *error_out = 0;
    return 0;
}

extern "C" int lib_dspeak_media_start_capture(const char* request_json, int* error_out) {
    (void)request_json;
    if (error_out) *error_out = -100;
    return -1;
}

extern "C" int lib_dspeak_media_stop_capture(int* error_out) {
    if (error_out) *error_out = 0;
    return 0;
}

extern "C" int lib_dspeak_media_probe_capture(int timeout_ms, int* error_out) {
    (void)timeout_ms;
    if (error_out) *error_out = -100;
    return -1;
}

extern "C" lib_dspeak_media_video_track_t* lib_dspeak_media_get_video_track(const char* source) {
    (void)source;
    return nullptr;
}

extern "C" lib_dspeak_media_audio_track_t* lib_dspeak_media_get_audio_track(const char* source) {
    (void)source;
    return nullptr;
}

extern "C" int lib_dspeak_media_start_screen_capture(uint64_t display_id, int* error_out) {
    (void)display_id;
    if (error_out) *error_out = -100;
    return -1;
}

extern "C" int lib_dspeak_media_stop_screen_capture(int* error_out) {
    if (error_out) *error_out = 0;
    return 0;
}

extern "C" int lib_dspeak_media_start_system_audio_capture(int* error_out) {
    if (error_out) *error_out = -100;
    return -1;
}

extern "C" void lib_dspeak_media_stop_system_audio_capture(void) {}


#endif

