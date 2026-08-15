#include "PlatformCaptureWindowsInternal.hpp"

#if defined(_WIN32)

namespace dspeak_windows {

class WindowsGraphicsSurface {
public:
    WindowsGraphicsSurface(HWND window, HMONITOR monitor)
        : window_(window), monitor_(monitor) {}

    bool capture(std::vector<uint8_t>& pixels, int* width_out, int* height_out) {
        try {
            if (!ensure_capture()) return false;
            auto frame = frame_pool_.TryGetNextFrame();
            if (!frame) return false;
            const auto content_size = frame.ContentSize();
            if (content_size.Width <= 0 || content_size.Height <= 0) return false;
            if (content_size.Width != frame_size_.Width ||
                content_size.Height != frame_size_.Height) {
                frame_pool_.Recreate(
                    direct_device_, DirectXPixelFormat::B8G8R8A8UIntNormalized,
                    2, content_size);
                frame_size_ = content_size;
                return false;
            }
            auto access = frame.Surface().as<
                ::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
            ComPtr<ID3D11Texture2D> source;
            if (FAILED(access->GetInterface(
                    __uuidof(ID3D11Texture2D),
                    reinterpret_cast<void**>(source.GetAddressOf()))))
                return false;
            D3D11_TEXTURE2D_DESC source_description{};
            source->GetDesc(&source_description);
            if (source_description.Format != DXGI_FORMAT_B8G8R8A8_UNORM ||
                source_description.Width == 0 || source_description.Height == 0)
                return false;
            if (!ensure_staging(source_description)) return false;
            context_->CopyResource(staging_.Get(), source.Get());
            context_->Flush();
            D3D11_MAPPED_SUBRESOURCE mapped{};
            if (FAILED(context_->Map(staging_.Get(), 0, D3D11_MAP_READ, 0, &mapped)))
                return false;
            const size_t row_bytes = static_cast<size_t>(source_description.Width) * 4;
            pixels.resize(row_bytes * source_description.Height);
            for (UINT row = 0; row < source_description.Height; ++row) {
                std::memcpy(pixels.data() + static_cast<size_t>(row) * row_bytes,
                            static_cast<const uint8_t*>(mapped.pData) +
                                static_cast<size_t>(row) * mapped.RowPitch,
                            row_bytes);
            }
            context_->Unmap(staging_.Get(), 0);
            if (width_out) *width_out = static_cast<int>(source_description.Width);
            if (height_out) *height_out = static_cast<int>(source_description.Height);
            return true;
        } catch (...) {
            return false;
        }
    }

private:
    bool ensure_capture() {
        if (frame_pool_) return true;
        if (!windows_graphics_capture_supported()) return false;
        ComPtr<ID3D11Device> device;
        ComPtr<ID3D11DeviceContext> context;
        D3D_FEATURE_LEVEL feature_level{};
        const D3D_FEATURE_LEVEL feature_levels[] = {
            D3D_FEATURE_LEVEL_11_0,
            D3D_FEATURE_LEVEL_10_1,
            D3D_FEATURE_LEVEL_10_0,
        };
        HRESULT result = D3D11CreateDevice(
            nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr,
            D3D11_CREATE_DEVICE_BGRA_SUPPORT, feature_levels,
            static_cast<UINT>(std::size(feature_levels)), D3D11_SDK_VERSION,
            &device, &feature_level, &context);
        if (FAILED(result)) {
            result = D3D11CreateDevice(
                nullptr, D3D_DRIVER_TYPE_WARP, nullptr,
                D3D11_CREATE_DEVICE_BGRA_SUPPORT, feature_levels,
                static_cast<UINT>(std::size(feature_levels)), D3D11_SDK_VERSION,
                &device, &feature_level, &context);
        }
        if (FAILED(result)) return false;
        ComPtr<IDXGIDevice> dxgi_device;
        if (FAILED(device.As(&dxgi_device))) return false;
        winrt::com_ptr<IInspectable> inspectable_device;
        if (FAILED(CreateDirect3D11DeviceFromDXGIDevice(
                dxgi_device.Get(), inspectable_device.put())))
            return false;
        auto direct_device = inspectable_device.as<IDirect3DDevice>();
        auto interop_factory = winrt::get_activation_factory<
            GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
        GraphicsCaptureItem item{nullptr};
        if (window_) {
            result = interop_factory->CreateForWindow(
                window_, winrt::guid_of<GraphicsCaptureItem>(), winrt::put_abi(item));
        } else if (monitor_) {
            result = interop_factory->CreateForMonitor(
                monitor_, winrt::guid_of<GraphicsCaptureItem>(), winrt::put_abi(item));
        } else {
            return false;
        }
        if (FAILED(result) || !item) return false;
        const auto size = item.Size();
        if (size.Width <= 0 || size.Height <= 0) return false;
        auto frame_pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
            direct_device, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, size);
        auto session = frame_pool.CreateCaptureSession(item);
        session.IsCursorCaptureEnabled(true);
        session.IsBorderRequired(false);
        session.StartCapture();
        device_ = std::move(device);
        context_ = std::move(context);
        direct_device_ = std::move(direct_device);
        item_ = std::move(item);
        frame_pool_ = std::move(frame_pool);
        session_ = std::move(session);
        frame_size_ = size;
        return true;
    }

