#include "../../libdspeak_media/src/internal/platform_video_codec_factories.hpp"
#include "PlatformCaptureWindowsInternal.hpp"

#if defined(_WIN32)

#include <mferror.h>
#include <mftransform.h>

#include <api/video/encoded_image.h>
#include <api/video/i420_buffer.h>
#include <api/video/video_frame.h>
#include <modules/video_coding/include/video_codec_interface.h>
#include <api/video_codecs/video_codec.h>
#include <third_party/libyuv/include/libyuv/convert.h>

#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <memory>
#include <mutex>
#include <string>
#include <utility>
#include <vector>

namespace {

using Microsoft::WRL::ComPtr;
using namespace webrtc;

class ComScope {
public:
    ComScope()
        : result_(CoInitializeEx(nullptr, COINIT_MULTITHREADED)),
          owns_(result_ == S_OK || result_ == S_FALSE) {}

    ~ComScope() {
        if (owns_) CoUninitialize();
    }

    bool usable() const {
        return SUCCEEDED(result_) || result_ == RPC_E_CHANGED_MODE;
    }

private:
    HRESULT result_;
    bool owns_;
};

void release_activates(IMFActivate** activates, UINT32 count) {
    if (!activates) return;
    for (UINT32 index = 0; index < count; ++index) {
        if (activates[index]) activates[index]->Release();
    }
    CoTaskMemFree(activates);
}

ComPtr<IMFTransform> create_hardware_transform(
    MFT_REGISTER_TYPE_INFO input_info,
    MFT_REGISTER_TYPE_INFO output_info) {
    IMFActivate** activates = nullptr;
    UINT32 count = 0;
    const auto result = MFTEnumEx(
        MFT_CATEGORY_VIDEO_ENCODER,
        MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER,
        &input_info,
        &output_info,
        &activates,
        &count);
    if (FAILED(result)) return nullptr;
    ComPtr<IMFTransform> transform;
    for (UINT32 index = 0; index < count; ++index) {
        ComPtr<IMFTransform> candidate;
        if (activates[index] &&
            SUCCEEDED(activates[index]->ActivateObject(
                IID_PPV_ARGS(&candidate)))) {
            transform = candidate;
            break;
        }
    }
    release_activates(activates, count);
    return transform;
}

ComPtr<IMFTransform> create_hardware_decoder_transform(
    MFT_REGISTER_TYPE_INFO input_info,
    MFT_REGISTER_TYPE_INFO output_info) {
    IMFActivate** activates = nullptr;
    UINT32 count = 0;
    const auto result = MFTEnumEx(
        MFT_CATEGORY_VIDEO_DECODER,
        MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER,
        &input_info,
        &output_info,
        &activates,
        &count);
    if (FAILED(result)) return nullptr;
    ComPtr<IMFTransform> transform;
    for (UINT32 index = 0; index < count; ++index) {
        ComPtr<IMFTransform> candidate;
        if (activates[index] &&
            SUCCEEDED(activates[index]->ActivateObject(
                IID_PPV_ARGS(&candidate)))) {
            transform = candidate;
            break;
        }
    }
    release_activates(activates, count);
    return transform;
}

bool set_video_type(IMFMediaType* type,
                    const GUID& subtype,
                    int width,
                    int height,
                    int framerate) {
    if (!type || FAILED(type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video)) ||
        FAILED(type->SetGUID(MF_MT_SUBTYPE, subtype)) ||
        FAILED(MFSetAttributeSize(
            type, MF_MT_FRAME_SIZE, static_cast<UINT32>(width),
            static_cast<UINT32>(height))) ||
        FAILED(MFSetAttributeRatio(
            type, MF_MT_FRAME_RATE, static_cast<UINT32>(framerate), 1)) ||
        FAILED(type->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive)))
        return false;
    return true;
}

