#include "PlatformCaptureWindowsInternal.hpp"

#if defined(_WIN32)

using namespace dspeak_windows;

struct lib_dspeak_media_capture_session;

class DesktopFrameCallback final : public webrtc::DesktopCapturer::Callback {
public:
    explicit DesktopFrameCallback(lib_dspeak_media_capture_session* session)
        : session_(session) {}

    void OnCaptureResult(webrtc::DesktopCapturer::Result result,
                         std::unique_ptr<webrtc::DesktopFrame> frame) override;

private:
    lib_dspeak_media_capture_session* session_ = nullptr;
};

struct lib_dspeak_media_capture_session {
    std::mutex mutex;
    bool running = false;
    bool capture_video = false;
    bool capture_audio = false;
    bool stop_requested = false;
    uint32_t consecutive_capture_failures = 0;
    bool capture_error_reported = false;
    std::string source_id;
    std::string source_type;
    uint32_t frame_rate = 60;
    lib_dspeak_media_screen_frame_cb screen_cb = nullptr;
    lib_dspeak_media_audio_frame_cb audio_cb = nullptr;
    lib_dspeak_media_capture_error_cb error_cb = nullptr;
    void* user_data = nullptr;
    std::unique_ptr<webrtc::DesktopCapturer> capturer;
    std::unique_ptr<DesktopFrameCallback> capturer_callback;
    void* audio_capture = nullptr;
    std::thread video_thread;
};

struct lib_dspeak_media_device_capture_session {
    bool microphone = false;
    std::wstring device_id;
    uint32_t video_width = 1280;
    uint32_t video_height = 720;
    uint32_t video_frame_rate = 30;
    void* audio_capture = nullptr;
    void* camera_capture = nullptr;
};

void DesktopFrameCallback::OnCaptureResult(
    webrtc::DesktopCapturer::Result result,
    std::unique_ptr<webrtc::DesktopFrame> frame) {
    if (!session_) return;
    if (result != webrtc::DesktopCapturer::Result::SUCCESS || !frame) {
        lib_dspeak_media_capture_error_cb error_cb = nullptr;
        void* user_data = nullptr;
        bool report_error = false;
        {
            std::lock_guard<std::mutex> lock(session_->mutex);
            if (!session_->running) return;
            if (result == webrtc::DesktopCapturer::Result::ERROR_PERMANENT)
                session_->consecutive_capture_failures = 120;
            else
                session_->consecutive_capture_failures = std::min(
                    120u, session_->consecutive_capture_failures + 1);
            if (session_->consecutive_capture_failures >= 120 &&
                !session_->capture_error_reported) {
                session_->capture_error_reported = true;
                session_->stop_requested = true;
                session_->running = false;
                error_cb = session_->error_cb;
                user_data = session_->user_data;
                report_error = true;
            }
        }
        if (report_error && error_cb)
            error_cb(user_data, -627,
                     "Windows Graphics Capture stopped delivering frames");
        return;
    }
    std::lock_guard<std::mutex> lock(session_->mutex);
    if (!session_->running || !session_->screen_cb) return;
    const auto& size = frame->size();
    if (size.width() <= 0 || size.height() <= 0 || frame->stride() <= 0) return;
    session_->consecutive_capture_failures = 0;
    session_->capture_error_reported = false;
    session_->screen_cb(session_->user_data, frame->data(),
                        static_cast<uint32_t>(size.width()),
                        static_cast<uint32_t>(size.height()),
                        static_cast<uint32_t>(frame->stride()),
                        static_cast<int64_t>(
                            std::chrono::duration_cast<std::chrono::milliseconds>(
                                std::chrono::steady_clock::now().time_since_epoch()).count()));
}

namespace {

void capture_error(lib_dspeak_media_capture_session* session,
                   int code,
                   const char* message) {
    if (session && session->error_cb)
        session->error_cb(session->user_data, code, message);
}

int start_desktop_capture(lib_dspeak_media_capture_session* session) {
    if (!session->capture_video) return 0;
    session->capturer = create_desktop_capturer(session->source_type,
                                                session->source_id);
    if (!session->capturer) return -621;
    intptr_t source_id = 0;
    if (!parse_source_id(session->source_id, &source_id)) return -622;
    if (!session->capturer->SelectSource(source_id)) return -623;
    session->capturer_callback = std::make_unique<DesktopFrameCallback>(session);
    session->capturer->Start(session->capturer_callback.get());
    session->video_thread = std::thread([session] {
        dspeak_native::configure_current_media_thread();
        ComScope com;
        const uint32_t rate = std::max(1u, session->frame_rate);
        const auto interval = std::chrono::milliseconds(1000 / rate);
        while (true) {
            {
                std::lock_guard<std::mutex> lock(session->mutex);
                if (session->stop_requested || !session->capturer) break;
            }
            session->capturer->CaptureFrame();
            std::this_thread::sleep_for(interval);
        }
    });
    return 0;
}

void stop_desktop_capture(lib_dspeak_media_capture_session* session) {
    if (!session) return;
    {
        std::lock_guard<std::mutex> lock(session->mutex);
        session->stop_requested = true;
        session->running = false;
    }
    destroy_audio_capture(session->audio_capture);
    session->audio_capture = nullptr;
    if (session->video_thread.joinable()) session->video_thread.join();
    session->capturer.reset();
    session->capturer_callback.reset();
}

void set_capture_session_callbacks(lib_dspeak_media_capture_session* session,
                                   lib_dspeak_media_screen_frame_cb screen_cb,
                                   lib_dspeak_media_audio_frame_cb audio_cb,
                                   lib_dspeak_media_capture_error_cb error_cb,
                                   void* user_data) {
    session->screen_cb = screen_cb;
    session->audio_cb = audio_cb;
    session->error_cb = error_cb;
    session->user_data = user_data;
}

}

