#ifndef LIB_DSPEAK_MEDIA_PLATFORM_CAPTURE_H_
#define LIB_DSPEAK_MEDIA_PLATFORM_CAPTURE_H_

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct lib_dspeak_media_capture_session lib_dspeak_media_capture_session;
typedef struct lib_dspeak_media_device_capture_session lib_dspeak_media_device_capture_session;

typedef void (*lib_dspeak_media_screen_frame_cb)(void* user_data, void* sample_buffer);
typedef void (*lib_dspeak_media_audio_frame_cb)(void* user_data, const float* samples,
                                                uint32_t frame_count,
                                                uint32_t sample_rate,
                                                uint8_t channels);
typedef void (*lib_dspeak_media_capture_error_cb)(void* user_data, int error_code,
                                                  const char* message);

char* lib_dspeak_media_platform_capture_list_sources(void);

struct lib_dspeak_media_capture_session*
lib_dspeak_media_platform_capture_create(const char* source_id,
                                         const char* source_type,
                                         const char* mode,
                                         bool exclude_self_audio);

int lib_dspeak_media_platform_capture_start(
    struct lib_dspeak_media_capture_session* session,
    lib_dspeak_media_screen_frame_cb screen_cb,
    lib_dspeak_media_audio_frame_cb audio_cb,
    lib_dspeak_media_capture_error_cb error_cb,
    void* user_data);

void lib_dspeak_media_platform_capture_stop(
    struct lib_dspeak_media_capture_session* session);

void lib_dspeak_media_platform_capture_destroy(
    struct lib_dspeak_media_capture_session* session);

char* lib_dspeak_media_platform_capture_list_devices(void);
char* lib_dspeak_media_platform_capture_capabilities(void);

struct lib_dspeak_media_device_capture_session*
lib_dspeak_media_platform_device_capture_create(const char* device_id,
                                                const char* kind);

int lib_dspeak_media_platform_device_capture_start(
    struct lib_dspeak_media_device_capture_session* session,
    lib_dspeak_media_screen_frame_cb screen_cb,
    lib_dspeak_media_audio_frame_cb audio_cb,
    lib_dspeak_media_capture_error_cb error_cb,
    void* user_data);

void lib_dspeak_media_platform_device_capture_stop(
    struct lib_dspeak_media_device_capture_session* session);

void lib_dspeak_media_platform_device_capture_destroy(
    struct lib_dspeak_media_device_capture_session* session);

#ifdef __cplusplus
}
#endif

#endif
