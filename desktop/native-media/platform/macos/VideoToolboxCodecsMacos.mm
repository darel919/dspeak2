#include "../../libdspeak_media/src/internal/platform_video_codec_factories.hpp"

#if defined(__APPLE__)

#include <VideoToolbox/VideoToolbox.h>

#include <api/video/encoded_image.h>
#include <api/video/i420_buffer.h>
#include <api/video/video_frame.h>
#include <api/video_codecs/video_codec.h>
#include <third_party/libyuv/include/libyuv/convert.h>
#include <third_party/libyuv/include/libyuv/convert_argb.h>

#include <algorithm>
#include <cstdint>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_set>
#include <utility>
#include <vector>

using namespace webrtc;

namespace {

struct EncodeContext {
    uint32_t rtp_timestamp = 0;
    int width = 0;
    int height = 0;
    bool key_frame = false;
    bool callback_completed = false;
    bool encode_returned = false;
};

struct H264ParameterSets {
    std::vector<uint8_t> sps;
    std::vector<uint8_t> pps;
};

void append_start_code(std::vector<uint8_t>& output) {
    output.insert(output.end(), {0, 0, 0, 1});
}

bool annex_b_nalus(const uint8_t* data,
                   size_t size,
                   std::vector<std::vector<uint8_t>>& nalus) {
    if (!data || size < 4) return false;
    size_t cursor = 0;
    while (cursor + 3 < size) {
        size_t start = std::string::npos;
        size_t prefix = 0;
        for (size_t index = cursor; index + 3 < size; ++index) {
            if (data[index] == 0 && data[index + 1] == 0 && data[index + 2] == 1) {
                start = index;
                prefix = 3;
                break;
            }
            if (index + 4 <= size && data[index] == 0 && data[index + 1] == 0 &&
                data[index + 2] == 0 && data[index + 3] == 1) {
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
        if (next + 3 >= size) next = size;
        if (next > payload_start)
            nalus.emplace_back(data + payload_start, data + next);
        cursor = next;
    }
    return !nalus.empty();
}

bool avcc_nalus(const uint8_t* data,
                size_t size,
                std::vector<std::vector<uint8_t>>& nalus) {
    size_t cursor = 0;
    while (cursor + 4 <= size) {
        const uint32_t length = (static_cast<uint32_t>(data[cursor]) << 24) |
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
    if (annex_b_nalus(data, size, nalus)) return true;
    nalus.clear();
    return avcc_nalus(data, size, nalus);
}

CVPixelBufferRef make_nv12_buffer(const webrtc::VideoFrame& frame) {
    const auto input = frame.video_frame_buffer()->ToI420();
    if (!input) return nullptr;
    const int width = input->width();
    const int height = input->height();
    if (width <= 0 || height <= 0) return nullptr;
    CVPixelBufferRef pixel_buffer = nullptr;
    const void* keys[] = {
        kCVPixelBufferIOSurfacePropertiesKey,
        kCVPixelBufferMetalCompatibilityKey,
    };
    const void* values[] = {nullptr, kCFBooleanTrue};
    CFDictionaryRef attributes = CFDictionaryCreate(
        kCFAllocatorDefault,
        keys,
        values,
        2,
        &kCFTypeDictionaryKeyCallBacks,
        &kCFTypeDictionaryValueCallBacks);
    const auto result = CVPixelBufferCreate(
        kCFAllocatorDefault,
        width,
        height,
        kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
        attributes,
        &pixel_buffer);
    if (attributes) CFRelease(attributes);
    if (result != kCVReturnSuccess || !pixel_buffer) return nullptr;
    if (CVPixelBufferLockBaseAddress(pixel_buffer, 0) != kCVReturnSuccess) {
        CFRelease(pixel_buffer);
        return nullptr;
    }
    const int convert_result = libyuv::I420ToNV12(
        input->DataY(), input->StrideY(),
        input->DataU(), input->StrideU(),
        input->DataV(), input->StrideV(),
        static_cast<uint8_t*>(CVPixelBufferGetBaseAddressOfPlane(pixel_buffer, 0)),
        static_cast<int>(CVPixelBufferGetBytesPerRowOfPlane(pixel_buffer, 0)),
        static_cast<uint8_t*>(CVPixelBufferGetBaseAddressOfPlane(pixel_buffer, 1)),
        static_cast<int>(CVPixelBufferGetBytesPerRowOfPlane(pixel_buffer, 1)),
        width,
        height);
    CVPixelBufferUnlockBaseAddress(pixel_buffer, 0);
    if (convert_result != 0) {
        CFRelease(pixel_buffer);
        return nullptr;
    }
    return pixel_buffer;
}

void set_number_property(VTSessionRef session,
                         CFStringRef key,
                         int32_t value) {
    CFNumberRef number = CFNumberCreate(kCFAllocatorDefault, kCFNumberSInt32Type, &value);
    if (number) {
        VTSessionSetProperty(session, key, number);
        CFRelease(number);
    }
}

class VideoToolboxEncoder final : public webrtc::VideoEncoder {
public:
    explicit VideoToolboxEncoder(const webrtc::SdpVideoFormat& format)
        : format_(format) {}

    ~VideoToolboxEncoder() override {
        Release();
    }

    int InitEncode(const webrtc::VideoCodec* codec_settings,
                   const Settings&) override {
        if (!codec_settings || codec_settings->width <= 0 || codec_settings->height <= 0)
            return -1;
        Release();
        width_ = codec_settings->width;
        height_ = codec_settings->height;
        framerate_ = std::max(1, static_cast<int>(codec_settings->maxFramerate));
        const void* keys[] = {
            kVTVideoEncoderSpecification_RequireHardwareAcceleratedVideoEncoder,
        };
        const void* values[] = {kCFBooleanTrue};
        CFDictionaryRef specification = CFDictionaryCreate(
            kCFAllocatorDefault,
            keys,
            values,
            1,
            &kCFTypeDictionaryKeyCallBacks,
            &kCFTypeDictionaryValueCallBacks);
        const OSStatus result = VTCompressionSessionCreate(
            kCFAllocatorDefault,
            width_,
            height_,
            kCMVideoCodecType_H264,
            specification,
            nullptr,
            nullptr,
            &VideoToolboxEncoder::output_callback,
            this,
            &session_);
        if (specification) CFRelease(specification);
        if (result != noErr || !session_) {
            session_ = nullptr;
            return -1;
        }
        VTSessionSetProperty(
            session_,
            kVTCompressionPropertyKey_RealTime,
            kCFBooleanTrue);
        VTSessionSetProperty(
            session_,
            kVTCompressionPropertyKey_AllowFrameReordering,
            kCFBooleanFalse);
        VTSessionSetProperty(
            session_,
            kVTCompressionPropertyKey_ProfileLevel,
            kVTProfileLevel_H264_Baseline_AutoLevel);
        set_number_property(
            session_, kVTCompressionPropertyKey_ExpectedFrameRate, framerate_);
        if (bitrate_bps_ > 0) set_bitrate(bitrate_bps_);
        VTCompressionSessionPrepareToEncodeFrames(session_);
        return 0;
    }

    int32_t RegisterEncodeCompleteCallback(
        EncodedImageCallback* callback) override {
        callback_ = callback;
        return 0;
    }

    int32_t Release() override {
        if (!session_) return 0;
        VTCompressionSessionCompleteFrames(session_, kCMTimeInvalid);
        VTCompressionSessionInvalidate(session_);
        CFRelease(session_);
        session_ = nullptr;
        std::lock_guard<std::mutex> lock(context_mutex_);
        for (auto* context : pending_contexts_) delete context;
        pending_contexts_.clear();
        return 0;
    }

    int32_t Encode(const webrtc::VideoFrame& frame,
                   const std::vector<VideoFrameType>* frame_types) override {
        try {
            if (!session_ || !callback_) return -1;
            const auto pixel_buffer = make_nv12_buffer(frame);
            if (!pixel_buffer) return -1;
            auto* context = new EncodeContext{
                frame.rtp_timestamp(),
                frame.width(),
                frame.height(),
                frame_types && !frame_types->empty() &&
                    (*frame_types)[0] == VideoFrameType::kVideoFrameKey,
            };
            {
                std::lock_guard<std::mutex> lock(context_mutex_);
                pending_contexts_.insert(context);
            }
            CFDictionaryRef properties = nullptr;
            if (context->key_frame) {
                const void* keys[] = {kVTEncodeFrameOptionKey_ForceKeyFrame};
                const void* values[] = {kCFBooleanTrue};
                properties = CFDictionaryCreate(
                    kCFAllocatorDefault,
                    keys,
                    values,
                    1,
                    &kCFTypeDictionaryKeyCallBacks,
                    &kCFTypeDictionaryValueCallBacks);
            }
            const OSStatus result = VTCompressionSessionEncodeFrame(
                session_,
                pixel_buffer,
                CMTimeMake(frame.rtp_timestamp(), 90000),
                CMTimeMake(1, std::max(1, framerate_)),
                properties,
                context,
                nullptr);
            if (properties) CFRelease(properties);
            CFRelease(pixel_buffer);
            mark_encode_returned(context, result == noErr);
            return result == noErr ? 0 : -1;
        } catch (...) {
            return -1;
        }
    }

    void SetRates(const RateControlParameters& parameters) override {
        const uint32_t bitrate = parameters.bitrate.get_sum_bps();
        if (bitrate == 0) return;
        bitrate_bps_ = static_cast<int32_t>(std::min<uint32_t>(bitrate, INT32_MAX));
        if (session_) set_bitrate(bitrate_bps_);
        if (parameters.framerate_fps > 0)
            framerate_ = std::max(1, static_cast<int>(parameters.framerate_fps));
    }

    EncoderInfo GetEncoderInfo() const override {
        EncoderInfo info;
        info.implementation_name = "VideoToolbox";
        info.is_hardware_accelerated = true;
        info.supports_native_handle = false;
        info.requested_resolution_alignment = 2;
        return info;
    }

private:
    void set_bitrate(int32_t bitrate) {
        set_number_property(session_, kVTCompressionPropertyKey_AverageBitRate, bitrate);
        int32_t limit = bitrate;
        CFNumberRef limit_number = CFNumberCreate(
            kCFAllocatorDefault, kCFNumberSInt32Type, &limit);
        int32_t duration = 1;
        CFNumberRef duration_number = CFNumberCreate(
            kCFAllocatorDefault, kCFNumberSInt32Type, &duration);
        const void* values[] = {limit_number, duration_number};
        CFArrayRef limits = CFArrayCreate(
            kCFAllocatorDefault,
            values,
            2,
            &kCFTypeArrayCallBacks);
        if (limits) {
            VTSessionSetProperty(
                session_, kVTCompressionPropertyKey_DataRateLimits, limits);
            CFRelease(limits);
        }
        if (limit_number) CFRelease(limit_number);
        if (duration_number) CFRelease(duration_number);
    }

    static void output_callback(void* refcon,
                                void* source_frame_refcon,
                                OSStatus status,
                                VTEncodeInfoFlags,
                                CMSampleBufferRef sample_buffer) {
        auto* encoder = static_cast<VideoToolboxEncoder*>(refcon);
        auto* context = static_cast<EncodeContext*>(source_frame_refcon);
        if (!encoder || !context) return;
        try {
            [&] {
                if (status != noErr || !sample_buffer || !encoder->callback_)
                    return;
                std::vector<uint8_t> encoded;
                const auto format = CMSampleBufferGetFormatDescription(sample_buffer);
                bool key_frame = context->key_frame;
                CFArrayRef attachments = CMSampleBufferGetSampleAttachmentsArray(sample_buffer, false);
                if (attachments && CFArrayGetCount(attachments) > 0) {
                    auto dictionary = static_cast<CFDictionaryRef>(
                        const_cast<void*>(CFArrayGetValueAtIndex(attachments, 0)));
                    const auto not_sync = static_cast<CFBooleanRef>(
                        CFDictionaryGetValue(dictionary, kCMSampleAttachmentKey_NotSync));
                    if (not_sync) key_frame = !CFBooleanGetValue(not_sync);
                }
                if (key_frame && format) {
                    size_t count = 0;
                    size_t parameter_size = 0;
                    int header_length = 0;
                    if (CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
                            format, 0, nullptr, &parameter_size, &count, &header_length) == noErr) {
                        for (size_t index = 0; index < count; ++index) {
                            const uint8_t* parameter = nullptr;
                            size_t length = 0;
                            if (CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
                                    format, index, &parameter, &length, nullptr, nullptr) != noErr)
                                continue;
                            append_start_code(encoded);
                            encoded.insert(encoded.end(), parameter, parameter + length);
                        }
                    }
                }
                CMBlockBufferRef block = CMSampleBufferGetDataBuffer(sample_buffer);
                if (!block) return;
                const size_t total_length = CMBlockBufferGetDataLength(block);
                if (total_length == 0) return;
                std::vector<uint8_t> block_data(total_length);
                if (CMBlockBufferCopyDataBytes(
                        block, 0, total_length, block_data.data()) != noErr)
                    return;
                size_t cursor = 0;
                while (cursor + 4 <= total_length) {
                    const uint32_t length =
                        (static_cast<uint32_t>(block_data[cursor]) << 24) |
                        (static_cast<uint32_t>(block_data[cursor + 1]) << 16) |
                        (static_cast<uint32_t>(block_data[cursor + 2]) << 8) |
                        static_cast<uint32_t>(block_data[cursor + 3]);
                    cursor += 4;
                    if (length == 0 || length > total_length - cursor) return;
                    append_start_code(encoded);
                    encoded.insert(
                        encoded.end(), block_data.data() + cursor,
                        block_data.data() + cursor + length);
                    cursor += length;
                }
                if (cursor != total_length || encoded.empty()) return;
                auto buffer = EncodedImageBuffer::Create(encoded.data(), encoded.size());
                if (!buffer) return;
                EncodedImage image;
                image.SetEncodedData(buffer);
                image.SetRtpTimestamp(context->rtp_timestamp);
                image._encodedWidth = context->width;
                image._encodedHeight = context->height;
                image.SetFrameType(key_frame ? VideoFrameType::kVideoFrameKey
                                             : VideoFrameType::kVideoFrameDelta);
                encoder->callback_->OnEncodedImage(image, nullptr);
            }();
        } catch (...) {}
        encoder->mark_callback_completed(context);
    }

    void mark_encode_returned(EncodeContext* context, bool success) {
        std::lock_guard<std::mutex> lock(context_mutex_);
        const auto found = pending_contexts_.find(context);
        if (found == pending_contexts_.end()) return;
        context->encode_returned = true;
        if (!success) context->callback_completed = true;
        if (context->callback_completed) {
            pending_contexts_.erase(found);
            delete context;
        }
    }

    void mark_callback_completed(EncodeContext* context) {
        std::lock_guard<std::mutex> lock(context_mutex_);
        const auto found = pending_contexts_.find(context);
        if (found == pending_contexts_.end()) return;
        context->callback_completed = true;
        if (context->encode_returned) {
            pending_contexts_.erase(found);
            delete context;
        }
    }

    webrtc::SdpVideoFormat format_;
    VTCompressionSessionRef session_ = nullptr;
    EncodedImageCallback* callback_ = nullptr;
    int width_ = 0;
    int height_ = 0;
    int framerate_ = 30;
    int32_t bitrate_bps_ = 0;
    std::mutex context_mutex_;
    std::unordered_set<EncodeContext*> pending_contexts_;
};

class VideoToolboxDecoder final : public webrtc::VideoDecoder {
public:
    explicit VideoToolboxDecoder(const webrtc::SdpVideoFormat& format)
        : format_(format) {}

    ~VideoToolboxDecoder() override {
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
        if (session_) {
            VTDecompressionSessionWaitForAsynchronousFrames(session_);
            VTDecompressionSessionInvalidate(session_);
            CFRelease(session_);
            session_ = nullptr;
        }
        if (format_description_) {
            CFRelease(format_description_);
            format_description_ = nullptr;
        }
        sps_.clear();
        pps_.clear();
        return 0;
    }

    int32_t Decode(const EncodedImage& input_image,
                   int64_t render_time_ms) override {
        if (!callback_ || !input_image.data() || input_image.size() == 0) return -1;
        std::vector<std::vector<uint8_t>> nalus;
        if (!parse_nalus(input_image.data(), input_image.size(), nalus)) return -1;
        H264ParameterSets parameters;
        std::vector<uint8_t> avcc;
        for (const auto& nalu : nalus) {
            if (nalu.empty()) continue;
            const uint8_t type = nalu[0] & 0x1f;
            if (type == 7) parameters.sps = nalu;
            if (type == 8) parameters.pps = nalu;
            const uint32_t length = static_cast<uint32_t>(nalu.size());
            avcc.push_back(static_cast<uint8_t>((length >> 24) & 0xff));
            avcc.push_back(static_cast<uint8_t>((length >> 16) & 0xff));
            avcc.push_back(static_cast<uint8_t>((length >> 8) & 0xff));
            avcc.push_back(static_cast<uint8_t>(length & 0xff));
            avcc.insert(avcc.end(), nalu.begin(), nalu.end());
        }
        if (!parameters.sps.empty()) sps_ = std::move(parameters.sps);
        if (!parameters.pps.empty()) pps_ = std::move(parameters.pps);
        if (avcc.empty() || !ensure_session()) return -1;
        CMBlockBufferRef block = nullptr;
        if (CMBlockBufferCreateWithMemoryBlock(
                kCFAllocatorDefault,
                nullptr,
                avcc.size(),
                kCFAllocatorDefault,
                nullptr,
                0,
                avcc.size(),
                0,
                &block) != kCMBlockBufferNoErr)
            return -1;
        if (CMBlockBufferReplaceDataBytes(avcc.data(), block, 0, avcc.size()) != noErr) {
            CFRelease(block);
            return -1;
        }
        CMSampleBufferRef sample = nullptr;
        const size_t sample_size = avcc.size();
        const CMTime timestamp = CMTimeMake(input_image.RtpTimestamp(), 90000);
        const CMSampleTimingInfo timing = {
            CMTimeMake(1, 90000),
            timestamp,
            kCMTimeInvalid,
        };
        if (CMSampleBufferCreate(
                kCFAllocatorDefault,
                block,
                true,
                nullptr,
                nullptr,
                format_description_,
                1,
                1,
                &timing,
                1,
                &sample_size,
                &sample) != noErr) {
            CFRelease(block);
            return -1;
        }
        VTDecodeFrameFlags flags = kVTDecodeFrame_EnableAsynchronousDecompression;
        const auto result = VTDecompressionSessionDecodeFrame(
            session_, sample, flags, this, nullptr);
        CFRelease(sample);
        CFRelease(block);
        return result == noErr ? 0 : -1;
    }

    DecoderInfo GetDecoderInfo() const override {
        DecoderInfo info;
        info.implementation_name = "VideoToolbox";
        info.is_hardware_accelerated = true;
        return info;
    }

private:
    bool ensure_session() {
        if (session_) return true;
        if (sps_.empty() || pps_.empty()) return false;
        const uint8_t* parameter_sets[] = {sps_.data(), pps_.data()};
        size_t parameter_sizes[] = {sps_.size(), pps_.size()};
        if (CMVideoFormatDescriptionCreateFromH264ParameterSets(
                kCFAllocatorDefault,
                2,
                parameter_sets,
                parameter_sizes,
                4,
                &format_description_) != noErr)
            return false;
        VTDecompressionOutputCallbackRecord callback_record = {
            &VideoToolboxDecoder::output_callback,
            this,
        };
        const void* keys[] = {
            kVTVideoDecoderSpecification_RequireHardwareAcceleratedVideoDecoder,
        };
        const void* values[] = {kCFBooleanTrue};
        CFDictionaryRef specification = CFDictionaryCreate(
            kCFAllocatorDefault,
            keys,
            values,
            1,
            &kCFTypeDictionaryKeyCallBacks,
            &kCFTypeDictionaryValueCallBacks);
        const auto result = VTDecompressionSessionCreate(
            kCFAllocatorDefault,
            format_description_,
            specification,
            nullptr,
            &callback_record,
            &session_);
        if (specification) CFRelease(specification);
        if (result != noErr || !session_) {
            session_ = nullptr;
            CFRelease(format_description_);
            format_description_ = nullptr;
            return false;
        }
        return true;
    }

    static void output_callback(void* refcon,
                                void*,
                                OSStatus status,
                                VTDecodeInfoFlags,
                                CVImageBufferRef image_buffer,
                                CMTime presentation_time_stamp,
                                CMTime) {
        auto* decoder = static_cast<VideoToolboxDecoder*>(refcon);
        if (!decoder || status != noErr || !image_buffer || !decoder->callback_) return;
        if (CVPixelBufferLockBaseAddress(image_buffer, kCVPixelBufferLock_ReadOnly) !=
            kCVReturnSuccess)
            return;
        const int width = static_cast<int>(CVPixelBufferGetWidth(image_buffer));
        const int height = static_cast<int>(CVPixelBufferGetHeight(image_buffer));
        auto output = webrtc::I420Buffer::Create(width, height);
        int result = -1;
        if (CVPixelBufferGetPlaneCount(image_buffer) >= 2) {
            result = libyuv::NV12ToI420(
                static_cast<const uint8_t*>(CVPixelBufferGetBaseAddressOfPlane(image_buffer, 0)),
                static_cast<int>(CVPixelBufferGetBytesPerRowOfPlane(image_buffer, 0)),
                static_cast<const uint8_t*>(CVPixelBufferGetBaseAddressOfPlane(image_buffer, 1)),
                static_cast<int>(CVPixelBufferGetBytesPerRowOfPlane(image_buffer, 1)),
                output->MutableDataY(), output->StrideY(),
                output->MutableDataU(), output->StrideU(),
                output->MutableDataV(), output->StrideV(),
                width,
                height);
        }
        CVPixelBufferUnlockBaseAddress(image_buffer, kCVPixelBufferLock_ReadOnly);
        if (result != 0) return;
        const int64_t timestamp_us = presentation_time_stamp.timescale
            ? CMTimeGetSeconds(presentation_time_stamp) * 1000000.0
            : 0;
        auto frame = webrtc::VideoFrame::Builder()
            .set_video_frame_buffer(output)
            .set_timestamp_us(timestamp_us)
            .build();
        decoder->callback_->Decoded(frame);
    }

    webrtc::SdpVideoFormat format_;
    webrtc::VideoDecoder::Settings settings_;
    VTDecompressionSessionRef session_ = nullptr;
    CMVideoFormatDescriptionRef format_description_ = nullptr;
    DecodedImageCallback* callback_ = nullptr;
    std::vector<uint8_t> sps_;
    std::vector<uint8_t> pps_;
};

}

namespace dspeak_native {

void decoder_probe_callback(void*,
                            void*,
                            OSStatus,
                            VTDecodeInfoFlags,
                            CVImageBufferRef,
                            CMTime,
                            CMTime) {}

bool probe_hardware_decoder() {
    if (!VTIsHardwareDecodeSupported(kCMVideoCodecType_H264)) return false;
    const uint8_t sps[] = {
        0x67, 0x42, 0x00, 0x1e, 0xe9, 0x01, 0x40, 0x7b,
        0x20, 0x11, 0x00, 0x00, 0x03, 0x00, 0x01, 0x00,
        0x00, 0x03, 0x00, 0x32,
    };
    const uint8_t pps[] = {0x68, 0xce, 0x3c, 0x80};
    const uint8_t* parameter_sets[] = {sps, pps};
    const size_t parameter_sizes[] = {sizeof(sps), sizeof(pps)};
    CMVideoFormatDescriptionRef format_description = nullptr;
    if (CMVideoFormatDescriptionCreateFromH264ParameterSets(
            kCFAllocatorDefault,
            2,
            parameter_sets,
            parameter_sizes,
            4,
            &format_description) != noErr ||
        !format_description)
        return false;
    const void* keys[] = {
        kVTVideoDecoderSpecification_RequireHardwareAcceleratedVideoDecoder,
    };
    const void* values[] = {kCFBooleanTrue};
    CFDictionaryRef specification = CFDictionaryCreate(
        kCFAllocatorDefault,
        keys,
        values,
        1,
        &kCFTypeDictionaryKeyCallBacks,
        &kCFTypeDictionaryValueCallBacks);
    VTDecompressionOutputCallbackRecord callback_record = {
        &decoder_probe_callback,
        nullptr,
    };
    VTDecompressionSessionRef session = nullptr;
    const auto result = VTDecompressionSessionCreate(
        kCFAllocatorDefault,
        format_description,
        specification,
        nullptr,
        &callback_record,
        &session);
    if (specification) CFRelease(specification);
    CFRelease(format_description);
    if (result != noErr || !session) return false;
    VTDecompressionSessionInvalidate(session);
    CFRelease(session);
    return true;
}

bool video_toolbox_encoder_available() {
    static std::once_flag once;
    static bool available = false;
    std::call_once(once, [] {
        VTCompressionSessionRef session = nullptr;
        const void* keys[] = {
            kVTVideoEncoderSpecification_RequireHardwareAcceleratedVideoEncoder,
        };
        const void* values[] = {kCFBooleanTrue};
        CFDictionaryRef specification = CFDictionaryCreate(
            kCFAllocatorDefault,
            keys,
            values,
            1,
            &kCFTypeDictionaryKeyCallBacks,
            &kCFTypeDictionaryValueCallBacks);
        const auto result = VTCompressionSessionCreate(
            kCFAllocatorDefault,
            1920,
            1080,
            kCMVideoCodecType_H264,
            specification,
            nullptr,
            nullptr,
            nullptr,
            nullptr,
            &session);
        if (specification) CFRelease(specification);
        if (result != noErr || !session) return;
        VTCompressionSessionInvalidate(session);
        CFRelease(session);
        available = true;
    });
    return available;
}

bool video_toolbox_decoder_available() {
    static std::once_flag once;
    static bool available = false;
    std::call_once(once, [] { available = probe_hardware_decoder(); });
    return available;
}

std::unique_ptr<webrtc::VideoEncoder> create_video_toolbox_encoder(
    const webrtc::Environment&,
    const webrtc::SdpVideoFormat& format) {
    if (!video_toolbox_encoder_available() || format.name != "H264") return nullptr;
    return std::make_unique<VideoToolboxEncoder>(format);
}

std::unique_ptr<webrtc::VideoDecoder> create_video_toolbox_decoder(
    const webrtc::Environment&,
    const webrtc::SdpVideoFormat& format) {
    if (!video_toolbox_decoder_available() || format.name != "H264") return nullptr;
    return std::make_unique<VideoToolboxDecoder>(format);
}

}

#endif
