#include "PlatformCaptureWindowsInternal.hpp"

#if defined(_WIN32)

namespace dspeak_windows {

class StereoResampler {
public:
    explicit StereoResampler(uint32_t source_rate) : source_rate_(source_rate) {}

    void append(const float* samples, uint32_t frames, uint8_t channels) {
        if (!samples || frames == 0 || channels == 0) return;
        for (uint32_t frame = 0; frame < frames; ++frame) {
            const float left = samples[static_cast<size_t>(frame) * channels];
            const float right = channels > 1
                ? samples[static_cast<size_t>(frame) * channels + 1]
                : left;
            samples_.push_back(left);
            samples_.push_back(right);
        }
    }

    std::vector<float> drain() {
        std::vector<float> output;
        if (source_rate_ == 48000) {
            output.swap(samples_);
            position_ = 0;
            return output;
        }
        const size_t frames = samples_.size() / 2;
        if (frames < 2) return output;
        const double step = static_cast<double>(source_rate_) / 48000.0;
        while (position_ + 1.0 < static_cast<double>(frames)) {
            const size_t index = static_cast<size_t>(position_);
            const double fraction = position_ - static_cast<double>(index);
            const size_t offset = index * 2;
            const size_t next = offset + 2;
            output.push_back(static_cast<float>(
                samples_[offset] * (1.0 - fraction) + samples_[next] * fraction));
            output.push_back(static_cast<float>(
                samples_[offset + 1] * (1.0 - fraction) +
                samples_[next + 1] * fraction));
            position_ += step;
        }
        const size_t consumed = position_ > 1.0
            ? static_cast<size_t>(position_) - 1
            : 0;
        if (consumed > 0) {
            samples_.erase(samples_.begin(), samples_.begin() + consumed * 2);
            position_ -= consumed;
        }
        return output;
    }

private:
    uint32_t source_rate_ = 48000;
    std::vector<float> samples_;
    double position_ = 0;
};


float decoded_sample(const uint8_t* data, size_t index, bool is_float, uint16_t bits) {
    if (is_float && bits == 32)
        return std::clamp(reinterpret_cast<const float*>(data)[index], -1.0f, 1.0f);
    if (bits == 16)
        return static_cast<float>(reinterpret_cast<const int16_t*>(data)[index]) / 32768.0f;
    if (bits == 24) {
        const size_t offset = index * 3;
        int32_t value = static_cast<int32_t>(data[offset]) |
            (static_cast<int32_t>(data[offset + 1]) << 8) |
            (static_cast<int32_t>(data[offset + 2]) << 16);
        if (value & 0x800000) value |= ~0xFFFFFF;
        return static_cast<float>(value) / 8388608.0f;
    }
    return static_cast<float>(reinterpret_cast<const int32_t*>(data)[index]) /
        2147483648.0f;
}

class WasapiCapture {
public:
    WasapiCapture(std::wstring endpoint_id,
                  bool loopback,
                  DWORD process_id,
                  bool include_process_tree,
                  lib_dspeak_media_audio_frame_cb audio_cb,
                  lib_dspeak_media_capture_error_cb error_cb,
                  void* user_data)
        : endpoint_id_(std::move(endpoint_id)),
          loopback_(loopback),
          process_id_(process_id),
          include_process_tree_(include_process_tree),
          audio_cb_(audio_cb),
          error_cb_(error_cb),
          user_data_(user_data) {}

    ~WasapiCapture() { stop(); }

    int start() {
        std::unique_lock<std::mutex> lock(state_mutex_);
        if (thread_.joinable()) {
            if (running_) return startup_result_;
            lock.unlock();
            thread_.join();
            lock.lock();
        }
        stop_requested_.store(false);
        initialized_ = false;
        startup_result_ = -1;
        thread_ = std::thread(&WasapiCapture::run, this);
        state_changed_.wait(lock, [this] { return initialized_; });
        if (startup_result_ != 0) {
            lock.unlock();
            if (thread_.joinable()) thread_.join();
            return startup_result_;
        }
        return 0;
    }

    void stop() {
        stop_requested_.store(true);
        const HANDLE event = event_.load();
        if (event) SetEvent(event);
        if (thread_.joinable()) thread_.join();
    }

private:
    void report_error(int code, const char* message) {
        if (error_cb_) error_cb_(user_data_, code, message);
    }

