#include "PlatformCaptureWindowsInternal.hpp"

#if defined(_WIN32)

namespace dspeak_windows {

class ProcessLoopbackActivationHandler final
    : public RuntimeClass<RuntimeClassFlags<ClassicCom>,
                          FtmBase,
                          IActivateAudioInterfaceCompletionHandler> {
public:
    HRESULT ActivateCompleted(
        IActivateAudioInterfaceAsyncOperation* operation) override {
        HRESULT result = operation ? E_FAIL : E_INVALIDARG;
        HRESULT activation_result = E_FAIL;
        ComPtr<IUnknown> unknown;
        ComPtr<IAudioClient> client;
        if (operation) result = operation->GetActivateResult(&activation_result, &unknown);
        if (SUCCEEDED(result)) result = activation_result;
        if (SUCCEEDED(result) && unknown) result = unknown.As(&client);
        HANDLE event = nullptr;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            result_ = result;
            client_ = client;
            event = event_;
        }
        if (event) SetEvent(event);
        return S_OK;
    }

    void set_event(HANDLE event) {
        std::lock_guard<std::mutex> lock(mutex_);
        event_ = event;
    }

    HRESULT result() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return result_;
    }

    ComPtr<IAudioClient> client() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return client_;
    }

private:
    mutable std::mutex mutex_;
    HANDLE event_ = nullptr;
    HRESULT result_ = E_UNEXPECTED;
    ComPtr<IAudioClient> client_;
};

ComPtr<IAudioClient> activate_process_loopback(DWORD process_id,
                                               bool include_process_tree,
                                               HRESULT* result_out) {
    if (result_out) *result_out = E_FAIL;
    HANDLE event = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    if (!event) {
        if (result_out) *result_out = HRESULT_FROM_WIN32(GetLastError());
        return nullptr;
    }
    auto handler = Make<ProcessLoopbackActivationHandler>();
    if (!handler) {
        CloseHandle(event);
        if (result_out) *result_out = E_OUTOFMEMORY;
        return nullptr;
    }
    handler->set_event(event);
    AUDIOCLIENT_ACTIVATION_PARAMS activation_params{};
    activation_params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
    activation_params.ProcessLoopbackParams.TargetProcessId = process_id;
    activation_params.ProcessLoopbackParams.ProcessLoopbackMode = include_process_tree
        ? PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
        : PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;
    auto* activation_blob = static_cast<BYTE*>(
        CoTaskMemAlloc(sizeof(activation_params)));
    if (!activation_blob) {
        CloseHandle(event);
        if (result_out) *result_out = E_OUTOFMEMORY;
        return nullptr;
    }
    std::memcpy(activation_blob, &activation_params, sizeof(activation_params));
    PROPVARIANT parameters;
    PropVariantInit(&parameters);
    parameters.vt = VT_BLOB;
    parameters.blob.cbSize = sizeof(activation_params);
    parameters.blob.pBlobData = activation_blob;
    ComPtr<IActivateAudioInterfaceAsyncOperation> operation;
    HRESULT result = ActivateAudioInterfaceAsync(
        VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
        __uuidof(IAudioClient),
        &parameters,
        handler.Get(),
        &operation);
    ComPtr<IAudioClient> client;
    if (SUCCEEDED(result)) {
        const DWORD wait_result = WaitForSingleObject(event, 10000);
        result = wait_result == WAIT_OBJECT_0
            ? handler->result()
            : wait_result == WAIT_TIMEOUT
                ? HRESULT_FROM_WIN32(ERROR_TIMEOUT)
                : HRESULT_FROM_WIN32(GetLastError());
        if (SUCCEEDED(result)) client = handler->client();
    }
    handler->set_event(nullptr);
    CloseHandle(event);
    PropVariantClear(&parameters);
    if (result_out) *result_out = result;
    return client;
}

bool ensure_media_foundation() {
    static std::once_flag once;
    static bool ready = false;
    std::call_once(once, [] {
        ready = SUCCEEDED(MFStartup(MF_VERSION, MFSTARTUP_FULL));
    });
    return ready;
}

std::wstring utf8_to_wide(const char* value) {
    if (!value || !value[0]) return {};
    const int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS,
                                           value, -1, nullptr, 0);
    if (length <= 1) return {};
    std::wstring result(static_cast<size_t>(length), L'\0');
    if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value, -1,
                            result.data(), length) <= 0)
        return {};
    result.resize(static_cast<size_t>(length - 1));
    return result;
}