bool configure_encoder_transform(IMFTransform* transform,
                                 int width,
                                 int height,
                                 int framerate,
                                 int bitrate,
                                 ComPtr<IMFMediaType>* output_type) {
    if (!transform || !output_type) return false;
    ComPtr<IMFMediaType> input_type;
    ComPtr<IMFMediaType> encoded_type;
    if (FAILED(MFCreateMediaType(&input_type)) ||
        FAILED(MFCreateMediaType(&encoded_type)) ||
        !set_video_type(input_type.Get(), MFVideoFormat_NV12,
                        width, height, framerate) ||
        !set_video_type(encoded_type.Get(), MFVideoFormat_H264,
                        width, height, framerate))
        return false;
    if (FAILED(encoded_type->SetUINT32(
            MF_MT_AVG_BITRATE, static_cast<UINT32>(std::max(1, bitrate)))))
        return false;
    if (FAILED(transform->SetOutputType(0, encoded_type.Get(), 0)) ||
        FAILED(transform->SetInputType(0, input_type.Get(), 0)))
        return false;
    *output_type = encoded_type;
    return true;
}

bool configure_decoder_transform(IMFTransform* transform,
                                 int width,
                                 int height,
                                 ComPtr<IMFMediaType>* output_type) {
    if (!transform || !output_type) return false;
    ComPtr<IMFMediaType> encoded_type;
    ComPtr<IMFMediaType> output_video_type;
    if (FAILED(MFCreateMediaType(&encoded_type)) ||
        FAILED(MFCreateMediaType(&output_video_type)) ||
        FAILED(encoded_type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video)) ||
        FAILED(encoded_type->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_H264)) ||
        FAILED(output_video_type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video)) ||
        FAILED(output_video_type->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_NV12)))
        return false;
    if (width > 0 && height > 0) {
        if (FAILED(MFSetAttributeSize(
                encoded_type.Get(), MF_MT_FRAME_SIZE,
                static_cast<UINT32>(width), static_cast<UINT32>(height))) ||
            FAILED(MFSetAttributeSize(
                output_video_type.Get(), MF_MT_FRAME_SIZE,
                static_cast<UINT32>(width), static_cast<UINT32>(height))))
            return false;
    }
    if (FAILED(output_video_type->SetUINT32(
            MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive)) ||
        FAILED(transform->SetInputType(0, encoded_type.Get(), 0)) ||
        FAILED(transform->SetOutputType(0, output_video_type.Get(), 0)))
        return false;
    *output_type = output_video_type;
    return true;
}

bool find_annex_b_nalus(const uint8_t* data,
                        size_t size,
                        std::vector<std::vector<uint8_t>>& nalus) {
    if (!data || size < 4) return false;
    size_t cursor = 0;
    while (cursor + 3 < size) {
        size_t start = std::string::npos;
        size_t prefix = 0;
        for (size_t index = cursor; index + 3 < size; ++index) {
            if (data[index] == 0 && data[index + 1] == 0 &&
                data[index + 2] == 1) {
                start = index;
                prefix = 3;
                break;
            }
            if (index + 4 <= size && data[index] == 0 &&
                data[index + 1] == 0 && data[index + 2] == 0 &&
                data[index + 3] == 1) {
                start = index;
                prefix = 4;
                break;
            }
        }
        if (start == std::string::npos) break;
        const size_t payload_start = start + prefix;
        size_t next = payload_start;
        while (next + 3 < size) {
            if ((data[next] == 0 && data[next + 1] == 0 && data[next + 2] == 1) ||
                (next + 4 <= size && data[next] == 0 && data[next + 1] == 0 &&
                 data[next + 2] == 0 && data[next + 3] == 1))
                break;
            ++next;
        }
        if (next > payload_start)
            nalus.emplace_back(data + payload_start, data + next);
        cursor = next;
    }
    return !nalus.empty();
}