    void run() {
        dspeak_native::configure_current_audio_thread();
        ComScope com;
        ComPtr<IMMDevice> device;
        ComPtr<IAudioClient> client;
        ComPtr<IAudioCaptureClient> capture;
        WAVEFORMATEX* format = nullptr;
        HANDLE event = nullptr;
        HRESULT result = com.usable() ? S_OK : E_FAIL;
        bool is_float = false;
        uint16_t channels = 0;
        uint32_t sample_rate = 0;
        uint16_t bits = 0;
        if (SUCCEEDED(result) && loopback_ && process_id_ != 0) {
            client = activate_process_loopback(
                process_id_, include_process_tree_, &result);
            result = client ? S_OK : result;
        } else if (SUCCEEDED(result)) {
            device = get_audio_device(endpoint_id_, loopback_ ? eRender : eCapture);
            result = device ? S_OK : AUDCLNT_E_DEVICE_INVALIDATED;
        }
        if (SUCCEEDED(result) && !client) result = device->Activate(
            __uuidof(IAudioClient), CLSCTX_ALL, nullptr,
            reinterpret_cast<void**>(client.GetAddressOf()));
        if (SUCCEEDED(result)) result = client->GetMixFormat(&format);
        if (SUCCEEDED(result) && !audio_format_details(
                format, is_float, channels, sample_rate, bits))
            result = AUDCLNT_E_UNSUPPORTED_FORMAT;
        if (SUCCEEDED(result)) {
            event = CreateEventW(nullptr, FALSE, FALSE, nullptr);
            result = event ? S_OK : HRESULT_FROM_WIN32(GetLastError());
        }
        if (SUCCEEDED(result)) {
            DWORD flags = AUDCLNT_STREAMFLAGS_EVENTCALLBACK;
            if (loopback_)
                flags |= AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM;
            result = client->Initialize(AUDCLNT_SHAREMODE_SHARED, flags,
                                        1000000, 0, format, nullptr);
        }
        if (SUCCEEDED(result)) result = client->SetEventHandle(event);
        if (SUCCEEDED(result)) result = client->GetService(
            __uuidof(IAudioCaptureClient),
            reinterpret_cast<void**>(capture.GetAddressOf()));
        event_.store(event);
        if (format) CoTaskMemFree(format);
        if (FAILED(result)) {
            {
                std::lock_guard<std::mutex> lock(state_mutex_);
                startup_result_ = -601;
                initialized_ = true;
                running_ = false;
            }
            state_changed_.notify_all();
            if (event) CloseHandle(event);
            event_.store(nullptr);
            report_error(-601, loopback_
                ? (include_process_tree_
                    ? "Windows application audio loopback initialization failed"
                    : "Windows self-excluded system audio loopback initialization failed")
                : "Windows WASAPI microphone initialization failed");
            return;
        }
        result = client->Start();
        if (FAILED(result)) {
            {
                std::lock_guard<std::mutex> lock(state_mutex_);
                startup_result_ = -602;
                initialized_ = true;
                running_ = false;
            }
            state_changed_.notify_all();
            report_error(-602, "Windows WASAPI capture failed to start");
            CloseHandle(event);
            event_.store(nullptr);
            return;
        }
        {
            std::lock_guard<std::mutex> lock(state_mutex_);
            startup_result_ = 0;
            initialized_ = true;
            running_ = true;
        }
        state_changed_.notify_all();
        StereoResampler resampler(sample_rate);
        bool runtime_failed = false;
        result = S_OK;
        while (!stop_requested_.load()) {
            const DWORD wait_result = WaitForSingleObject(event, 100);
            if (wait_result == WAIT_FAILED) {
                runtime_failed = true;
                break;
            }
            while (!stop_requested_.load()) {
                UINT32 packet_frames = 0;
                result = capture->GetNextPacketSize(&packet_frames);
                if (FAILED(result)) {
                    runtime_failed = true;
                    break;
                }
                if (packet_frames == 0) break;
                BYTE* data = nullptr;
                UINT32 frames = 0;
                DWORD flags = 0;
                result = capture->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
                if (FAILED(result)) {
                    runtime_failed = true;
                    break;
                }
                std::vector<float> decoded(static_cast<size_t>(frames) * 2, 0.0f);
                if (!(flags & AUDCLNT_BUFFERFLAGS_SILENT) && data) {
                    const size_t stride = static_cast<size_t>(channels) * bits / 8;
                    for (UINT32 frame = 0; frame < frames; ++frame) {
                        const auto* source = data + static_cast<size_t>(frame) * stride;
                        float left = decoded_sample(source, 0, is_float, bits);
                        float right = channels > 1
                            ? decoded_sample(source, 1, is_float, bits)
                            : left;
                        decoded[static_cast<size_t>(frame) * 2] = left;
                        decoded[static_cast<size_t>(frame) * 2 + 1] = right;
                    }
                }
                result = capture->ReleaseBuffer(frames);
                if (FAILED(result)) {
                    runtime_failed = true;
                    break;
                }
                resampler.append(decoded.data(), frames, 2);
                std::vector<float> output = resampler.drain();
                if (!output.empty() && audio_cb_)
                    audio_cb_(user_data_, output.data(),
                              static_cast<uint32_t>(output.size() / 2), 48000, 2);
            }
            if (runtime_failed) break;
        }
        if (runtime_failed && !stop_requested_.load())
            report_error(-603, "Windows WASAPI capture stopped delivering audio");
        client->Stop();
        CloseHandle(event);
        event_.store(nullptr);
        {
            std::lock_guard<std::mutex> lock(state_mutex_);
            running_ = false;
        }
        state_changed_.notify_all();
    }