std::string wide_to_utf8(const wchar_t* value) {
    if (!value || !value[0]) return {};
    const int length = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS,
                                           value, -1, nullptr, 0, nullptr, nullptr);
    if (length <= 1) return {};
    std::string result(static_cast<size_t>(length), '\0');
    if (WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value, -1,
                            result.data(), length, nullptr, nullptr) <= 0)
        return {};
    result.resize(static_cast<size_t>(length - 1));
    return result;
}

char* json_string(const json& value) {
    const std::string serialized = value.dump();
    auto* result = static_cast<char*>(std::malloc(serialized.size() + 1));
    if (!result) return nullptr;
    std::memcpy(result, serialized.c_str(), serialized.size() + 1);
    return result;
}

std::wstring endpoint_id_from_value(const char* value) {
    std::wstring result = utf8_to_wide(value);
    const std::wstring prefix = L"windows:audiooutput:";
    if (result.rfind(prefix, 0) == 0) result.erase(0, prefix.size());
    return result;
}

std::wstring camera_id_from_value(const char* value) {
    std::wstring result = utf8_to_wide(value);
    const std::wstring prefix = L"windows:camera:";
    if (result.rfind(prefix, 0) == 0) result.erase(0, prefix.size());
    return result;
}

ComPtr<IMMDeviceEnumerator> create_device_enumerator() {
    ComPtr<IMMDeviceEnumerator> enumerator;
    if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr,
                                CLSCTX_ALL, IID_PPV_ARGS(&enumerator))))
        return nullptr;
    return enumerator;
}

ComPtr<IMMDevice> get_audio_device(const std::wstring& requested,
                                   EDataFlow flow) {
    auto enumerator = create_device_enumerator();
    if (!enumerator) return nullptr;
    ComPtr<IMMDevice> device;
    if (requested.empty()) {
        if (FAILED(enumerator->GetDefaultAudioEndpoint(flow, eConsole, &device)))
            return nullptr;
    } else if (FAILED(enumerator->GetDevice(requested.c_str(), &device))) {
        return nullptr;
    }
    return device;
}

std::string endpoint_friendly_name(IMMDevice* device) {
    if (!device) return {};
    ComPtr<IPropertyStore> properties;
    if (FAILED(device->OpenPropertyStore(STGM_READ, &properties))) return {};
    PROPVARIANT value;
    PropVariantInit(&value);
    std::string result;
    if (SUCCEEDED(properties->GetValue(PKEY_Device_FriendlyName, &value))) {
        if (value.vt == VT_LPWSTR) result = wide_to_utf8(value.pwszVal);
        else if (value.vt == VT_BSTR) result = wide_to_utf8(value.bstrVal);
    }
    PropVariantClear(&value);
    return result;
}

bool endpoint_exists(EDataFlow flow) {
    ComScope com;
    return com.usable() && get_audio_device({}, flow) != nullptr;
}

bool windows_process_loopback_supported() {
    static const bool supported = [] {
        OSVERSIONINFOEXW version{};
        using RtlGetVersion = LONG(WINAPI*)(OSVERSIONINFOEXW*);
        const HMODULE module = GetModuleHandleW(L"ntdll.dll");
        if (!module) return false;
        const auto get_version = reinterpret_cast<RtlGetVersion>(
            GetProcAddress(module, "RtlGetVersion"));
        if (!get_version) return false;
        version.dwOSVersionInfoSize = sizeof(version);
        if (get_version(&version) != 0) return false;
        return version.dwMajorVersion > 10 ||
            (version.dwMajorVersion == 10 && version.dwBuildNumber >= 20348);
    }();
    return supported;
}

json audio_device_json(IMMDevice* device,
                       const std::string& device_id,
                       const std::string& kind,
                       const std::string& source_type,
                       bool audio) {
    const std::string source_id = "windows:" + source_type + ":" + device_id;
    return {
        {"deviceId", device_id},
        {"kind", kind},
        {"sourceId", source_id},
        {"sourceType", source_type},
        {"sourceKey", source_type + ":" + source_id},
        {"title", endpoint_friendly_name(device)},
        {"label", endpoint_friendly_name(device)},
        {"groupId", device_id},
        {"available", true},
        {"capabilities", {
            {"audio", audio},
            {"video", false},
            {"stereo", audio},
            {"channels", audio ? 2 : 0},
            {"sampleRate", audio ? 48000 : 0},
        }},
    };
}

