#include "../../libdspeak_media/src/internal/video_surface.hpp"

#if defined(_WIN32)

#define NOMINMAX
#include <windows.h>
#include <d3d11.h>
#include <d3dcompiler.h>
#include <dxgi.h>
#include <wrl/client.h>

#include <third_party/libyuv/include/libyuv/convert_from.h>

#include <condition_variable>
#include <deque>
#include <future>
#include <functional>
#include <algorithm>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace {

using Microsoft::WRL::ComPtr;

constexpr UINT kSurfaceMessage = WM_APP + 17;
const wchar_t* kSurfaceClass = L"dSpeakNativeVideoSurface";

struct NativeSurface {
    HWND window = nullptr;
    ComPtr<ID3D11Device> device;
    ComPtr<ID3D11DeviceContext> context;
    ComPtr<IDXGISwapChain> swap_chain;
    ComPtr<ID3D11RenderTargetView> render_target;
    ComPtr<ID3D11Texture2D> frame_texture;
    ComPtr<ID3D11ShaderResourceView> frame_view;
    ComPtr<ID3D11VertexShader> vertex_shader;
    ComPtr<ID3D11PixelShader> pixel_shader;
    ComPtr<ID3D11SamplerState> sampler;
    std::vector<uint8_t> pending_pixels;
    int pending_width = 0;
    int pending_height = 0;
    int texture_width = 0;
    int texture_height = 0;
    int swap_width = 0;
    int swap_height = 0;
    bool visible = false;
    bool upload_scheduled = false;
    std::mutex mutex;
};

std::mutex g_surface_mutex;
std::map<std::string, std::shared_ptr<NativeSurface>> g_surfaces;
std::mutex g_ui_mutex;
std::condition_variable g_ui_ready;
std::deque<std::function<void()>> g_ui_tasks;
DWORD g_ui_thread_id = 0;
bool g_ui_stop = false;

void run_ui_tasks() {
    std::deque<std::function<void()>> tasks;
    {
        std::lock_guard<std::mutex> lock(g_ui_mutex);
        tasks.swap(g_ui_tasks);
    }
    for (auto& task : tasks) task();
}

template <typename Function>
void run_on_ui(Function&& function, bool wait) {
    DWORD current_ui_thread_id = 0;
    {
        std::lock_guard<std::mutex> lock(g_ui_mutex);
        current_ui_thread_id = g_ui_thread_id;
    }
    if (GetCurrentThreadId() == current_ui_thread_id) {
        function();
        return;
    }
    DWORD thread_id = 0;
    {
        std::unique_lock<std::mutex> lock(g_ui_mutex);
        g_ui_ready.wait(lock, [] { return g_ui_thread_id != 0 || g_ui_stop; });
        thread_id = g_ui_thread_id;
        if (g_ui_stop || !thread_id) return;
        if (!wait) {
            g_ui_tasks.emplace_back(std::forward<Function>(function));
            if (!PostThreadMessageW(thread_id, kSurfaceMessage, 0, 0))
                g_ui_tasks.pop_back();
            return;
        } else {
            auto done = std::make_shared<std::promise<void>>();
            auto future = done->get_future();
            g_ui_tasks.emplace_back([task = std::forward<Function>(function), done] {
                task();
                done->set_value();
            });
            if (!PostThreadMessageW(thread_id, kSurfaceMessage, 0, 0)) {
                g_ui_tasks.pop_back();
                return;
            }
            lock.unlock();
            future.wait();
            return;
        }
    }
}

void ensure_class() {
    static std::once_flag once;
    std::call_once(once, [] {
        WNDCLASSW klass{};
        klass.lpfnWndProc = [](HWND window, UINT message, WPARAM wparam, LPARAM lparam) -> LRESULT {
            auto* surface = reinterpret_cast<NativeSurface*>(GetWindowLongPtrW(window, GWLP_USERDATA));
            if (message == WM_NCCREATE) {
                const auto* create = reinterpret_cast<const CREATESTRUCTW*>(lparam);
                surface = static_cast<NativeSurface*>(create->lpCreateParams);
                SetWindowLongPtrW(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(surface));
            }
            if (message == WM_ERASEBKGND) return 1;
            if (message == WM_NCHITTEST) return HTTRANSPARENT;
            if (message == WM_PAINT) {
                PAINTSTRUCT paint{};
                BeginPaint(window, &paint);
                EndPaint(window, &paint);
                return 0;
            }
            if (message == WM_DESTROY && surface) {
                std::lock_guard<std::mutex> lock(surface->mutex);
                surface->visible = false;
            }
            return DefWindowProcW(window, message, wparam, lparam);
        };
        klass.hInstance = GetModuleHandleW(nullptr);
        klass.lpszClassName = kSurfaceClass;
        klass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
        RegisterClassW(&klass);
    });
}

