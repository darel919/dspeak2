#ifndef LIB_DSPEAK_MEDIA_PLATFORM_WINDOWS_INTERNAL_HPP_
#define LIB_DSPEAK_MEDIA_PLATFORM_WINDOWS_INTERNAL_HPP_

#define NOMINMAX
#include "../PlatformCapture.h"
#include "NativeThreadScheduler.h"

#include <windows.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <avrt.h>
#include <dwmapi.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <functiondiscoverykeys_devpkey.h>
#include <ksmedia.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <mmdeviceapi.h>
#include <propvarutil.h>
#include <wrl.h>
#include <wrl/client.h>
#include <windows.graphics.capture.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include <roapi.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <winrt/base.h>

#include <modules/desktop_capture/desktop_capturer.h>
#include <modules/desktop_capture/desktop_frame.h>
#include <json.hpp>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <iterator>
#include <map>
#include <memory>
#include <mutex>
#include <new>
#include <set>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace dspeak_windows {

using Microsoft::WRL::ComPtr;
using json = nlohmann::json;
using Microsoft::WRL::ClassicCom;
using Microsoft::WRL::FtmBase;
using Microsoft::WRL::RuntimeClass;
using Microsoft::WRL::RuntimeClassFlags;
using winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool;
using winrt::Windows::Graphics::Capture::GraphicsCaptureItem;
using winrt::Windows::Graphics::Capture::GraphicsCaptureSession;
using winrt::Windows::Graphics::DirectX::DirectXPixelFormat;
using winrt::Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;

struct ComScope {
    HRESULT result = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    bool owns = SUCCEEDED(result);

    ~ComScope() {
        if (owns) CoUninitialize();
    }

    bool usable() const {
        return SUCCEEDED(result) || result == RPC_E_CHANGED_MODE;
    }
};

struct WinRtScope {
    HRESULT result = RoInitialize(RO_INIT_MULTITHREADED);

    ~WinRtScope() {
        if (SUCCEEDED(result)) RoUninitialize();
    }

    bool usable() const {
        return SUCCEEDED(result) || result == RPC_E_CHANGED_MODE;
    }
};

struct ApplicationSourceInfo {
    DWORD process_id = 0;
    std::string title;
    int64_t display_id = 0;
    RECT bounds{};
};

ComPtr<IAudioClient> activate_process_loopback(DWORD process_id,
                                               bool include_process_tree,
                                               HRESULT* result_out);
bool ensure_media_foundation();
std::wstring utf8_to_wide(const char* value);
std::string wide_to_utf8(const wchar_t* value);
char* json_string(const json& value);
std::wstring endpoint_id_from_value(const char* value);
ComPtr<IMMDeviceEnumerator> create_device_enumerator();
ComPtr<IMMDevice> get_audio_device(const std::wstring& requested, EDataFlow flow);
std::string endpoint_friendly_name(IMMDevice* device);
bool endpoint_exists(EDataFlow flow);
bool windows_process_loopback_supported();
json audio_device_json(IMMDevice* device,
                       const std::string& device_id,
                       const std::string& kind,
                       const std::string& source_type,
                       bool audio);
void append_audio_devices(json& result,
                          EDataFlow flow,
                          const char* kind,
                          const char* source_type);
bool enumerate_camera_activates(std::vector<ComPtr<IMFActivate>>& result);
std::string camera_attribute(IMFActivate* activate, REFGUID key);
void append_camera_devices(json& result);
std::string decimal_source_id(intptr_t source_id);
bool parse_source_id(const std::string& source_id, intptr_t* result);
DWORD window_process_id(const std::string& source_id, const std::string& source_type);
bool is_current_process_window(intptr_t source_id);
std::string process_friendly_name(DWORD process_id, const std::string& fallback);
RECT window_bounds(HWND window);
std::vector<HMONITOR> display_monitors();
HMONITOR monitor_from_source_id(intptr_t source_id);
RECT monitor_bounds(HMONITOR monitor);
std::string monitor_title(HMONITOR monitor);
bool windows_graphics_capture_supported();
bool valid_window_bounds(const RECT& bounds);
bool is_window_cloaked(HWND window);
bool is_capture_window(HWND window);
std::vector<HWND> process_windows(DWORD process_id);
std::vector<HWND> all_capture_windows();
bool audio_format_details(const WAVEFORMATEX* format,
                          bool& is_float,
                          uint16_t& channels,
                          uint32_t& sample_rate,
                          uint16_t& bits);

bool valid_capture_source(const std::string& source_id,
                          const std::string& source_type);
std::unique_ptr<webrtc::DesktopCapturer> create_desktop_capturer(
    const std::string& source_type,
    const std::string& source_id);
json list_desktop_sources();

void* create_audio_capture(const std::wstring& endpoint_id,
                           bool loopback,
                           DWORD process_id,
                           bool include_process_tree,
                           lib_dspeak_media_audio_frame_cb audio_cb,
                           lib_dspeak_media_capture_error_cb error_cb,
                           void* user_data);
int start_audio_capture(void* value);
void destroy_audio_capture(void* value);
void* create_camera_capture(const std::wstring& device_id,
                            uint32_t video_width,
                            uint32_t video_height,
                            uint32_t video_frame_rate,
                            lib_dspeak_media_screen_frame_cb screen_cb,
                            lib_dspeak_media_capture_error_cb error_cb,
                            void* user_data);
int start_camera_capture(void* value);
void destroy_camera_capture(void* value);

}

#endif