bool find_avcc_nalus(const uint8_t* data,
                     size_t size,
                     std::vector<std::vector<uint8_t>>& nalus) {
    if (!data || size < 4) return false;
    size_t cursor = 0;
    while (cursor + 4 <= size) {
        const uint32_t length =
            (static_cast<uint32_t>(data[cursor]) << 24) |
            (static_cast<uint32_t>(data[cursor + 1]) << 16) |
            (static_cast<uint32_t>(data[cursor + 2]) << 8) |
            static_cast<uint32_t>(data[cursor + 3]);
        cursor += 4;
        if (length == 0 || length > size - cursor) return false;
        nalus.emplace_back(data + cursor, data + cursor + length);
        cursor += length;
    }
    return cursor == size && !nalus.empty();
}

bool parse_nalus(const uint8_t* data,
                 size_t size,
                 std::vector<std::vector<uint8_t>>& nalus) {
    if (find_annex_b_nalus(data, size, nalus)) return true;
    nalus.clear();
    return find_avcc_nalus(data, size, nalus);
}

std::vector<uint8_t> to_annex_b(const uint8_t* data, size_t size) {
    std::vector<std::vector<uint8_t>> nalus;
    if (!parse_nalus(data, size, nalus)) return {};
    std::vector<uint8_t> result;
    for (const auto& nalu : nalus) {
        result.insert(result.end(), {0, 0, 0, 1});
        result.insert(result.end(), nalu.begin(), nalu.end());
    }
    return result;
}

bool has_idr(const std::vector<uint8_t>& data) {
    std::vector<std::vector<uint8_t>> nalus;
    if (!parse_nalus(data.data(), data.size(), nalus)) return false;
    for (const auto& nalu : nalus) {
        if (!nalu.empty() && (nalu[0] & 0x1f) == 5) return true;
    }
    return false;
}

ComPtr<IMFSample> make_sample(const uint8_t* data, size_t size) {
    if (!data || size == 0 || size > std::numeric_limits<DWORD>::max())
        return nullptr;
    ComPtr<IMFMediaBuffer> buffer;
    if (FAILED(MFCreateMemoryBuffer(static_cast<DWORD>(size), &buffer)))
        return nullptr;
    BYTE* destination = nullptr;
    DWORD max_length = 0;
    DWORD current_length = 0;
    if (FAILED(buffer->Lock(&destination, &max_length, &current_length)) ||
        max_length < size) {
        return nullptr;
    }
    std::memcpy(destination, data, size);
    buffer->Unlock();
    if (FAILED(buffer->SetCurrentLength(static_cast<DWORD>(size)))) return nullptr;
    ComPtr<IMFSample> sample;
    if (FAILED(MFCreateSample(&sample)) || FAILED(sample->AddBuffer(buffer.Get())))
        return nullptr;
    return sample;
}

bool copy_nv12_to_i420(IMFMediaBuffer* media_buffer,
                       int width,
                       int height,
                       scoped_refptr<I420Buffer>* output) {
    if (!media_buffer || !output || width <= 0 || height <= 0) return false;
    auto frame = I420Buffer::Create(width, height);
    if (!frame) return false;
    ComPtr<IMF2DBuffer> buffer_2d;
    BYTE* base = nullptr;
    LONG pitch = width;
    bool locked_2d = false;
    if (SUCCEEDED(media_buffer->QueryInterface(
            IID_PPV_ARGS(&buffer_2d))) &&
        SUCCEEDED(buffer_2d->Lock2D(&base, &pitch))) {
        locked_2d = true;
    } else {
        DWORD max_length = 0;
        DWORD current_length = 0;
        if (FAILED(media_buffer->Lock(
                &base, &max_length, &current_length)) ||
            current_length < static_cast<DWORD>(width * height * 3 / 2))
            return false;
    }
    const int absolute_pitch = std::abs(pitch);
    const uint8_t* y = base;
    const uint8_t* uv = base + absolute_pitch * height;
    const int result = libyuv::NV12ToI420(
        y, pitch,
        uv, pitch,
        frame->MutableDataY(), frame->StrideY(),
        frame->MutableDataU(), frame->StrideU(),
        frame->MutableDataV(), frame->StrideV(),
        width, height);
    if (locked_2d) buffer_2d->Unlock2D();
    else media_buffer->Unlock();
    if (result != 0) return false;
    *output = frame;
    return true;
}