std::shared_ptr<NativeSurface> ensure_surface(const char* surface_id) {
    if (!surface_id || !*surface_id) return nullptr;
    auto it = g_surfaces.find(surface_id);
    if (it != g_surfaces.end()) return it->second;
    auto surface = std::make_shared<NativeSurface>();
    ensure_class();
    surface->window = CreateWindowExW(
        WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
        kSurfaceClass,
        L"",
        WS_POPUP | WS_CLIPSIBLINGS | WS_CLIPCHILDREN,
        0,
        0,
        1,
        1,
        nullptr,
        nullptr,
        GetModuleHandleW(nullptr),
        surface.get());
    if (!surface->window) return nullptr;
    g_surfaces.emplace(surface_id, surface);
    return surface;
}

bool create_graphics(NativeSurface& surface) {
    if (surface.swap_chain) return true;
    DXGI_SWAP_CHAIN_DESC swap_desc{};
    swap_desc.BufferCount = 2;
    swap_desc.BufferDesc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    swap_desc.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
    swap_desc.OutputWindow = surface.window;
    swap_desc.SampleDesc.Count = 1;
    swap_desc.Windowed = TRUE;
    swap_desc.SwapEffect = DXGI_SWAP_EFFECT_DISCARD;
    D3D_FEATURE_LEVEL feature_level{};
    const auto create = [&](D3D_DRIVER_TYPE driver) {
        return D3D11CreateDeviceAndSwapChain(
            nullptr,
            driver,
            nullptr,
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            nullptr,
            0,
            D3D11_SDK_VERSION,
            &swap_desc,
            &surface.swap_chain,
            &surface.device,
            &feature_level,
            &surface.context);
    };
    HRESULT result = create(D3D_DRIVER_TYPE_HARDWARE);
    if (FAILED(result)) {
        surface.swap_chain.Reset();
        surface.device.Reset();
        surface.context.Reset();
        result = create(D3D_DRIVER_TYPE_WARP);
    }
    if (FAILED(result)) return false;
    ComPtr<ID3D11Multithread> multithread;
    if (SUCCEEDED(surface.context.As(&multithread))) multithread->SetMultithreadProtected(TRUE);
    return true;
}

bool create_render_target(NativeSurface& surface, int width, int height) {
    if (!create_graphics(surface)) return false;
    if (surface.swap_width == width && surface.swap_height == height && surface.render_target)
        return true;
    surface.render_target.Reset();
    if (FAILED(surface.swap_chain->ResizeBuffers(0,
                                                 static_cast<UINT>(width),
                                                 static_cast<UINT>(height),
                                                 DXGI_FORMAT_UNKNOWN,
                                                 0)))
        return false;
    ComPtr<ID3D11Texture2D> back_buffer;
    if (FAILED(surface.swap_chain->GetBuffer(0,
                                             IID_PPV_ARGS(&back_buffer))))
        return false;
    if (FAILED(surface.device->CreateRenderTargetView(
            back_buffer.Get(), nullptr, &surface.render_target)))
        return false;
    surface.swap_width = width;
    surface.swap_height = height;
    return true;
}

bool create_shaders(NativeSurface& surface) {
    if (surface.vertex_shader && surface.pixel_shader && surface.sampler) return true;
    static const char vertex_source[] =
        "struct Out{float4 position:SV_Position;float2 uv:TEXCOORD0;};"
        "Out main(uint id:SV_VertexID){float2 p[3]={float2(-1,-1),float2(-1,3),float2(3,-1)};"
        "Out o;o.position=float4(p[id],0,1);o.uv=float2((p[id].x+1)*0.5,1-(p[id].y+1)*0.5);return o;}";
    static const char pixel_source[] =
        "Texture2D frameTexture:register(t0);SamplerState frameSampler:register(s0);"
        "float4 main(float4 position:SV_Position,float2 uv:TEXCOORD0):SV_Target{"
        "return frameTexture.Sample(frameSampler,uv);}";
    ComPtr<ID3DBlob> vertex_blob;
    ComPtr<ID3DBlob> pixel_blob;
    ComPtr<ID3DBlob> error_blob;
    if (FAILED(D3DCompile(vertex_source,
                          sizeof(vertex_source) - 1,
                          nullptr,
                          nullptr,
                          nullptr,
                          "main",
                          "vs_4_0",
                          0,
                          0,
                          &vertex_blob,
                          &error_blob)))
        return false;
    error_blob.Reset();
    if (FAILED(D3DCompile(pixel_source,
                          sizeof(pixel_source) - 1,
                          nullptr,
                          nullptr,
                          nullptr,
                          "main",
                          "ps_4_0",
                          0,
                          0,
                          &pixel_blob,
                          &error_blob)))
        return false;
    if (FAILED(surface.device->CreateVertexShader(vertex_blob->GetBufferPointer(),
                                                  vertex_blob->GetBufferSize(),
                                                  nullptr,
                                                  &surface.vertex_shader)))
        return false;
    if (FAILED(surface.device->CreatePixelShader(pixel_blob->GetBufferPointer(),
                                                 pixel_blob->GetBufferSize(),
                                                 nullptr,
                                                 &surface.pixel_shader)))
        return false;
    D3D11_SAMPLER_DESC sampler_desc{};
    sampler_desc.Filter = D3D11_FILTER_MIN_MAG_MIP_LINEAR;
    sampler_desc.AddressU = D3D11_TEXTURE_ADDRESS_CLAMP;
    sampler_desc.AddressV = D3D11_TEXTURE_ADDRESS_CLAMP;
    sampler_desc.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP;
    if (FAILED(surface.device->CreateSamplerState(&sampler_desc, &surface.sampler))) return false;
    return true;
}

