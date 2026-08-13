#include "PlatformCaptureWindowsInternal.hpp"
#include "../AudioSpscRing.hpp"

#if defined(_WIN32)

using namespace dspeak_windows;

namespace {

struct PlatformAudioOutput {
    StereoAudioSpscRing<9600> samples;
    std::atomic<double> read_position{0.0};
    std::wstring device_id;
    std::atomic<double> volume{1.0};
    std::atomic<bool> enabled{true};
    std::atomic<bool> primed{true};
    std::atomic<uint32_t> target_frames{0};
    std::atomic<uint32_t> device_period_frames{0};
    std::atomic<uint32_t> render_period_frames{0};
    std::atomic<bool> stop_requested{false};
    std::atomic<HANDLE> event{nullptr};
    std::thread thread;
    std::mutex state_mutex;
    std::condition_variable state_changed;
    bool initialized = false;
    bool running = false;
    int startup_result = -1;
};

std::mutex g_output_registry_mutex;
std::vector<PlatformAudioOutput*> g_outputs;
std::wstring g_output_device_id;

bool output_format_details(const WAVEFORMATEX* format,
                           bool& is_float,
                           uint16_t& channels,
                           uint16_t& bits) {
    uint32_t sample_rate = 0;
    return audio_format_details(format, is_float, channels, sample_rate, bits);
}

void write_output_frames(PlatformAudioOutput* output,
                         BYTE* destination,
                         uint32_t frames,
                         const WAVEFORMATEX* format) {
    bool is_float = false;
    uint16_t channels = 0;
    uint16_t bits = 0;
    if (!output_format_details(format, is_float, channels, bits)) return;
    const size_t bytes_per_sample = bits / 8;
    const size_t block_align = format->nBlockAlign;
    const double step = 48000.0 / static_cast<double>(format->nSamplesPerSec);
    const size_t queued_frames = output->samples.available();
    if (queued_frames > 9600) output->samples.discard(queued_frames - 9600);
    const size_t available_frames = output->samples.available();
    const uint32_t target_frames = output->target_frames.load(std::memory_order_acquire);
    const bool ready = output->enabled.load(std::memory_order_acquire) &&
        (target_frames == 0 || available_frames >= static_cast<size_t>(target_frames));
    if (ready) output->primed.store(true, std::memory_order_release);
    const bool playing = output->enabled.load(std::memory_order_acquire) &&
        output->primed.load(std::memory_order_acquire);
    double read_position = output->read_position.load(std::memory_order_relaxed);
    const float volume = static_cast<float>(output->volume.load(std::memory_order_relaxed));
    bool underflow = false;
    for (uint32_t frame = 0; frame < frames; ++frame) {
        float left = 0.0f;
        float right = 0.0f;
        if (playing && available_frames > 0 &&
            read_position < static_cast<double>(available_frames)) {
            const size_t index = std::min(
                static_cast<size_t>(read_position), available_frames - 1);
            const size_t next = std::min(index + 1, available_frames - 1);
            const double fraction = read_position - static_cast<double>(index);
            StereoAudioSpscRing<9600>::Frame current;
            StereoAudioSpscRing<9600>::Frame following;
            if (output->samples.peek(index, current) &&
                output->samples.peek(next, following)) {
                left = static_cast<float>(
                    current.left * (1.0 - fraction) + following.left * fraction) * volume;
                right = static_cast<float>(
                    current.right * (1.0 - fraction) + following.right * fraction) * volume;
                read_position += step;
            } else underflow = true;
        } else if (playing) {
            underflow = true;
        }
        BYTE* frame_data = destination + static_cast<size_t>(frame) * block_align;
        for (uint16_t channel = 0; channel < channels; ++channel) {
            const float value = channel == 0 ? left : channel == 1 ? right : (left + right) * 0.5f;
            BYTE* sample_data = frame_data + static_cast<size_t>(channel) * bytes_per_sample;
            if (is_float && bits == 32) {
                *reinterpret_cast<float*>(sample_data) = value;
            } else if (bits == 16) {
                *reinterpret_cast<int16_t*>(sample_data) = static_cast<int16_t>(
                    std::clamp(value, -1.0f, 1.0f) * 32767.0f);
            } else if (bits == 24) {
                const int32_t sample = static_cast<int32_t>(
                    std::clamp(value, -1.0f, 1.0f) * 8388607.0f);
                sample_data[0] = static_cast<BYTE>(sample & 0xff);
                sample_data[1] = static_cast<BYTE>((sample >> 8) & 0xff);
                sample_data[2] = static_cast<BYTE>((sample >> 16) & 0xff);
            } else {
                *reinterpret_cast<int32_t*>(sample_data) = static_cast<int32_t>(
                    std::clamp(value, -1.0f, 1.0f) * 2147483647.0f);
            }
        }
    }
    output->read_position.store(read_position, std::memory_order_relaxed);
    const size_t remaining_frames = output->samples.available();
    const size_t consumed_frames = std::min(
        remaining_frames,
        static_cast<size_t>(std::floor(std::max(0.0, read_position))));
    if (consumed_frames > 0) {
        output->samples.discard(consumed_frames);
        output->read_position.store(
            std::max(0.0, read_position - static_cast<double>(consumed_frames)),
            std::memory_order_relaxed);
    }
    if (underflow)
        output->primed.store(false, std::memory_order_release);
}

void output_run(PlatformAudioOutput* output) {
    dspeak_native::configure_current_audio_thread();
    ComScope com;
    ComPtr<IMMDevice> device;
    ComPtr<IAudioClient> client;
    ComPtr<IAudioRenderClient> render;
    WAVEFORMATEX* format = nullptr;
    HANDLE event = nullptr;
    UINT32 buffer_frames = 0;
    HRESULT result = com.usable() ? S_OK : E_FAIL;
    if (SUCCEEDED(result)) {
        device = get_audio_device(output->device_id, eRender);
        result = device ? S_OK : AUDCLNT_E_DEVICE_INVALIDATED;
    }
    if (SUCCEEDED(result)) result = device->Activate(
        __uuidof(IAudioClient), CLSCTX_ALL, nullptr,
        reinterpret_cast<void**>(client.GetAddressOf()));
    if (SUCCEEDED(result)) result = client->GetMixFormat(&format);
    if (SUCCEEDED(result)) {
        event = CreateEventW(nullptr, FALSE, FALSE, nullptr);
        result = event ? S_OK : HRESULT_FROM_WIN32(GetLastError());
    }
    if (SUCCEEDED(result)) result = client->Initialize(
        AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
        200000, 0, format, nullptr);
    if (SUCCEEDED(result)) result = client->SetEventHandle(event);
    if (SUCCEEDED(result)) result = client->GetBufferSize(&buffer_frames);
    if (SUCCEEDED(result)) result = client->GetService(
        __uuidof(IAudioRenderClient),
        reinterpret_cast<void**>(render.GetAddressOf()));
    output->event.store(event);
    output->device_period_frames.store(buffer_frames, std::memory_order_release);
    if (FAILED(result)) {
        {
            std::lock_guard<std::mutex> lock(output->state_mutex);
            output->startup_result = -1;
            output->initialized = true;
            output->running = false;
        }
        output->state_changed.notify_all();
        if (format) CoTaskMemFree(format);
        if (event) CloseHandle(event);
        output->event.store(nullptr);
        return;
    }
    result = client->Start();
    if (FAILED(result)) {
        {
            std::lock_guard<std::mutex> lock(output->state_mutex);
            output->startup_result = -1;
            output->initialized = true;
            output->running = false;
        }
        output->state_changed.notify_all();
        if (format) CoTaskMemFree(format);
        CloseHandle(event);
        output->event.store(nullptr);
        return;
    }
    {
        std::lock_guard<std::mutex> lock(output->state_mutex);
        output->startup_result = 0;
        output->initialized = true;
        output->running = true;
    }
    output->state_changed.notify_all();
    while (!output->stop_requested.load()) {
        if (WaitForSingleObject(event, 100) == WAIT_FAILED) break;
        UINT32 padding = 0;
        if (FAILED(client->GetCurrentPadding(&padding))) break;
        const UINT32 frames = buffer_frames > padding ? buffer_frames - padding : 0;
        if (!frames) continue;
        output->render_period_frames.store(frames, std::memory_order_relaxed);
        BYTE* data = nullptr;
        if (FAILED(render->GetBuffer(frames, &data)) || !data) break;
        write_output_frames(output, data, frames, format);
        if (FAILED(render->ReleaseBuffer(frames, 0))) break;
    }
    client->Stop();
    if (format) CoTaskMemFree(format);
    CloseHandle(event);
    output->event.store(nullptr);
    {
        std::lock_guard<std::mutex> lock(output->state_mutex);
        output->running = false;
    }
    output->state_changed.notify_all();
}

int start_output(PlatformAudioOutput* output) {
    std::unique_lock<std::mutex> lock(output->state_mutex);
    if (output->thread.joinable()) {
        if (output->running) return output->startup_result;
        lock.unlock();
        output->thread.join();
        lock.lock();
    }
    output->stop_requested.store(false);
    output->initialized = false;
    output->startup_result = -1;
    output->thread = std::thread(output_run, output);
    output->state_changed.wait(lock, [output] { return output->initialized; });
    if (output->startup_result != 0) {
        lock.unlock();
        if (output->thread.joinable()) output->thread.join();
    }
    return output->startup_result;
}

void stop_output(PlatformAudioOutput* output) {
    output->stop_requested.store(true);
    const HANDLE event = output->event.load();
    if (event) SetEvent(event);
    if (output->thread.joinable()) output->thread.join();
}

int set_output_device(PlatformAudioOutput* output, const std::wstring& device_id) {
    stop_output(output);
    output->device_id = device_id;
    return start_output(output);
}

}