char* lib_dspeak_media_platform_capture_list_sources(void) {
    ComScope com;
    if (!com.usable()) return json_string(json::array());
    return json_string(list_desktop_sources());
}

struct lib_dspeak_media_capture_session*
lib_dspeak_media_platform_capture_create(const char* source_id,
                                         const char* source_type,
                                         const char* mode,
                                         bool exclude_self_audio,
                                         uint32_t,
                                         uint32_t,
                                         uint32_t video_frame_rate) {
    if (!source_id || !source_type || !mode || !exclude_self_audio) return nullptr;
    const std::string type(source_type);
    const std::string capture_mode(mode);
    const bool capture_video = capture_mode == "video" || capture_mode == "both";
    const bool capture_audio = capture_mode == "audio" || capture_mode == "both";
    if ((!capture_video && !capture_audio) ||
        (type == "system-audio" && capture_video) ||
        !valid_capture_source(source_id, type)) return nullptr;
    auto* session = new(std::nothrow) lib_dspeak_media_capture_session();
    if (!session) return nullptr;
    session->source_id = source_id;
    session->source_type = type;
    session->capture_video = capture_video;
    session->capture_audio = capture_audio;
    session->frame_rate = video_frame_rate >= 1 && video_frame_rate <= 120
        ? video_frame_rate
        : 60;
    return session;
}

int lib_dspeak_media_platform_capture_start(
    struct lib_dspeak_media_capture_session* session,
    lib_dspeak_media_screen_frame_cb screen_cb,
    lib_dspeak_media_audio_frame_cb audio_cb,
    lib_dspeak_media_capture_error_cb error_cb,
    void* user_data) {
    if (!session) return -620;
    set_capture_session_callbacks(session, screen_cb, audio_cb, error_cb, user_data);
    session->stop_requested = false;
    session->running = true;
    session->consecutive_capture_failures = 0;
    session->capture_error_reported = false;
    if (session->capture_audio) {
        if (!windows_process_loopback_supported()) {
            stop_desktop_capture(session);
            capture_error(session, -626,
                          "Windows process loopback requires Windows 10 build 20348 or newer");
            return -626;
        }
        const bool application_audio = session->source_type == "window" ||
            session->source_type == "application";
        const DWORD process_id = window_process_id(session->source_id, session->source_type);
        if (application_audio && process_id == 0) {
            stop_desktop_capture(session);
            capture_error(session, -625, "Windows application audio process could not be resolved");
            return -625;
        }
        if (application_audio && process_id == GetCurrentProcessId()) {
            stop_desktop_capture(session);
            capture_error(session, -625, "Windows application audio cannot capture the desktop process");
            return -625;
        }
        const DWORD loopback_process_id = application_audio
            ? process_id
            : GetCurrentProcessId();
        session->audio_capture = create_audio_capture(
            {}, true, loopback_process_id, application_audio,
            audio_cb, error_cb, user_data);
        if (start_audio_capture(session->audio_capture) != 0) {
            stop_desktop_capture(session);
            capture_error(session, -624, "Windows system audio capture failed to start");
            return -624;
        }
    }
    const int video_result = start_desktop_capture(session);
    if (video_result != 0) {
        stop_desktop_capture(session);
        capture_error(session, video_result, "Windows desktop capture failed to start");
        return video_result;
    }
    return 0;
}

void lib_dspeak_media_platform_capture_stop(
    struct lib_dspeak_media_capture_session* session) {
    stop_desktop_capture(session);
}

void lib_dspeak_media_platform_capture_destroy(
    struct lib_dspeak_media_capture_session* session) {
    if (!session) return;
    stop_desktop_capture(session);
    delete session;
}

