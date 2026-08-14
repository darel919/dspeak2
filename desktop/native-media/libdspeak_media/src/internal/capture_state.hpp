#ifndef LIB_DSPEAK_MEDIA_INTERNAL_CAPTURE_STATE_HPP_
#define LIB_DSPEAK_MEDIA_INTERNAL_CAPTURE_STATE_HPP_

#include "lib_dspeak_media/lib_dspeak_media.h"
#include "PlatformCapture.h"

#include <atomic>
#include <cstdint>
#include <mutex>
#include <string>
#include <vector>
#include "../../../platform/AudioSpscRing.hpp"

enum class CaptureRoute {
    kDesktop,
    kMicrophone,
    kCamera,
};

extern std::mutex g_capture_mutex;
extern std::mutex g_track_mutex;
extern lib_dspeak_media_capture_session* g_capture;
extern lib_dspeak_media_capture_session* g_system_audio_capture;
extern bool g_capture_has_video;
extern bool g_capture_has_audio;
extern bool g_system_audio_has_audio;
extern lib_dspeak_media_device_capture_session* g_microphone_capture;
extern lib_dspeak_media_device_capture_session* g_camera_capture;
extern lib_dspeak_media_video_track_t* g_video_track;
extern lib_dspeak_media_audio_track_t* g_audio_track;
extern lib_dspeak_media_video_track_t* g_camera_track;
extern lib_dspeak_media_audio_track_t* g_microphone_track;
extern std::string g_microphone_device_id;
extern std::string g_camera_device_id;
extern std::string g_camera_settings_json;
extern std::atomic<double> g_shared_audio_volume;
extern std::atomic<double> g_shared_audio_attenuation_target;
extern std::atomic<double> g_shared_audio_attenuation_current;
extern std::atomic<int> g_shared_audio_attack_ms;
extern std::atomic<int> g_shared_audio_release_ms;
extern std::atomic<double> g_microphone_level_db;
extern std::atomic<double> g_shared_audio_level_db;
extern std::atomic<double> g_shared_audio_level;
extern std::atomic<bool> g_microphone_check_recording;
extern std::mutex g_microphone_check_mutex;
extern std::vector<int16_t> g_microphone_check_samples;
using CaptureAudioRing = StereoAudioSpscRing<4800>;
extern CaptureAudioRing g_audio_pending[3];
extern std::atomic<int> g_capture_error;
extern std::atomic<uint64_t> g_probe_video_frames;
extern std::atomic<uint64_t> g_probe_audio_frames;
extern std::atomic<bool> g_screen_frame_logged;
extern std::atomic<bool> g_screen_audio_callback_logged;
extern std::atomic<bool> g_screen_audio_emitted_logged;
extern std::atomic<bool> g_camera_frame_logged;
extern CaptureRoute g_desktop_route;
extern CaptureRoute g_microphone_route;
extern CaptureRoute g_camera_route;

CaptureAudioRing& audio_pending_for_route(CaptureRoute route);
CaptureRoute* capture_route(void* user_data);
lib_dspeak_media_video_track_t* video_track_for_route(CaptureRoute route);
lib_dspeak_media_audio_track_t* audio_track_for_route(CaptureRoute route);

void on_screen_frame(void* user_data,
                    const uint8_t* data,
                    uint32_t width,
                    uint32_t height,
                    uint32_t stride,
                    int64_t timestamp_ms);
void on_audio_frame(void* user_data,
                   const float* data,
                   uint32_t frame_count,
                   uint32_t sample_rate,
                   uint8_t channels);
void on_capture_error(void* user_data, int error_code, const char* message);

#endif
