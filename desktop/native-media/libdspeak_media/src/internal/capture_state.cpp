#include "capture_state.hpp"

#if defined(__APPLE__) || defined(_WIN32)

std::mutex g_capture_mutex;
std::mutex g_track_mutex;
lib_dspeak_media_capture_session* g_capture = nullptr;
lib_dspeak_media_capture_session* g_system_audio_capture = nullptr;
bool g_capture_has_video = false;
bool g_capture_has_audio = false;
bool g_system_audio_has_audio = false;
lib_dspeak_media_device_capture_session* g_microphone_capture = nullptr;
lib_dspeak_media_device_capture_session* g_camera_capture = nullptr;
lib_dspeak_media_video_track_t* g_video_track = nullptr;
lib_dspeak_media_audio_track_t* g_audio_track = nullptr;
lib_dspeak_media_video_track_t* g_camera_track = nullptr;
lib_dspeak_media_audio_track_t* g_microphone_track = nullptr;
std::string g_microphone_device_id;
std::string g_camera_device_id;
std::string g_camera_settings_json;
std::atomic<double> g_shared_audio_volume{1.0};
std::atomic<double> g_shared_audio_attenuation_target{1.0};
std::atomic<double> g_shared_audio_attenuation_current{1.0};
std::atomic<int> g_shared_audio_attack_ms{120};
std::atomic<int> g_shared_audio_release_ms{650};
std::atomic<double> g_microphone_level_db{-60.0};
std::atomic<double> g_shared_audio_level_db{-60.0};
std::atomic<double> g_shared_audio_level{0.0};
std::atomic<bool> g_microphone_check_recording{false};
std::mutex g_microphone_check_mutex;
std::vector<int16_t> g_microphone_check_samples;
CaptureAudioRing g_audio_pending[3];
std::atomic<int> g_capture_error{0};
std::atomic<uint64_t> g_probe_video_frames{0};
std::atomic<uint64_t> g_probe_audio_frames{0};
std::atomic<bool> g_screen_frame_logged{false};
std::atomic<bool> g_camera_frame_logged{false};
CaptureRoute g_desktop_route = CaptureRoute::kDesktop;
CaptureRoute g_microphone_route = CaptureRoute::kMicrophone;
CaptureRoute g_camera_route = CaptureRoute::kCamera;

CaptureAudioRing& audio_pending_for_route(CaptureRoute route) {
    return g_audio_pending[static_cast<size_t>(route)];
}

CaptureRoute* capture_route(void* user_data) {
    return static_cast<CaptureRoute*>(user_data);
}

lib_dspeak_media_video_track_t* video_track_for_route(CaptureRoute route) {
    return route == CaptureRoute::kCamera ? g_camera_track : g_video_track;
}

lib_dspeak_media_audio_track_t* audio_track_for_route(CaptureRoute route) {
    return route == CaptureRoute::kMicrophone ? g_microphone_track : g_audio_track;
}

#endif