char* lib_dspeak_media_platform_capture_list_devices(void) {
    ComScope com;
    if (!com.usable()) return json_string(json::array());
    json devices = json::array();
    append_audio_devices(devices, eCapture, "audioinput", "microphone");
    append_audio_devices(devices, eRender, "audiooutput", "audiooutput");
    append_camera_devices(devices);
    return json_string(devices);
}

char* lib_dspeak_media_platform_capture_capabilities(void) {
    ComScope com;
    const bool microphone = com.usable() && endpoint_exists(eCapture);
    const bool output = com.usable() && windows_process_loopback_supported() &&
        endpoint_exists(eRender);
    std::vector<ComPtr<IMFActivate>> cameras;
    const bool camera = com.usable() && enumerate_camera_activates(cameras) && !cameras.empty();
    const json capture_sources = com.usable() ? list_desktop_sources() : json::array();
    const bool desktop = com.usable() && capture_sources.is_array() &&
        std::any_of(capture_sources.begin(), capture_sources.end(), [](const auto& source) {
            return source.value("capabilities", json::object()).value("video", false);
        });
    json devices = json::array();
    if (com.usable()) {
        append_audio_devices(devices, eCapture, "audioinput", "microphone");
        append_camera_devices(devices);
    }
    json microphone_sources = json::array();
    json camera_sources = json::array();
    for (const auto& device : devices) {
        if (device.value("sourceType", "") == "microphone")
            microphone_sources.push_back(device);
        if (device.value("sourceType", "") == "camera")
            camera_sources.push_back(device);
    }
    return json_string({
        {"microphone", {
            {"available", microphone},
            {"reason", microphone ? "WASAPI capture endpoint is available"
                                   : "No active Windows microphone endpoint"},
            {"sources", microphone_sources},
        }},
        {"camera", {
            {"available", camera},
            {"reason", camera ? "Media Foundation camera endpoint is available"
                               : "No active Windows camera endpoint"},
            {"sources", camera_sources},
        }},
        {"windowsGraphicsCapture", {
            {"available", desktop},
            {"reason", desktop ? "Windows Graphics Capture sources are available"
                                : "Windows Graphics Capture returned no sources"},
        }},
        {"wasapiProcessLoopback", {
            {"available", output},
            {"reason", output
                ? "WASAPI process loopback endpoint is available"
                : windows_process_loopback_supported()
                    ? "No active Windows render endpoint"
                    : "Windows process loopback requires Windows 10 build 20348 or newer"},
        }},
    });
}

struct lib_dspeak_media_device_capture_session*
lib_dspeak_media_platform_device_capture_create(const char* device_id,
                                                const char* kind,
                                                uint32_t video_width,
                                                uint32_t video_height,
                                                uint32_t video_frame_rate) {
    if (!kind || (std::strcmp(kind, "microphone") != 0 &&
                  std::strcmp(kind, "camera") != 0)) return nullptr;
    auto* session = new(std::nothrow) lib_dspeak_media_device_capture_session();
    if (!session) return nullptr;
    session->microphone = std::strcmp(kind, "microphone") == 0;
    session->device_id = std::strcmp(kind, "camera") == 0
        ? camera_id_from_value(device_id)
        : utf8_to_wide(device_id);
    session->video_width = video_width;
    session->video_height = video_height;
    session->video_frame_rate = video_frame_rate;
    return session;
}

int lib_dspeak_media_platform_device_capture_start(
    struct lib_dspeak_media_device_capture_session* session,
    lib_dspeak_media_screen_frame_cb screen_cb,
    lib_dspeak_media_audio_frame_cb audio_cb,
    lib_dspeak_media_capture_error_cb error_cb,
    void* user_data) {
    if (!session) return -630;
    if (session->microphone) {
        session->audio_capture = create_audio_capture(
            session->device_id, false, 0, true, audio_cb, error_cb, user_data);
        const int result = start_audio_capture(session->audio_capture);
        if (result != 0) {
            destroy_audio_capture(session->audio_capture);
            session->audio_capture = nullptr;
        }
        return result;
    }
    session->camera_capture = create_camera_capture(
        session->device_id,
        session->video_width,
        session->video_height,
        session->video_frame_rate,
        screen_cb, error_cb, user_data);
    const int result = start_camera_capture(session->camera_capture);
    if (result != 0) {
        destroy_camera_capture(session->camera_capture);
        session->camera_capture = nullptr;
    }
    return result;
}

void lib_dspeak_media_platform_device_capture_stop(
    struct lib_dspeak_media_device_capture_session* session) {
    if (!session) return;
    destroy_audio_capture(session->audio_capture);
    session->audio_capture = nullptr;
    destroy_camera_capture(session->camera_capture);
    session->camera_capture = nullptr;
}

void lib_dspeak_media_platform_device_capture_destroy(
    struct lib_dspeak_media_device_capture_session* session) {
    if (!session) return;
    lib_dspeak_media_platform_device_capture_stop(session);
    delete session;
}

#endif