void append_audio_devices(json& result, EDataFlow flow,
                          const char* kind, const char* source_type) {
    auto enumerator = create_device_enumerator();
    if (!enumerator) return;
    ComPtr<IMMDeviceCollection> devices;
    if (FAILED(enumerator->EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE,
                                              &devices)))
        return;
    UINT count = 0;
    if (FAILED(devices->GetCount(&count))) return;
    for (UINT index = 0; index < count; ++index) {
        ComPtr<IMMDevice> device;
        LPWSTR raw_id = nullptr;
        if (FAILED(devices->Item(index, &device)) ||
            FAILED(device->GetId(&raw_id)))
            continue;
        const std::string device_id = wide_to_utf8(raw_id);
        CoTaskMemFree(raw_id);
        if (!device_id.empty())
            result.push_back(audio_device_json(device.Get(), device_id, kind,
                                               source_type, true));
    }
}

bool enumerate_camera_activates(std::vector<ComPtr<IMFActivate>>& result) {
    if (!ensure_media_foundation()) return false;
    ComPtr<IMFAttributes> attributes;
    if (FAILED(MFCreateAttributes(&attributes, 1)) ||
        FAILED(attributes->SetGUID(
            MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE,
            MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID)))
        return false;
    IMFActivate** activates = nullptr;
    UINT32 count = 0;
    if (FAILED(MFEnumDeviceSources(attributes.Get(), &activates, &count)))
        return false;
    for (UINT32 index = 0; index < count; ++index) {
        ComPtr<IMFActivate> activation;
        activation.Attach(activates[index]);
        result.emplace_back(std::move(activation));
    }
    CoTaskMemFree(activates);
    return true;
}

std::string camera_attribute(IMFActivate* activate, REFGUID key) {
    if (!activate) return {};
    WCHAR* value = nullptr;
    UINT32 length = 0;
    if (FAILED(activate->GetAllocatedString(key, &value, &length))) return {};
    const std::string result = wide_to_utf8(value);
    CoTaskMemFree(value);
    return result;
}

void append_camera_devices(json& result) {
    std::vector<ComPtr<IMFActivate>> cameras;
    if (!enumerate_camera_activates(cameras)) return;
    for (const auto& camera : cameras) {
        const std::string device_id = camera_attribute(
            camera.Get(), MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK);
        const std::string title = camera_attribute(
            camera.Get(), MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME);
        if (device_id.empty()) continue;
        const std::string source_id = "windows:camera:" + device_id;
        result.push_back({
            {"deviceId", device_id},
            {"kind", "videoinput"},
            {"sourceId", source_id},
            {"sourceType", "camera"},
            {"sourceKey", "camera:" + source_id},
            {"title", title},
            {"label", title},
            {"available", true},
            {"capabilities", {
                {"audio", false},
                {"video", true},
                {"stereo", false},
                {"channels", 0},
                {"sampleRate", 0},
            }},
        });
    }
}

std::string decimal_source_id(intptr_t source_id) {
    return std::to_string(static_cast<long long>(source_id));
}

bool parse_source_id(const std::string& source_id, intptr_t* result) {
    if (!result) return false;
    const auto first_digit = source_id.find_last_of(':');
    const std::string value = first_digit == std::string::npos
        ? source_id
        : source_id.substr(first_digit + 1);
    try {
        size_t parsed = 0;
        const auto number = std::stoll(value, &parsed);
        if (parsed != value.size()) return false;
        *result = static_cast<intptr_t>(number);
        return true;
    } catch (...) {
        return false;
    }
}

DWORD window_process_id(const std::string& source_id, const std::string& source_type) {
    if (source_type != "window" && source_type != "application") return 0;
    intptr_t raw_window = 0;
    if (!parse_source_id(source_id, &raw_window) || raw_window == 0) return 0;
    if (source_type == "application") {
        const DWORD process_id = static_cast<DWORD>(raw_window);
        if (static_cast<intptr_t>(process_id) != raw_window ||
            process_id == GetCurrentProcessId()) return 0;
        HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, process_id);
        if (!process) return 0;
        DWORD exit_code = 0;
        const BOOL active = GetExitCodeProcess(process, &exit_code) &&
            exit_code == STILL_ACTIVE;
        CloseHandle(process);
        return active ? process_id : 0;
    }
    const HWND window = reinterpret_cast<HWND>(raw_window);
    if (!IsWindow(window)) return 0;
    DWORD process_id = 0;
    GetWindowThreadProcessId(window, &process_id);
    return process_id;
}