    std::wstring endpoint_id_;
    bool loopback_ = false;
    DWORD process_id_ = 0;
    bool include_process_tree_ = true;
    lib_dspeak_media_audio_frame_cb audio_cb_ = nullptr;
    lib_dspeak_media_capture_error_cb error_cb_ = nullptr;
    void* user_data_ = nullptr;
    std::thread thread_;
    std::atomic<bool> stop_requested_{false};
    std::atomic<HANDLE> event_{nullptr};
    std::mutex state_mutex_;
    std::condition_variable state_changed_;
    bool initialized_ = false;
    bool running_ = false;
    int startup_result_ = -1;
};

class CameraCapture {
public:
    CameraCapture(std::wstring device_id,
                  uint32_t video_width,
                  uint32_t video_height,
                  uint32_t video_frame_rate,
                  lib_dspeak_media_screen_frame_cb screen_cb,
                  lib_dspeak_media_capture_error_cb error_cb,
                  void* user_data)
        : device_id_(std::move(device_id)),
          video_width_(video_width),
          video_height_(video_height),
          video_frame_rate_(video_frame_rate),
          screen_cb_(screen_cb),
          error_cb_(error_cb),
          user_data_(user_data) {}

    ~CameraCapture() { stop(); }

    int start() {
        std::unique_lock<std::mutex> lock(state_mutex_);
        if (thread_.joinable()) {
            if (running_) return startup_result_;
            lock.unlock();
            thread_.join();
            lock.lock();
        }
        stop_requested_.store(false);
        initialized_ = false;
        startup_result_ = -1;
        thread_ = std::thread(&CameraCapture::run, this);
        state_changed_.wait(lock, [this] { return initialized_; });
        if (startup_result_ != 0) {
            lock.unlock();
            if (thread_.joinable()) thread_.join();
            return startup_result_;
        }
        return 0;
    }