extern "C" int lib_dspeak_media_platform_set_output_device(const char* device_id) {
    ComScope com;
    if (!com.usable()) return -1;
    const std::wstring requested = endpoint_id_from_value(device_id);
    if (!get_audio_device(requested, eRender)) return -1;
    std::lock_guard<std::mutex> lock(g_output_registry_mutex);
    g_output_device_id = requested;
    for (PlatformAudioOutput* output : g_outputs)
        if (set_output_device(output, requested) != 0) return -1;
    return 0;
}

extern "C" void* lib_dspeak_media_platform_audio_output_create(const char*) {
    auto* output = new(std::nothrow) PlatformAudioOutput();
    if (!output) return nullptr;
    {
        std::lock_guard<std::mutex> lock(g_output_registry_mutex);
        output->device_id = g_output_device_id;
    }
    if (start_output(output) != 0) {
        delete output;
        return nullptr;
    }
    std::lock_guard<std::mutex> lock(g_output_registry_mutex);
    g_outputs.push_back(output);
    return output;
}

extern "C" void lib_dspeak_media_platform_audio_output_destroy(void* value) {
    auto* output = static_cast<PlatformAudioOutput*>(value);
    if (!output) return;
    {
        std::lock_guard<std::mutex> lock(g_output_registry_mutex);
        g_outputs.erase(std::remove(g_outputs.begin(), g_outputs.end(), output),
                        g_outputs.end());
    }
    stop_output(output);
    delete output;
}

