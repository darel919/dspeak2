#ifndef DSPEAK_MEDIA_PLATFORM_CAPTURE_H_
#define DSPEAK_MEDIA_PLATFORM_CAPTURE_H_

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct lib_dspeak_media_capture_session lib_dspeak_media_capture_session;
typedef struct lib_dspeak_media_device_capture_session lib_dspeak_media_device_capture_session;

typedef void (*lib_dspeak_media_screen_frame_cb)(void* user_data,
                                                  const uint8_t* data,
                                                  uint32_t width,
                                                  uint32_t height,
                                                  uint32_t stride,
                                                  int64_t timestamp_ms);
typedef void (*lib_dspeak_media_audio_frame_cb)(void* user_data,
                                                const float* samples,
                                                uint32_t frame_count,
                                                uint32_t sample_rate,
                                                uint8_t channels);
typedef void (*lib_dspeak_media_capture_error_cb)(void* user_data,
                                                  int error_code,
                                                  const char* message);

char* lib_dspeak_media_platform_capture_list_sources(void);

struct lib_dspeak_media_capture_session*
lib_dspeak_media_platform_capture_create(const char* source_id,
                                         const char* source_type,
                                         const char* mode,
                                         bool exclude_self_audio,
                                         uint32_t video_width,
                                         uint32_t video_height,
                                         uint32_t video_frame_rate);

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
                                                const char* kind,
                                                uint32_t video_width,
                                                uint32_t video_height,
                                                uint32_t video_frame_rate);

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

int lib_dspeak_media_platform_set_output_device(const char* device_id);

void* lib_dspeak_media_platform_audio_output_create(const char* device_id);
void lib_dspeak_media_platform_audio_output_destroy(void* output);
int lib_dspeak_media_platform_audio_output_start(void* output);
void lib_dspeak_media_platform_audio_output_stop(void* output);
void lib_dspeak_media_platform_audio_output_set_enabled(void* output, bool enabled);
void lib_dspeak_media_platform_audio_output_set_volume(void* output, double volume);
void lib_dspeak_media_platform_audio_output_set_jitter_buffer(
    void* output,
    int min_delay_ms,
    int target_delay_ms);
void lib_dspeak_media_platform_audio_output_write(void* output,
                                                  const float* samples,
                                                  uint32_t frame_count,
                                                  uint32_t sample_rate,
                                                  uint8_t channels);
void lib_dspeak_media_platform_audio_output_get_metrics(
    uint32_t* device_period_frames,
    uint32_t* render_period_frames,
    uint32_t* queue_frames,
    uint64_t* dropped_frames,
    uint32_t* target_frames,
    uint32_t* output_count);

#ifdef __cplusplus
}
#endif

#endif