    bool ensure_staging(const D3D11_TEXTURE2D_DESC& source_description) {
        if (staging_ && staging_description_.Width == source_description.Width &&
            staging_description_.Height == source_description.Height &&
            staging_description_.Format == source_description.Format)
            return true;
        staging_description_ = source_description;
        staging_description_.Usage = D3D11_USAGE_STAGING;
        staging_description_.BindFlags = 0;
        staging_description_.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
        staging_description_.MiscFlags = 0;
        staging_.Reset();
        return SUCCEEDED(device_->CreateTexture2D(
            &staging_description_, nullptr, staging_.GetAddressOf()));
    }

    HWND window_ = nullptr;
    HMONITOR monitor_ = nullptr;
    ComPtr<ID3D11Device> device_;
    ComPtr<ID3D11DeviceContext> context_;
    IDirect3DDevice direct_device_{nullptr};
    GraphicsCaptureItem item_{nullptr};
    Direct3D11CaptureFramePool frame_pool_{nullptr};
    GraphicsCaptureSession session_{nullptr};
    winrt::Windows::Graphics::SizeInt32 frame_size_{};
    ComPtr<ID3D11Texture2D> staging_;
    D3D11_TEXTURE2D_DESC staging_description_{};
};

bool valid_window_bounds(const RECT& bounds) {
    return bounds.right > bounds.left && bounds.bottom > bounds.top;
}

bool is_window_cloaked(HWND window) {
    DWORD cloaked = 0;
    return SUCCEEDED(DwmGetWindowAttribute(
               window, DWMWA_CLOAKED, &cloaked, sizeof(cloaked))) &&
        cloaked != 0;
}

bool is_capture_window(HWND window) {
    if (!window || !IsWindowVisible(window) || is_window_cloaked(window))
        return false;
    const LONG_PTR extended_style = GetWindowLongPtr(window, GWL_EXSTYLE);
    return (extended_style & WS_EX_TOOLWINDOW) == 0 ||
        GetWindow(window, GW_OWNER) != nullptr;
}

std::vector<HWND> process_windows(DWORD process_id) {
    std::vector<HWND> windows;
    struct EnumerationContext {
        DWORD process_id;
        std::vector<HWND>* windows;
    } context{process_id, &windows};
    EnumWindows([](HWND window, LPARAM value) -> BOOL {
        auto* context = reinterpret_cast<EnumerationContext*>(value);
        DWORD owner = 0;
        GetWindowThreadProcessId(window, &owner);
        if (owner != context->process_id || !is_capture_window(window))
            return TRUE;
        const RECT bounds = window_bounds(window);
        if (valid_window_bounds(bounds)) context->windows->push_back(window);
        return TRUE;
    }, reinterpret_cast<LPARAM>(&context));
    return windows;
}