bool extract_sample_buffer(IMFSample* sample,
                           ComPtr<IMFMediaBuffer>* output) {
    if (!sample || !output) return false;
    ComPtr<IMFMediaBuffer> buffer;
    if (FAILED(sample->ConvertToContiguousBuffer(&buffer))) return false;
    *output = buffer;
    return true;
}

class MediaFoundationEncoder final : public VideoEncoder {
public:
    explicit MediaFoundationEncoder(const SdpVideoFormat& format)
        : format_(format), com_() {}

    ~MediaFoundationEncoder() override {
        Release();
    }

    int InitEncode(const VideoCodec* codec_settings,
                   const Settings&) override {
        if (!com_.usable() || !codec_settings || codec_settings->width <= 0 ||
            codec_settings->height <= 0)
            return -1;
        Release();
        width_ = codec_settings->width;
        height_ = codec_settings->height;
        framerate_ = static_cast<unsigned>(
            std::max(1u, codec_settings->maxFramerate));
        bitrate_ = static_cast<unsigned>(
            std::max(1u, codec_settings->startBitrate)) * 1000u;
        MFT_REGISTER_TYPE_INFO input_info = {
            MFMediaType_Video, MFVideoFormat_NV12};
        MFT_REGISTER_TYPE_INFO output_info = {
            MFMediaType_Video, MFVideoFormat_H264};
        transform_ = create_hardware_transform(input_info, output_info);
        if (!transform_ || !configure_encoder_transform(
                transform_.Get(), width_, height_, framerate_, bitrate_,
                &output_type_)) {
            transform_.Reset();
            return -1;
        }
        UINT32 sequence_size = 0;
        if (SUCCEEDED(output_type_->GetBlobSize(
                MF_MT_MPEG_SEQUENCE_HEADER, &sequence_size)) && sequence_size) {
            sequence_header_.resize(sequence_size);
            if (FAILED(output_type_->GetBlob(
                    MF_MT_MPEG_SEQUENCE_HEADER, sequence_header_.data(),
                    sequence_size, &sequence_size)))
                sequence_header_.clear();
            else
                sequence_header_.resize(sequence_size);
        }
        transform_->ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0);
        transform_->ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0);
        return 0;
    }

    int32_t RegisterEncodeCompleteCallback(
        EncodedImageCallback* callback) override {
        callback_ = callback;
        return 0;
    }

    int32_t Release() override {
        if (transform_) {
            transform_->ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0);
            transform_->ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0);
        }
        output_type_.Reset();
        transform_.Reset();
        sequence_header_.clear();
        return 0;
    }

    int32_t Encode(const VideoFrame& frame,
                   const std::vector<VideoFrameType>* frame_types) override {
        if (!transform_ || !callback_) return -1;
        const auto input = frame.video_frame_buffer()->ToI420();
        if (!input) return -1;
        const size_t frame_size = static_cast<size_t>(input->width()) *
            static_cast<size_t>(input->height()) * 3 / 2;
        ComPtr<IMFMediaBuffer> buffer;
        if (FAILED(MFCreateMemoryBuffer(
                static_cast<DWORD>(frame_size), &buffer))) return -1;
        BYTE* destination = nullptr;
        DWORD max_length = 0;
        DWORD current_length = 0;
        if (FAILED(buffer->Lock(
                &destination, &max_length, &current_length)) ||
            max_length < frame_size)
            return -1;
        const int conversion = libyuv::I420ToNV12(
            input->DataY(), input->StrideY(),
            input->DataU(), input->StrideU(),
            input->DataV(), input->StrideV(),
            destination, input->width(),
            destination + input->width() * input->height(), input->width(),
            input->width(), input->height());
        buffer->Unlock();
        if (conversion != 0 || FAILED(buffer->SetCurrentLength(
                static_cast<DWORD>(frame_size)))) return -1;
        ComPtr<IMFSample> sample;
        if (FAILED(MFCreateSample(&sample)) ||
            FAILED(sample->AddBuffer(buffer.Get()))) return -1;
        sample->SetSampleTime(static_cast<LONGLONG>(frame.timestamp_us()) * 10);
        sample->SetSampleDuration(
            static_cast<LONGLONG>(10'000'000 / std::max(1u, framerate_)));
        if (FAILED(transform_->ProcessInput(0, sample.Get(), 0))) return -1;
        MFT_OUTPUT_STREAM_INFO stream_info{};
        if (FAILED(transform_->GetOutputStreamInfo(0, &stream_info))) return -1;
        const DWORD output_size = std::max<DWORD>(
            stream_info.cbSize,
            static_cast<DWORD>(std::max(1, width_ * height_)));
        ComPtr<IMFSample> output_sample;
        if (!(stream_info.dwFlags & MFT_OUTPUT_STREAM_PROVIDES_SAMPLES)) {
            if (FAILED(MFCreateMemoryBuffer(output_size, &buffer)) ||
                FAILED(MFCreateSample(&output_sample)) ||
                FAILED(output_sample->AddBuffer(buffer.Get()))) return -1;
        }
        MFT_OUTPUT_DATA_BUFFER output{};
        output.dwStreamID = 0;
        output.pSample = output_sample.Get();
        DWORD status = 0;
        const auto process_result = transform_->ProcessOutput(
            0, 1, &output, &status);
        if (process_result == MF_E_TRANSFORM_NEED_MORE_INPUT) return 0;
        if (output.pEvents) output.pEvents->Release();
        if (FAILED(process_result) || !output.pSample) return -1;
        if (output.pSample != output_sample.Get())
            output_sample.Attach(output.pSample);
        ComPtr<IMFMediaBuffer> encoded_buffer;
        if (!extract_sample_buffer(output_sample.Get(), &encoded_buffer)) return -1;
        BYTE* data = nullptr;
        DWORD encoded_max_length = 0;
        DWORD encoded_current_length = 0;
        if (FAILED(encoded_buffer->Lock(
                &data, &encoded_max_length, &encoded_current_length)))
            return -1;
        auto encoded = to_annex_b(data, encoded_current_length);
        encoded_buffer->Unlock();
        if (encoded.empty()) return 0;
        const bool key_frame =
            (frame_types && !frame_types->empty() &&
             (*frame_types)[0] == VideoFrameType::kVideoFrameKey) ||
            has_idr(encoded);
        if (key_frame && !sequence_header_.empty()) {
            auto headers = to_annex_b(
                sequence_header_.data(), sequence_header_.size());
            if (!headers.empty()) headers.insert(headers.end(), encoded.begin(), encoded.end());
            if (!headers.empty()) encoded = std::move(headers);
        }
        auto image_buffer = EncodedImageBuffer::Create(
            encoded.data(), encoded.size());
        if (!image_buffer) return -1;
        EncodedImage image;
        image.SetEncodedData(image_buffer);
        image.SetRtpTimestamp(frame.rtp_timestamp());
        image._encodedWidth = frame.width();
        image._encodedHeight = frame.height();
        image.SetFrameType(key_frame ? VideoFrameType::kVideoFrameKey
                                     : VideoFrameType::kVideoFrameDelta);
        CodecSpecificInfo codec_specific;
        codec_specific.codecType = kVideoCodecH264;
        codec_specific.codecSpecific.H264.packetization_mode =
            H264PacketizationMode::NonInterleaved;
        codec_specific.codecSpecific.H264.temporal_idx = 0xff;
        codec_specific.codecSpecific.H264.base_layer_sync = false;
        codec_specific.codecSpecific.H264.idr_frame = key_frame;
        callback_->OnEncodedImage(image, &codec_specific);
        return 0;
    }

    void SetRates(const RateControlParameters& parameters) override {
        bitrate_ = std::max(1u, parameters.bitrate.get_sum_bps());
        if (parameters.framerate_fps > 0)
            framerate_ = std::max(1u, static_cast<unsigned>(parameters.framerate_fps));
    }

    EncoderInfo GetEncoderInfo() const override {
        EncoderInfo info;
        info.implementation_name = "Media Foundation";
        info.is_hardware_accelerated = true;
        info.supports_native_handle = false;
        info.requested_resolution_alignment = 2;
        return info;
    }