extern "C" int lib_dspeak_media_platform_audio_output_start(void* value) {
    auto* output = static_cast<PlatformAudioOutput*>(value);
    return output ? start_output(output) : -1;
}

extern "C" void lib_dspeak_media_platform_audio_output_stop(void* value) {
    auto* output = static_cast<PlatformAudioOutput*>(value);
    if (output) stop_output(output);
}

extern "C" void lib_dspeak_media_platform_audio_output_set_enabled(void* value,
                                                                      bool enabled) {
    auto* output = static_cast<PlatformAudioOutput*>(value);
    if (!output) return;
    output->enabled.store(enabled, std::memory_order_release);
    if (!enabled) {
        output->samples.reset();
        output->read_position.store(0.0, std::memory_order_release);
        output->primed.store(
            output->target_frames.load(std::memory_order_acquire) == 0,
            std::memory_order_release);
    }
}

extern "C" void lib_dspeak_media_platform_audio_output_set_volume(void* value,
                                                                     double volume) {
    auto* output = static_cast<PlatformAudioOutput*>(value);
    if (!output) return;
    output->volume.store(std::clamp(volume, 0.0, 2.0), std::memory_order_release);
}

extern "C" void lib_dspeak_media_platform_audio_output_set_jitter_buffer(
    void* value,
    int min_delay_ms,
    int target_delay_ms) {
    auto* output = static_cast<PlatformAudioOutput*>(value);
    if (!output) return;
    const int effective_delay_ms = std::min(
        200, std::max(0, std::max(min_delay_ms, target_delay_ms)));
    output->target_frames.store(
        static_cast<uint32_t>(effective_delay_ms * 48000 / 1000),
        std::memory_order_release);
    output->primed.store(effective_delay_ms == 0, std::memory_order_release);
}

extern "C" void lib_dspeak_media_platform_audio_output_write(
    void* value,
    const float* samples,
    uint32_t frame_count,
    uint32_t sample_rate,
    uint8_t channels) {
    auto* output = static_cast<PlatformAudioOutput*>(value);
    if (!output || !samples || !frame_count || sample_rate != 48000 || channels == 0)
        return;
    for (uint32_t frame = 0; frame < frame_count; ++frame) {
        const float left = samples[static_cast<size_t>(frame) * channels];
        const float right = channels > 1
            ? samples[static_cast<size_t>(frame) * channels + 1]
            : left;
        output->samples.push(left, right);
    }
}

extern "C" void lib_dspeak_media_platform_audio_output_get_metrics(
    uint32_t* device_period_frames,
    uint32_t* render_period_frames,
    uint32_t* queue_frames,
    uint64_t* dropped_frames,
    uint32_t* target_frames,
    uint32_t* output_count) {
    std::lock_guard<std::mutex> lock(g_output_registry_mutex);
    if (output_count) *output_count = static_cast<uint32_t>(g_outputs.size());
    const auto* output = g_outputs.empty() ? nullptr : g_outputs.front();
    if (!output) {
        if (device_period_frames) *device_period_frames = 0;
        if (render_period_frames) *render_period_frames = 0;
        if (queue_frames) *queue_frames = 0;
        if (dropped_frames) *dropped_frames = 0;
        if (target_frames) *target_frames = 0;
        return;
    }
    if (device_period_frames)
        *device_period_frames = output->device_period_frames.load(std::memory_order_relaxed);
    if (render_period_frames)
        *render_period_frames = output->render_period_frames.load(std::memory_order_relaxed);
    if (queue_frames) *queue_frames = static_cast<uint32_t>(output->samples.available());
    if (dropped_frames) *dropped_frames = output->samples.dropped_frames();
    if (target_frames)
        *target_frames = output->target_frames.load(std::memory_order_relaxed);
}

#endif