std::vector<HWND> all_capture_windows() {
    std::vector<HWND> windows;
    EnumWindows([](HWND window, LPARAM value) -> BOOL {
        auto* windows = reinterpret_cast<std::vector<HWND>*>(value);
        if (!is_capture_window(window))
            return TRUE;
        DWORD process_id = 0;
        GetWindowThreadProcessId(window, &process_id);
        if (process_id == 0 || process_id == GetCurrentProcessId()) return TRUE;
        if (valid_window_bounds(window_bounds(window))) windows->push_back(window);
        return TRUE;
    }, reinterpret_cast<LPARAM>(&windows));
    return windows;
}

void copy_scaled_bgra(const std::vector<uint8_t>& source,
                      int source_width,
                      int source_height,
                      webrtc::BasicDesktopFrame* destination,
                      int destination_x,
                      int destination_y,
                      int destination_width,
                      int destination_height) {
    if (!destination || source_width <= 0 || source_height <= 0 ||
        destination_width <= 0 || destination_height <= 0)
        return;
    const int canvas_width = destination->size().width();
    const int canvas_height = destination->size().height();
    for (int row = 0; row < destination_height; ++row) {
        const int y = destination_y + row;
        if (y < 0 || y >= canvas_height) continue;
        const int source_y = std::min(
            source_height - 1,
            static_cast<int>(static_cast<int64_t>(row) * source_height /
                             destination_height));
        for (int column = 0; column < destination_width; ++column) {
            const int x = destination_x + column;
            if (x < 0 || x >= canvas_width) continue;
            const int source_x = std::min(
                source_width - 1,
                static_cast<int>(static_cast<int64_t>(column) * source_width /
                                 destination_width));
            const auto* source_pixel = source.data() +
                (static_cast<size_t>(source_y) * source_width + source_x) * 4;
            auto* destination_pixel = destination->data() +
                static_cast<size_t>(y) * destination->stride() + x * 4;
            std::memcpy(destination_pixel, source_pixel, 4);
        }
    }
}

void blank_current_process_windows(webrtc::BasicDesktopFrame* frame) {
    if (!frame) return;
    const auto& size = frame->size();
    const RECT frame_bounds{
        frame->top_left().x(),
        frame->top_left().y(),
        frame->top_left().x() + size.width(),
        frame->top_left().y() + size.height(),
    };
    for (const HWND window : process_windows(GetCurrentProcessId())) {
        const RECT window_rect = window_bounds(window);
        RECT intersection{};
        if (!IntersectRect(&intersection, &frame_bounds, &window_rect)) continue;
        const int left = intersection.left - frame_bounds.left;
        const int top = intersection.top - frame_bounds.top;
        const int width = intersection.right - intersection.left;
        const int height = intersection.bottom - intersection.top;
        for (int row = 0; row < height; ++row) {
            std::memset(frame->data() +
                            static_cast<size_t>(top + row) * frame->stride() + left * 4,
                        0,
                        static_cast<size_t>(width) * 4);
        }
    }
}

class WindowsGraphicsCapturer final : public webrtc::DesktopCapturer {
public:
    enum class TargetType { kDisplay, kWindow };

    WindowsGraphicsCapturer(TargetType target_type, intptr_t source_id)
        : target_type_(target_type), source_id_(source_id),
          surface_(target_type == TargetType::kWindow
                       ? reinterpret_cast<HWND>(source_id)
                       : nullptr,
                   target_type == TargetType::kDisplay
                       ? reinterpret_cast<HMONITOR>(source_id)
                       : nullptr) {}

    void Start(Callback* callback) override { callback_ = callback; }

    void CaptureFrame() override {
        if (!callback_) return;
        callback_->OnFrameCaptureStart();
        WinRtScope winrt;
        if (!winrt.usable()) {
            callback_->OnCaptureResult(Result::ERROR_PERMANENT, nullptr);
            return;
        }
        std::vector<uint8_t> pixels;
        int width = 0;
        int height = 0;
        if (!surface_.capture(pixels, &width, &height) || width <= 0 || height <= 0) {
            callback_->OnCaptureResult(Result::ERROR_TEMPORARY, nullptr);
            return;
        }
        auto frame = std::make_unique<webrtc::BasicDesktopFrame>(
            webrtc::DesktopSize(width, height));
        const RECT bounds = bounds_for_target();
        frame->set_top_left(webrtc::DesktopVector(bounds.left, bounds.top));
        copy_scaled_bgra(pixels, width, height, frame.get(), 0, 0, width, height);
        if (target_type_ == TargetType::kDisplay)
            blank_current_process_windows(frame.get());
        callback_->OnCaptureResult(Result::SUCCESS, std::move(frame));
    }