private:
    SdpVideoFormat format_;
    ComScope com_;
    ComPtr<IMFTransform> transform_;
    ComPtr<IMFMediaType> output_type_;
    EncodedImageCallback* callback_ = nullptr;
    std::vector<uint8_t> sequence_header_;
    int width_ = 0;
    int height_ = 0;
    unsigned framerate_ = 15;
    unsigned bitrate_ = 400000;
};

class MediaFoundationDecoder final : public VideoDecoder {
public:
    explicit MediaFoundationDecoder(const SdpVideoFormat& format)
        : format_(format), com_() {}

    ~MediaFoundationDecoder() override {
        Release();
    }

    bool Configure(const Settings& settings) override {
        settings_ = settings;
        return true;
    }

    int32_t RegisterDecodeCompleteCallback(
        DecodedImageCallback* callback) override {
        callback_ = callback;
        return 0;
    }

    int32_t Release() override {
        if (transform_) {
            transform_->ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0);
            transform_->ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0);
        }
        output_type_.Reset();
        transform_.Reset();
        width_ = 0;
        height_ = 0;
        return 0;
    }

    int32_t Decode(const EncodedImage& input_image,
                   int64_t render_time_ms) override {
        if (!com_.usable() || !callback_ || !input_image.data() ||
            input_image.size() == 0)
            return -1;
        const int width = static_cast<int>(input_image._encodedWidth);
        const int height = static_cast<int>(input_image._encodedHeight);
        if (!transform_ || width != width_ || height != height_) {
            Release();
            if (!start_transform(width, height)) return -1;
        }
        auto annex_b = to_annex_b(input_image.data(), input_image.size());
        if (annex_b.empty()) return -1;
        auto sample = make_sample(annex_b.data(), annex_b.size());
        if (!sample) return -1;
        sample->SetSampleTime(static_cast<LONGLONG>(input_image.RtpTimestamp()) *
                              10'000'000 / 90'000);
        if (FAILED(transform_->ProcessInput(0, sample.Get(), 0))) return -1;
        MFT_OUTPUT_STREAM_INFO stream_info{};
        if (FAILED(transform_->GetOutputStreamInfo(0, &stream_info))) return -1;
        ComPtr<IMFSample> output_sample;
        if (!(stream_info.dwFlags & MFT_OUTPUT_STREAM_PROVIDES_SAMPLES)) {
            ComPtr<IMFMediaBuffer> output_buffer;
            const DWORD output_size = std::max<DWORD>(
                stream_info.cbSize,
                static_cast<DWORD>(width_ * height_ * 3 / 2));
            if (FAILED(MFCreateMemoryBuffer(output_size, &output_buffer)) ||
                FAILED(MFCreateSample(&output_sample)) ||
                FAILED(output_sample->AddBuffer(output_buffer.Get()))) return -1;
        }
        MFT_OUTPUT_DATA_BUFFER output{};
        output.dwStreamID = 0;
        output.pSample = output_sample.Get();
        DWORD status = 0;
        const auto result = transform_->ProcessOutput(0, 1, &output, &status);
        if (result == MF_E_TRANSFORM_NEED_MORE_INPUT) return 0;
        if (output.pEvents) output.pEvents->Release();
        if (FAILED(result) || !output.pSample) return -1;
        if (output.pSample != output_sample.Get())
            output_sample.Attach(output.pSample);
        ComPtr<IMFMediaBuffer> output_buffer;
        if (!extract_sample_buffer(output_sample.Get(), &output_buffer)) return -1;
        scoped_refptr<I420Buffer> frame;
        if (!copy_nv12_to_i420(output_buffer.Get(), width_, height_, &frame)) return -1;
        auto decoded = VideoFrame::Builder()
            .set_video_frame_buffer(frame)
            .set_rtp_timestamp(input_image.RtpTimestamp())
            .set_timestamp_us(render_time_ms * 1000)
            .build();
        callback_->Decoded(decoded, render_time_ms);
        return 0;
    }

    DecoderInfo GetDecoderInfo() const override {
        DecoderInfo info;
        info.implementation_name = "Media Foundation";
        info.is_hardware_accelerated = true;
        return info;
    }

private:
    bool start_transform(int width, int height) {
        if (!com_.usable() || width <= 0 || height <= 0) return false;
        MFT_REGISTER_TYPE_INFO input_info = {
            MFMediaType_Video, MFVideoFormat_H264};
        MFT_REGISTER_TYPE_INFO output_info = {
            MFMediaType_Video, MFVideoFormat_NV12};
        transform_ = create_hardware_decoder_transform(input_info, output_info);
        if (!transform_ || !configure_decoder_transform(
                transform_.Get(), width, height, &output_type_)) {
            transform_.Reset();
            return false;
        }
        width_ = width;
        height_ = height;
        transform_->ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0);
        transform_->ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0);
        return true;
    }

    SdpVideoFormat format_;
    Settings settings_;
    ComScope com_;
    ComPtr<IMFTransform> transform_;
    ComPtr<IMFMediaType> output_type_;
    DecodedImageCallback* callback_ = nullptr;
    int width_ = 0;
    int height_ = 0;
};