bool ensure_frame_texture(NativeSurface& surface, int width, int height) {
    if (surface.frame_texture && surface.texture_width == width && surface.texture_height == height)
        return true;
    surface.frame_view.Reset();
    surface.frame_texture.Reset();
    D3D11_TEXTURE2D_DESC texture_desc{};
    texture_desc.Width = static_cast<UINT>(width);
    texture_desc.Height = static_cast<UINT>(height);
    texture_desc.MipLevels = 1;
    texture_desc.ArraySize = 1;
    texture_desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    texture_desc.SampleDesc.Count = 1;
    texture_desc.Usage = D3D11_USAGE_DEFAULT;
    texture_desc.BindFlags = D3D11_BIND_SHADER_RESOURCE;
    if (FAILED(surface.device->CreateTexture2D(&texture_desc, nullptr, &surface.frame_texture)))
        return false;
    if (FAILED(surface.device->CreateShaderResourceView(
            surface.frame_texture.Get(), nullptr, &surface.frame_view)))
        return false;
    surface.texture_width = width;
    surface.texture_height = height;
    return true;
}

void present_surface(const std::shared_ptr<NativeSurface>& surface) {
    std::vector<uint8_t> pixels;
    int width = 0;
    int height = 0;
    {
        std::lock_guard<std::mutex> lock(surface->mutex);
        surface->upload_scheduled = false;
        if (!surface->visible || surface->pending_pixels.empty()) return;
        pixels.swap(surface->pending_pixels);
        width = surface->pending_width;
        height = surface->pending_height;
    }
    RECT client{};
    GetClientRect(surface->window, &client);
    const int swap_width = std::max(1L, client.right - client.left);
    const int swap_height = std::max(1L, client.bottom - client.top);
    if (!create_render_target(*surface, swap_width, swap_height) ||
        !create_shaders(*surface) ||
        !ensure_frame_texture(*surface, width, height))
        return;
    surface->context->UpdateSubresource(surface->frame_texture.Get(),
                                        0,
                                        nullptr,
                                        pixels.data(),
                                        static_cast<UINT>(width * 4),
                                        0);
    const float clear_color[] = {0.0f, 0.0f, 0.0f, 1.0f};
    surface->context->OMSetRenderTargets(1, surface->render_target.GetAddressOf(), nullptr);
    surface->context->ClearRenderTargetView(surface->render_target.Get(), clear_color);
    D3D11_VIEWPORT viewport{};
    viewport.Width = static_cast<float>(surface->swap_width);
    viewport.Height = static_cast<float>(surface->swap_height);
    viewport.MaxDepth = 1.0f;
    surface->context->RSSetViewports(1, &viewport);
    surface->context->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
    surface->context->VSSetShader(surface->vertex_shader.Get(), nullptr, 0);
    surface->context->PSSetShader(surface->pixel_shader.Get(), nullptr, 0);
    surface->context->PSSetShaderResources(0, 1, surface->frame_view.GetAddressOf());
    surface->context->PSSetSamplers(0, 1, surface->sampler.GetAddressOf());
    surface->context->Draw(3, 0);
    surface->swap_chain->Present(1, 0);
    bool schedule_again = false;
    {
        std::lock_guard<std::mutex> lock(surface->mutex);
        if (surface->visible && !surface->pending_pixels.empty() && !surface->upload_scheduled) {
            surface->upload_scheduled = true;
            schedule_again = true;
        }
    }
    if (schedule_again)
        run_on_ui([surface] { present_surface(surface); }, false);
}

}