    void stop() {
        stop_requested_.store(true);
        ComPtr<IMFSourceReader> reader;
        {
            std::lock_guard<std::mutex> resource_lock(resource_mutex_);
            reader = reader_;
        }
        if (reader) reader->Flush(MF_SOURCE_READER_FIRST_VIDEO_STREAM);
        if (thread_.joinable()) thread_.join();
    }

private:
    void run() {
        dspeak_native::configure_current_media_thread();
        ComScope com;
        ComPtr<IMFMediaSource> source;
        ComPtr<IMFSourceReader> reader;
        IMFMediaType* output_type = nullptr;
        HRESULT result = com.usable() && ensure_media_foundation() ? S_OK : E_FAIL;
        std::vector<ComPtr<IMFActivate>> cameras;
        if (SUCCEEDED(result) && !enumerate_camera_activates(cameras)) result = E_FAIL;
        ComPtr<IMFActivate> selected;
        if (SUCCEEDED(result)) {
            for (const auto& camera : cameras) {
                const std::wstring candidate = utf8_to_wide(
                    camera_attribute(camera.Get(),
                                     MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK).c_str());
                if (device_id_.empty() || candidate == device_id_) {
                    selected = camera;
                    break;
                }
            }
            result = selected ? S_OK : MF_E_NOT_FOUND;
        }
        if (SUCCEEDED(result)) result = selected->ActivateObject(
            __uuidof(IMFMediaSource), reinterpret_cast<void**>(source.GetAddressOf()));
        ComPtr<IMFAttributes> attributes;
        if (SUCCEEDED(result)) result = MFCreateAttributes(&attributes, 2);
        if (SUCCEEDED(result)) result = attributes->SetUINT32(
            MF_READWRITE_DISABLE_CONVERTERS, FALSE);
        if (SUCCEEDED(result)) result = MFCreateSourceReaderFromMediaSource(
            source.Get(), attributes.Get(), &reader);
        if (SUCCEEDED(result)) {
            std::lock_guard<std::mutex> resource_lock(resource_mutex_);
            source_ = source;
            reader_ = reader;
        }
        if (SUCCEEDED(result)) result = MFCreateMediaType(&output_type);
        if (SUCCEEDED(result)) result = output_type->SetGUID(
            MF_MT_MAJOR_TYPE, MFMediaType_Video);
        if (SUCCEEDED(result)) result = output_type->SetGUID(
            MF_MT_SUBTYPE, MFVideoFormat_ARGB32);
        if (SUCCEEDED(result)) result = output_type->SetUINT32(
            MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
        if (SUCCEEDED(result) && video_width_ > 0 && video_height_ > 0)
            result = MFSetAttributeSize(
                output_type, MF_MT_FRAME_SIZE, video_width_, video_height_);
        if (SUCCEEDED(result) && video_frame_rate_ > 0)
            result = MFSetAttributeRatio(
                output_type, MF_MT_FRAME_RATE, video_frame_rate_, 1);
        if (SUCCEEDED(result)) result = reader->SetCurrentMediaType(
            MF_SOURCE_READER_FIRST_VIDEO_STREAM, nullptr, output_type);
        if (output_type) output_type->Release();
        if (SUCCEEDED(result)) result = reader->SetStreamSelection(
            MF_SOURCE_READER_ALL_STREAMS, FALSE);
        if (SUCCEEDED(result)) result = reader->SetStreamSelection(
            MF_SOURCE_READER_FIRST_VIDEO_STREAM, TRUE);
        {
            std::lock_guard<std::mutex> lock(state_mutex_);
            startup_result_ = SUCCEEDED(result) ? 0 : -611;
            initialized_ = true;
            running_ = SUCCEEDED(result);
        }
        state_changed_.notify_all();
        if (FAILED(result)) {
            if (source) source->Shutdown();
            if (error_cb_) error_cb_(user_data_, -611, "Windows camera initialization failed");
            return;
        }
        bool runtime_failed = false;
        while (!stop_requested_.load()) {
            DWORD flags = 0;
            LONGLONG timestamp = 0;
            DWORD stream_index = 0;
            ComPtr<IMFSample> sample;
            result = reader->ReadSample(MF_SOURCE_READER_FIRST_VIDEO_STREAM,
                                        0, &stream_index, &flags, &timestamp,
                                        &sample);
            if (FAILED(result)) {
                runtime_failed = true;
                break;
            }
            if (flags & MF_SOURCE_READERF_ENDOFSTREAM) break;
            if (!sample) continue;
            ComPtr<IMFMediaBuffer> buffer;
            if (FAILED(sample->ConvertToContiguousBuffer(&buffer))) continue;
            BYTE* data = nullptr;
            DWORD length = 0;
            const HRESULT lock_result = buffer->Lock(&data, nullptr, &length);
            if (FAILED(lock_result)) continue;
            if (!data) {
                buffer->Unlock();
                continue;
            }
            ComPtr<IMFMediaType> current_type;
            LONG stride = 0;
            if (SUCCEEDED(reader->GetCurrentMediaType(
                    MF_SOURCE_READER_FIRST_VIDEO_STREAM, &current_type)))
                stride = static_cast<LONG>(MFGetAttributeUINT32(
                    current_type.Get(), MF_MT_DEFAULT_STRIDE, 0));
            UINT32 width = 0;
            UINT32 height = 0;
            if (current_type) MFGetAttributeSize(
                current_type.Get(), MF_MT_FRAME_SIZE, &width, &height);
            if (width > 0 && height > 0 && stride == 0) stride = static_cast<LONG>(width * 4);
            const size_t absolute_stride = static_cast<size_t>(std::abs(stride));
            const size_t required = absolute_stride * height;
            if (width > 0 && height > 0 && stride != 0 && length >= required && screen_cb_) {
                const uint8_t* frame_data = data;
                std::vector<uint8_t> normalized;
                if (stride < 0) {
                    normalized.resize(required);
                    for (UINT32 row = 0; row < height; ++row) {
                        const auto* source_row = data +
                            static_cast<size_t>(height - row - 1) * absolute_stride;
                        std::memcpy(normalized.data() + static_cast<size_t>(row) * absolute_stride,
                                    source_row, absolute_stride);
                    }
                    frame_data = normalized.data();
                }
                screen_cb_(user_data_, frame_data, width, height,
                           static_cast<uint32_t>(absolute_stride),
                           static_cast<int64_t>(timestamp / 10000));
            }
            buffer->Unlock();
        }
        {
            std::lock_guard<std::mutex> resource_lock(resource_mutex_);
            reader_.Reset();
            source_.Reset();
        }
        if (source) source->Shutdown();
        if (runtime_failed && !stop_requested_.load() && error_cb_)
            error_cb_(user_data_, -612, "Windows camera stream stopped delivering frames");
        {
            std::lock_guard<std::mutex> lock(state_mutex_);
            running_ = false;
        }
        state_changed_.notify_all();
    }

    std::wstring device_id_;
    uint32_t video_width_ = 1280;
    uint32_t video_height_ = 720;
    uint32_t video_frame_rate_ = 30;
    lib_dspeak_media_screen_frame_cb screen_cb_ = nullptr;
    lib_dspeak_media_capture_error_cb error_cb_ = nullptr;
    void* user_data_ = nullptr;
    std::thread thread_;
    std::atomic<bool> stop_requested_{false};
    std::mutex resource_mutex_;
    ComPtr<IMFMediaSource> source_;
    ComPtr<IMFSourceReader> reader_;
    std::mutex state_mutex_;
    std::condition_variable state_changed_;
    bool initialized_ = false;
    bool running_ = false;
    int startup_result_ = -1;
};


void* create_audio_capture(const std::wstring& endpoint_id,
                           bool loopback,
                           DWORD process_id,
                           bool include_process_tree,
                           lib_dspeak_media_audio_frame_cb audio_cb,
                           lib_dspeak_media_capture_error_cb error_cb,
                           void* user_data) {
    return new(std::nothrow) WasapiCapture(
        endpoint_id, loopback, process_id, include_process_tree,
        audio_cb, error_cb, user_data);
}

int start_audio_capture(void* value) {
    return value ? static_cast<WasapiCapture*>(value)->start() : -1;
}

void destroy_audio_capture(void* value) {
    delete static_cast<WasapiCapture*>(value);
}

void* create_camera_capture(const std::wstring& device_id,
                            uint32_t video_width,
                            uint32_t video_height,
                            uint32_t video_frame_rate,
                            lib_dspeak_media_screen_frame_cb screen_cb,
                            lib_dspeak_media_capture_error_cb error_cb,
                            void* user_data) {
    return new(std::nothrow) CameraCapture(
        device_id, video_width, video_height, video_frame_rate,
        screen_cb, error_cb, user_data);
}

int start_camera_capture(void* value) {
    return value ? static_cast<CameraCapture*>(value)->start() : -1;
}

void destroy_camera_capture(void* value) {
    delete static_cast<CameraCapture*>(value);
}

}

#endif