bool encoder_available_uncached() {
    ComScope com;
    if (!com.usable() || !dspeak_windows::ensure_media_foundation()) return false;
    MFT_REGISTER_TYPE_INFO input_info = {
        MFMediaType_Video, MFVideoFormat_NV12};
    MFT_REGISTER_TYPE_INFO output_info = {
        MFMediaType_Video, MFVideoFormat_H264};
    auto transform = create_hardware_transform(input_info, output_info);
    ComPtr<IMFMediaType> output_type;
    return transform && configure_encoder_transform(
        transform.Get(), 1920, 1080, 30, 4500000, &output_type);
}

bool decoder_available_uncached() {
    ComScope com;
    if (!com.usable() || !dspeak_windows::ensure_media_foundation()) return false;
    MFT_REGISTER_TYPE_INFO input_info = {
        MFMediaType_Video, MFVideoFormat_H264};
    MFT_REGISTER_TYPE_INFO output_info = {
        MFMediaType_Video, MFVideoFormat_NV12};
    auto transform = create_hardware_decoder_transform(input_info, output_info);
    ComPtr<IMFMediaType> output_type;
    return transform && configure_decoder_transform(
        transform.Get(), 1920, 1080, &output_type);
}

}

namespace dspeak_native {

bool media_foundation_encoder_available() {
    static std::once_flag once;
    static bool available = false;
    std::call_once(once, [] { available = encoder_available_uncached(); });
    return available;
}

bool media_foundation_decoder_available() {
    static std::once_flag once;
    static bool available = false;
    std::call_once(once, [] { available = decoder_available_uncached(); });
    return available;
}

std::unique_ptr<webrtc::VideoEncoder> create_media_foundation_encoder(
    const webrtc::Environment&,
    const webrtc::SdpVideoFormat& format) {
    if (!media_foundation_encoder_available() || format.name != "H264")
        return nullptr;
    return std::make_unique<MediaFoundationEncoder>(format);
}

std::unique_ptr<webrtc::VideoDecoder> create_media_foundation_decoder(
    const webrtc::Environment&,
    const webrtc::SdpVideoFormat& format) {
    if (!media_foundation_decoder_available() || format.name != "H264")
        return nullptr;
    return std::make_unique<MediaFoundationDecoder>(format);
}

}

#endif