namespace dspeak_media_video_surface_platform {

bool is_visible(const char* surface_id) {
    if (!surface_id || !*surface_id) return false;
    std::shared_ptr<NativeSurface> surface;
    {
        std::lock_guard<std::mutex> lock(g_surface_mutex);
        const auto it = g_surfaces.find(surface_id);
        if (it == g_surfaces.end()) return false;
        surface = it->second;
    }
    std::lock_guard<std::mutex> lock(surface->mutex);
    return surface->visible;
}

int set_bounds(const char* surface_id,
               int x,
               int y,
               int width,
               int height,
               bool visible) {
    if (!surface_id || width <= 0 || height <= 0) return -1;
    const std::string key(surface_id);
    int result = -1;
    run_on_ui([&] {
        std::lock_guard<std::mutex> registry_lock(g_surface_mutex);
        auto surface = ensure_surface(key.c_str());
        if (!surface) return;
        SetWindowPos(surface->window,
                     HWND_TOP,
                     x,
                     y,
                     width,
                     height,
                     SWP_NOACTIVATE | (visible ? SWP_SHOWWINDOW : SWP_HIDEWINDOW));
        {
            std::lock_guard<std::mutex> lock(surface->mutex);
            surface->visible = visible;
        }
        if (visible) ShowWindow(surface->window, SW_SHOWNOACTIVATE);
        result = 0;
    }, true);
    return result;
}

int destroy(const char* surface_id) {
    if (!surface_id) return -1;
    const std::string key(surface_id);
    run_on_ui([&] {
        std::lock_guard<std::mutex> registry_lock(g_surface_mutex);
        const auto it = g_surfaces.find(key);
        if (it == g_surfaces.end()) return;
        {
            std::lock_guard<std::mutex> lock(it->second->mutex);
            it->second->visible = false;
        }
        DestroyWindow(it->second->window);
        g_surfaces.erase(it);
    }, true);
    return 0;
}

void render(const char* surface_id, const webrtc::VideoFrame& frame) {
    if (!surface_id || !*surface_id) return;
    std::shared_ptr<NativeSurface> surface;
    {
        std::lock_guard<std::mutex> lock(g_surface_mutex);
        const auto it = g_surfaces.find(surface_id);
        if (it == g_surfaces.end()) return;
        surface = it->second;
    }
    {
        std::lock_guard<std::mutex> lock(surface->mutex);
        if (!surface->visible) return;
    }
    const auto input = frame.video_frame_buffer()->ToI420();
    if (!input) return;
    const int width = input->width();
    const int height = input->height();
    if (width <= 0 || height <= 0) return;
    std::vector<uint8_t> pixels(static_cast<size_t>(width) * height * 4);
    if (libyuv::I420ToARGB(input->DataY(), input->StrideY(),
                           input->DataU(), input->StrideU(),
                           input->DataV(), input->StrideV(),
                           pixels.data(), width * 4,
                           width, height) != 0)
        return;
    bool schedule = false;
    {
        std::lock_guard<std::mutex> lock(surface->mutex);
        if (!surface->visible) return;
        surface->pending_pixels = std::move(pixels);
        surface->pending_width = width;
        surface->pending_height = height;
        if (!surface->upload_scheduled) {
            surface->upload_scheduled = true;
            schedule = true;
        }
    }
    if (schedule)
        run_on_ui([surface] { present_surface(surface); }, false);
}

void clear() {
    run_on_ui([] {
        std::lock_guard<std::mutex> registry_lock(g_surface_mutex);
        for (auto& [key, surface] : g_surfaces) {
            std::lock_guard<std::mutex> lock(surface->mutex);
            surface->visible = false;
            DestroyWindow(surface->window);
        }
        g_surfaces.clear();
    }, true);
}

void run_loop() {
    MSG message{};
    PeekMessageW(&message, nullptr, WM_USER, WM_USER, PM_NOREMOVE);
    {
        std::lock_guard<std::mutex> lock(g_ui_mutex);
        g_ui_thread_id = GetCurrentThreadId();
        g_ui_stop = false;
    }
    g_ui_ready.notify_all();
    while (true) {
        const BOOL result = GetMessageW(&message, nullptr, 0, 0);
        if (result <= 0) break;
        if (message.message == kSurfaceMessage) {
            run_ui_tasks();
            continue;
        }
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }
    run_ui_tasks();
    {
        std::lock_guard<std::mutex> lock(g_ui_mutex);
        g_ui_stop = true;
        g_ui_thread_id = 0;
    }
    g_ui_ready.notify_all();
}

void stop_loop() {
    DWORD thread_id = 0;
    {
        std::lock_guard<std::mutex> lock(g_ui_mutex);
        g_ui_stop = true;
        thread_id = g_ui_thread_id;
    }
    g_ui_ready.notify_all();
    if (thread_id) PostThreadMessageW(thread_id, WM_QUIT, 0, 0);
}

}

#endif
