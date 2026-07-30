//  PlatformCapture.h
//  ObjC++ bridge for ScreenCaptureKit (video) + CoreAudio (system audio)
//
//  The portable C++ shim calls these entrypoints through its C ABI. The
//  capture implementation remains isolated here because ScreenCaptureKit and
//  CoreAudio are Objective-C/Apple framework APIs.

#ifndef DSM_PLATFORM_CAPTURE_H_
#define DSM_PLATFORM_CAPTURE_H_

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

#if defined(__APPLE__)

struct dsm_screen_capture;
struct dsm_audio_capture;

/// Create a ScreenCaptureKit display capture for |display_id|.
/// Returns a handle, or NULL on failure.
struct dsm_screen_capture* dsm_platform_screen_capture_create(uint64_t display_id);

/// Release the capture handle.
void dsm_platform_screen_capture_destroy(struct dsm_screen_capture*);

/// Start capturing.  |destructor| callback is called with |user_data| when
/// the capture is ready to stream.  |frame_cb| is called for each new
/// video frame with the shared CMSampleBuffer pointer (retained by the
/// callback — the caller must release it with CMSampleBufferRelease).
typedef void (*dsm_screen_frame_cb)(void* user_data, void* sample_buffer);
int dsm_platform_screen_capture_start(struct dsm_screen_capture*,
                                       dsm_screen_frame_cb cb,
                                       void* user_data);

/// Stop the capture and release resources.
void dsm_platform_screen_capture_stop(struct dsm_screen_capture*);

/// Create a CoreAudio system-audio capture (loopback).
struct dsm_audio_capture* dsm_platform_audio_capture_create(void);

/// Release the capture handle.
void dsm_platform_audio_capture_destroy(struct dsm_audio_capture*);

/// Start capturing system audio.  |pcm_cb| is called with interleaved
/// float samples.  |sample_rate| and |channels| report the hardware format.
typedef void (*dsm_audio_frame_cb)(void* user_data, const float* samples,
                                    uint32_t frame_count,
                                    uint32_t sample_rate, uint8_t channels);
int dsm_platform_audio_capture_start(struct dsm_audio_capture*,
                                      dsm_audio_frame_cb cb,
                                      void* user_data);

/// Stop the capture and release resources.
void dsm_platform_audio_capture_stop(struct dsm_audio_capture*);

#endif /* __APPLE__ */

#ifdef __cplusplus
}
#endif

#endif /* DSM_PLATFORM_CAPTURE_H_ */