    bool GetSourceList(SourceList* sources) override {
        if (!sources) return false;
        sources->clear();
        const RECT bounds = bounds_for_target();
        if (!valid_window_bounds(bounds)) return false;
        sources->push_back({static_cast<SourceId>(source_id_), source_title(),
                            static_cast<int64_t>(source_id_)});
        return true;
    }

    bool SelectSource(SourceId source_id) override {
        return static_cast<intptr_t>(source_id) == source_id_;
    }

private:
    RECT bounds_for_target() const {
        if (target_type_ == TargetType::kDisplay)
            return monitor_bounds(reinterpret_cast<HMONITOR>(source_id_));
        return window_bounds(reinterpret_cast<HWND>(source_id_));
    }

    std::string source_title() const {
        if (target_type_ == TargetType::kDisplay)
            return monitor_title(reinterpret_cast<HMONITOR>(source_id_));
        WCHAR title[512]{};
        const int length = GetWindowTextW(reinterpret_cast<HWND>(source_id_), title,
                                          static_cast<int>(std::size(title)));
        return length > 0 ? wide_to_utf8(title) : "Window";
    }

    TargetType target_type_;
    intptr_t source_id_ = 0;
    WindowsGraphicsSurface surface_;
    Callback* callback_ = nullptr;
};

class WindowsGraphicsApplicationCapturer final : public webrtc::DesktopCapturer {
public:
    explicit WindowsGraphicsApplicationCapturer(DWORD process_id)
        : process_id_(process_id) {}

    void Start(Callback* callback) override { callback_ = callback; }

    void CaptureFrame() override {
        if (!callback_) return;
        callback_->OnFrameCaptureStart();
        WinRtScope winrt;
        if (!winrt.usable()) {
            callback_->OnCaptureResult(Result::ERROR_PERMANENT, nullptr);
            return;
        }
        const std::vector<HWND> windows = process_windows(process_id_);
        if (windows.empty()) {
            callback_->OnCaptureResult(Result::ERROR_TEMPORARY, nullptr);
            return;
        }
        RECT union_bounds{};
        bool has_bounds = false;
        for (const HWND window : windows) {
            const RECT bounds = window_bounds(window);
            if (!valid_window_bounds(bounds)) continue;
            if (!has_bounds) {
                union_bounds = bounds;
                has_bounds = true;
            } else {
                union_bounds.left = std::min(union_bounds.left, bounds.left);
                union_bounds.top = std::min(union_bounds.top, bounds.top);
                union_bounds.right = std::max(union_bounds.right, bounds.right);
                union_bounds.bottom = std::max(union_bounds.bottom, bounds.bottom);
            }
        }
        if (!has_bounds) {
            callback_->OnCaptureResult(Result::ERROR_TEMPORARY, nullptr);
            return;
        }
        const int width = union_bounds.right - union_bounds.left;
        const int height = union_bounds.bottom - union_bounds.top;
        if (width <= 0 || height <= 0 || width > 8192 || height > 8192 ||
            static_cast<size_t>(width) * height > 8192u * 8192u) {
            callback_->OnCaptureResult(Result::ERROR_PERMANENT, nullptr);
            return;
        }
        auto frame = std::make_unique<webrtc::BasicDesktopFrame>(
            webrtc::DesktopSize(width, height));
        std::memset(frame->data(), 0,
                    static_cast<size_t>(frame->stride()) * height);
        frame->set_top_left(webrtc::DesktopVector(union_bounds.left,
                                                   union_bounds.top));
        std::set<HWND> live_windows(windows.begin(), windows.end());
        bool captured = false;
        for (auto window_it = windows.rbegin(); window_it != windows.rend(); ++window_it) {
            const HWND window = *window_it;
            const RECT bounds = window_bounds(window);
            if (!valid_window_bounds(bounds)) continue;
            auto& surface = surfaces_[window];
            if (!surface)
                surface = std::make_unique<WindowsGraphicsSurface>(window, nullptr);
            std::vector<uint8_t> pixels;
            int source_width = 0;
            int source_height = 0;
            if (!surface->capture(pixels, &source_width, &source_height)) continue;
            copy_scaled_bgra(
                pixels, source_width, source_height, frame.get(),
                bounds.left - union_bounds.left, bounds.top - union_bounds.top,
                bounds.right - bounds.left, bounds.bottom - bounds.top);
            captured = true;
        }
        for (auto surface_it = surfaces_.begin(); surface_it != surfaces_.end();) {
            if (live_windows.contains(surface_it->first)) {
                ++surface_it;
            } else {
                surface_it = surfaces_.erase(surface_it);
            }
        }
        callback_->OnCaptureResult(
            captured ? Result::SUCCESS : Result::ERROR_TEMPORARY,
            captured ? std::move(frame) : nullptr);
    }