bool is_current_process_window(intptr_t source_id) {
    const HWND window = reinterpret_cast<HWND>(source_id);
    if (!IsWindow(window)) return false;
    DWORD process_id = 0;
    GetWindowThreadProcessId(window, &process_id);
    return process_id != 0 && process_id == GetCurrentProcessId();
}


std::string process_friendly_name(DWORD process_id, const std::string& fallback) {
    HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, process_id);
    if (!process) return fallback;
    WCHAR path[MAX_PATH]{};
    DWORD length = static_cast<DWORD>(std::size(path));
    const BOOL resolved = QueryFullProcessImageNameW(process, 0, path, &length);
    CloseHandle(process);
    if (!resolved || length == 0) return fallback;
    std::wstring value(path, length);
    const size_t separator = value.find_last_of(L"\\/");
    if (separator != std::wstring::npos) value.erase(0, separator + 1);
    const std::string result = wide_to_utf8(value.c_str());
    return result.empty() ? fallback : result;
}

RECT window_bounds(HWND window) {
    RECT bounds{};
    if (FAILED(DwmGetWindowAttribute(window, DWMWA_EXTENDED_FRAME_BOUNDS,
                                     &bounds, sizeof(bounds))) &&
        !GetWindowRect(window, &bounds))
        return {};
    return bounds;
}


std::vector<HMONITOR> display_monitors() {
    std::vector<HMONITOR> monitors;
    EnumDisplayMonitors(nullptr, nullptr,
                        [](HMONITOR monitor, HDC, LPRECT, LPARAM value) -> BOOL {
                            auto* monitors = reinterpret_cast<std::vector<HMONITOR>*>(value);
                            monitors->push_back(monitor);
                            return TRUE;
                        },
                        reinterpret_cast<LPARAM>(&monitors));
    return monitors;
}

HMONITOR monitor_from_source_id(intptr_t source_id) {
    const HMONITOR monitor = reinterpret_cast<HMONITOR>(source_id);
    const auto monitors = display_monitors();
    return std::find(monitors.begin(), monitors.end(), monitor) != monitors.end()
        ? monitor
        : nullptr;
}

RECT monitor_bounds(HMONITOR monitor) {
    MONITORINFO info{};
    info.cbSize = sizeof(info);
    return monitor && GetMonitorInfoW(monitor, &info) ? info.rcMonitor : RECT{};
}

std::string monitor_title(HMONITOR monitor) {
    MONITORINFOEXW info{};
    info.cbSize = sizeof(info);
    if (!monitor || !GetMonitorInfoW(monitor, &info)) return "Display";
    const std::string title = wide_to_utf8(info.szDevice);
    return title.empty() ? "Display" : title;
}

bool windows_graphics_capture_supported() {
    WinRtScope winrt;
    if (!winrt.usable()) return false;
    try {
        return GraphicsCaptureSession::IsSupported();
    } catch (...) {
        return false;
    }
}


bool audio_format_details(const WAVEFORMATEX* format,
                          bool& is_float,
                          uint16_t& channels,
                          uint32_t& sample_rate,
                          uint16_t& bits) {
    if (!format || format->nChannels == 0 || format->nSamplesPerSec == 0)
        return false;
    bool supported = format->wFormatTag == WAVE_FORMAT_IEEE_FLOAT ||
        format->wFormatTag == WAVE_FORMAT_PCM;
    is_float = format->wFormatTag == WAVE_FORMAT_IEEE_FLOAT;
    if (format->wFormatTag == WAVE_FORMAT_EXTENSIBLE &&
        format->cbSize >= sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX)) {
        const auto* extended = reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(format);
        is_float = IsEqualGUID(extended->SubFormat, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT);
        supported = is_float ||
            IsEqualGUID(extended->SubFormat, KSDATAFORMAT_SUBTYPE_PCM);
    }
    channels = format->nChannels;
    sample_rate = format->nSamplesPerSec;
    bits = format->wBitsPerSample;
    return supported &&
        (bits == 16 || bits == 24 || bits == 32);
}


}

#endif