    bool GetSourceList(SourceList* sources) override {
        if (!sources) return false;
        sources->clear();
        if (process_windows(process_id_).empty()) return false;
        sources->push_back({static_cast<SourceId>(process_id_),
                            process_friendly_name(process_id_, "Application"), 0});
        return true;
    }

    bool SelectSource(SourceId source_id) override {
        return static_cast<DWORD>(source_id) == process_id_;
    }

private:
    DWORD process_id_ = 0;
    std::map<HWND, std::unique_ptr<WindowsGraphicsSurface>> surfaces_;
    Callback* callback_ = nullptr;
};

bool valid_capture_source(const std::string& source_id,
                          const std::string& source_type) {
    if (source_type == "system-audio")
        return windows_process_loopback_supported() &&
            endpoint_exists(eRender) && source_id == "windows:system-audio";
    if (source_type == "display") {
        intptr_t raw_monitor = 0;
        return parse_source_id(source_id, &raw_monitor) && raw_monitor != 0 &&
            monitor_from_source_id(raw_monitor) != nullptr;
    }
    if (source_type == "window") {
        intptr_t raw_window = 0;
        return parse_source_id(source_id, &raw_window) && raw_window != 0 &&
            IsWindow(reinterpret_cast<HWND>(raw_window)) &&
            is_capture_window(reinterpret_cast<HWND>(raw_window)) &&
            valid_window_bounds(window_bounds(reinterpret_cast<HWND>(raw_window))) &&
            !is_current_process_window(raw_window);
    }
    if (source_type == "application") {
        const DWORD process_id = window_process_id(source_id, source_type);
        return process_id != 0 && !process_windows(process_id).empty();
    }
    return false;
}

bool append_desktop_sources(json& result,
                            bool windows,
                            bool audio_available) {
    (void)windows;
    ComScope com;
    if (!com.usable()) return false;
    WinRtScope winrt;
    if (!winrt.usable() || !windows_graphics_capture_supported()) return false;

    auto append_source = [&](const std::string& source_id,
                             const char* source_type,
                             const std::string& title,
                             const std::string& app_name,
                             const std::string& app_id,
                             int64_t display_id,
                             const RECT& bounds) {
        result.push_back({
            {"sourceId", source_id},
            {"sourceType", source_type},
            {"sourceKey", std::string(source_type) + ":" + source_id},
            {"title", title.empty() ? std::string(source_type) : title},
            {"appName", app_name},
            {"appId", app_id},
            {"selfExcluded", true},
            {"available", true},
            {"displayId", decimal_source_id(static_cast<intptr_t>(display_id))},
            {"bounds", {
                {"x", bounds.left},
                {"y", bounds.top},
                {"width", std::max(0L, bounds.right - bounds.left)},
                {"height", std::max(0L, bounds.bottom - bounds.top)},
            }},
            {"capabilities", {
                {"video", true},
                {"audio", audio_available},
                {"stereo", audio_available},
                {"channels", audio_available ? 2 : 0},
                {"sampleRate", audio_available ? 48000 : 0},
            }},
        });
    };

    for (const HMONITOR monitor : display_monitors()) {
        const RECT bounds = monitor_bounds(monitor);
        if (!valid_window_bounds(bounds)) continue;
        const auto monitor_id = static_cast<int64_t>(reinterpret_cast<intptr_t>(monitor));
        append_source(
            "windows:display:" + decimal_source_id(static_cast<intptr_t>(monitor_id)),
            "display", monitor_title(monitor), {}, {}, monitor_id, bounds);
    }

    std::map<DWORD, ApplicationSourceInfo> applications;
    for (const HWND window : all_capture_windows()) {
        const RECT bounds = window_bounds(window);
        if (!valid_window_bounds(bounds)) continue;
        WCHAR raw_title[512]{};
        const int title_length = GetWindowTextW(
            window, raw_title, static_cast<int>(std::size(raw_title)));
        const std::string title = title_length > 0
            ? wide_to_utf8(raw_title)
            : "Untitled window";
        const HMONITOR monitor = MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST);
        const auto monitor_id = static_cast<int64_t>(reinterpret_cast<intptr_t>(monitor));
        const std::string window_id = decimal_source_id(
            reinterpret_cast<intptr_t>(window));
        append_source("windows:window:" + window_id, "window", title, {}, {},
                      monitor_id, bounds);

        DWORD process_id = 0;
        GetWindowThreadProcessId(window, &process_id);
        if (process_id == 0) continue;
        auto& application = applications[process_id];
        application.process_id = process_id;
        if (application.title.empty()) application.title = title;
        if (application.display_id == 0) application.display_id = monitor_id;
        if (!valid_window_bounds(application.bounds)) {
            application.bounds = bounds;
        } else {
            application.bounds.left = std::min(application.bounds.left, bounds.left);
            application.bounds.top = std::min(application.bounds.top, bounds.top);
            application.bounds.right = std::max(application.bounds.right, bounds.right);
            application.bounds.bottom = std::max(application.bounds.bottom, bounds.bottom);
        }
    }

    for (const auto& [process_id, application] : applications) {
        const std::string title = process_friendly_name(process_id, application.title);
        append_source(
            "windows:application:" + std::to_string(process_id),
            "application", title, title, std::to_string(process_id),
            application.display_id, application.bounds);
    }
    return true;
}


std::unique_ptr<webrtc::DesktopCapturer> create_desktop_capturer(
    const std::string& source_type,
    const std::string& source_id) {
    if (source_type == "application") {
        intptr_t process_id = 0;
        if (!parse_source_id(source_id, &process_id) || process_id <= 0 ||
            process_id > static_cast<intptr_t>(UINT32_MAX)) return nullptr;
        const DWORD value = static_cast<DWORD>(process_id);
        if (value == GetCurrentProcessId() || process_windows(value).empty())
            return nullptr;
        return std::make_unique<WindowsGraphicsApplicationCapturer>(value);
    }
    if (source_type == "window") {
        intptr_t raw_window = 0;
        if (!parse_source_id(source_id, &raw_window) || raw_window == 0)
            return nullptr;
        const HWND window = reinterpret_cast<HWND>(raw_window);
        if (!IsWindow(window) || is_current_process_window(raw_window)) return nullptr;
        return std::make_unique<WindowsGraphicsCapturer>(
            WindowsGraphicsCapturer::TargetType::kWindow, raw_window);
    }
    if (source_type == "display") {
        intptr_t raw_monitor = 0;
        if (!parse_source_id(source_id, &raw_monitor) || raw_monitor == 0 ||
            !monitor_from_source_id(raw_monitor)) return nullptr;
        return std::make_unique<WindowsGraphicsCapturer>(
            WindowsGraphicsCapturer::TargetType::kDisplay, raw_monitor);
    }
    return nullptr;
}

json list_desktop_sources() {
    json sources = json::array();
    const bool audio_available = windows_process_loopback_supported() &&
        endpoint_exists(eRender);
    append_desktop_sources(sources, true, audio_available);
    if (audio_available) {
        sources.push_back({
            {"sourceId", "windows:system-audio"},
            {"sourceType", "system-audio"},
            {"sourceKey", "system-audio:windows:system-audio"},
            {"title", "System audio"},
            {"selfExcluded", true},
            {"available", true},
            {"capabilities", {
                {"video", false},
                {"audio", true},
                {"stereo", true},
                {"channels", 2},
                {"sampleRate", 48000},
            }},
        });
    }
    return sources;
}

}

#endif
