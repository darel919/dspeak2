#include "platform_video_codec_factories.hpp"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdint>
#include <condition_variable>
#include <mutex>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include <api/environment/environment_factory.h>
#include <api/video/i420_buffer.h>
#include <api/video/video_frame.h>
#include <api/video/video_frame_type.h>
#include <api/video/video_codec_type.h>
#include <api/video_codecs/video_decoder.h>
#include <api/video_codecs/video_encoder.h>
#include <api/video_codecs/video_decoder_factory_template.h>
#include <api/video_codecs/video_decoder_factory_template_libvpx_vp8_adapter.h>
#include <api/video_codecs/video_decoder_factory_template_libvpx_vp9_adapter.h>
#include <api/video_codecs/video_decoder_factory_template_open_h264_adapter.h>
#include <api/video_codecs/video_encoder_factory_template.h>
#include <api/video_codecs/video_encoder_factory_template_libvpx_vp8_adapter.h>
#include <api/video_codecs/video_encoder_factory_template_libvpx_vp9_adapter.h>
#include <api/video_codecs/video_encoder_factory_template_open_h264_adapter.h>

namespace dspeak_native {

#if defined(__APPLE__)
std::unique_ptr<webrtc::VideoEncoder> create_video_toolbox_encoder(
    const webrtc::Environment& environment,
    const webrtc::SdpVideoFormat& format);
std::unique_ptr<webrtc::VideoDecoder> create_video_toolbox_decoder(
    const webrtc::Environment& environment,
    const webrtc::SdpVideoFormat& format);
bool video_toolbox_encoder_available();
bool video_toolbox_decoder_available();
#endif

#if defined(_WIN32)
bool media_foundation_encoder_available();
bool media_foundation_decoder_available();
std::unique_ptr<webrtc::VideoEncoder> create_media_foundation_encoder(
    const webrtc::Environment& environment,
    const webrtc::SdpVideoFormat& format);
std::unique_ptr<webrtc::VideoDecoder> create_media_foundation_decoder(
    const webrtc::Environment& environment,
    const webrtc::SdpVideoFormat& format);
#endif

namespace {

std::mutex g_diagnostics_mutex;
std::string g_active_encoder_implementation = "not-created";
std::string g_active_decoder_implementation = "not-created";
bool g_active_hardware_encoder = false;
bool g_active_hardware_decoder = false;
uint64_t g_encoder_creations = 0;
uint64_t g_decoder_creations = 0;
std::mutex g_runtime_probe_mutex;
bool g_runtime_probe_complete = false;
std::map<std::string, VideoCodecRuntimeDiagnostics> g_runtime_codecs;
bool g_concurrent_hardware_sessions_tested = false;
int g_max_hardware_encode_sessions = 0;
std::vector<std::pair<std::string, std::string>> g_tested_codec_pairs;

void record_encoder(const std::string& implementation, bool hardware) {
    std::lock_guard<std::mutex> lock(g_diagnostics_mutex);
    g_active_encoder_implementation = implementation;
    g_active_hardware_encoder = hardware;
    ++g_encoder_creations;
}

void record_decoder(const std::string& implementation, bool hardware) {
    std::lock_guard<std::mutex> lock(g_diagnostics_mutex);
    g_active_decoder_implementation = implementation;
    g_active_hardware_decoder = hardware;
    ++g_decoder_creations;
}

class ProbeEncodedCallback final : public webrtc::EncodedImageCallback {
public:
    Result OnEncodedImage(
        const webrtc::EncodedImage& encoded_image,
        const webrtc::CodecSpecificInfo*) override {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!encoded_image.GetEncodedData() || encoded_image.size() == 0) {
            failed_ = true;
            condition_.notify_all();
            return Result(Result::ERROR_SEND_FAILED);
        }
        encoded_image_ = encoded_image;
        encoded_ = true;
        condition_.notify_all();
        return Result(Result::OK);
    }

    bool Wait(std::chrono::milliseconds timeout) {
        std::unique_lock<std::mutex> lock(mutex_);
        condition_.wait_for(lock, timeout, [this] { return encoded_ || failed_; });
        return encoded_ && !failed_;
    }

    webrtc::EncodedImage image() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return encoded_image_;
    }

private:
    mutable std::mutex mutex_;
    std::condition_variable condition_;
    webrtc::EncodedImage encoded_image_;
    bool encoded_ = false;
    bool failed_ = false;
};

class ProbeDecodedCallback final : public webrtc::DecodedImageCallback {
public:
    int32_t Decoded(webrtc::VideoFrame& frame) override {
        std::lock_guard<std::mutex> lock(mutex_);
        width_ = frame.width();
        height_ = frame.height();
        decoded_ = width_ > 0 && height_ > 0;
        condition_.notify_all();
        return decoded_ ? 0 : -1;
    }

    bool Wait(std::chrono::milliseconds timeout) {
        std::unique_lock<std::mutex> lock(mutex_);
        condition_.wait_for(lock, timeout, [this] { return decoded_; });
        return decoded_;
    }

private:
    std::mutex mutex_;
    std::condition_variable condition_;
    int width_ = 0;
    int height_ = 0;
    bool decoded_ = false;
};

std::string uppercase(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char character) {
        return static_cast<char>(std::toupper(character));
    });
    return value;
}

std::optional<webrtc::SdpVideoFormat> find_format(
    const std::vector<webrtc::SdpVideoFormat>& formats,
    const std::string& codec) {
    const auto wanted = uppercase(codec);
    for (const auto& format : formats)
        if (uppercase(format.name) == wanted) return format;
    return std::nullopt;
}

std::optional<webrtc::VideoCodecType> codec_type(const std::string& codec) {
    const auto value = uppercase(codec);
    if (value == "VP8") return webrtc::kVideoCodecVP8;
    if (value == "VP9") return webrtc::kVideoCodecVP9;
    if (value == "AV1") return webrtc::kVideoCodecAV1;
    if (value == "H264") return webrtc::kVideoCodecH264;
    if (value == "H265") return webrtc::kVideoCodecH265;
    return std::nullopt;
}

std::vector<webrtc::SdpVideoFormat> native_h264_formats() {
    return {
        webrtc::SdpVideoFormat(
            "H264",
            {{"level-asymmetry-allowed", "1"},
             {"packetization-mode", "1"},
             {"profile-level-id", "42e01f"}}),
    };
}

webrtc::VideoCodec make_codec_settings(
    webrtc::VideoCodecType type,
    int width,
    int height,
    int fps) {
    webrtc::VideoCodec settings;
    settings.codecType = type;
    settings.width = static_cast<uint16_t>(width);
    settings.height = static_cast<uint16_t>(height);
    const auto pixels_per_second = static_cast<int64_t>(width) * height * fps;
    const auto start_bitrate = std::clamp<int64_t>(
        pixels_per_second / 300'000, 800, 12'000);
    settings.startBitrate = static_cast<int>(start_bitrate);
    settings.maxBitrate = static_cast<int>(std::clamp<int64_t>(
        start_bitrate * 2, 1'200, 24'000));
    settings.minBitrate = std::min<uint32_t>(300, settings.startBitrate);
    settings.maxFramerate = static_cast<uint32_t>(fps);
    settings.active = true;
    settings.numberOfSimulcastStreams = 1;
    settings.qpMax = 56;
    settings.mode = webrtc::VideoCodecMode::kRealtimeVideo;
    settings.SetFrameDropEnabled(false);
    if (type == webrtc::kVideoCodecVP8) {
        settings.VP8()->numberOfTemporalLayers = 1;
        settings.VP8()->keyFrameInterval = 1;
    } else if (type == webrtc::kVideoCodecVP9) {
        settings.VP9()->numberOfTemporalLayers = 1;
        settings.VP9()->numberOfSpatialLayers = 1;
        settings.VP9()->keyFrameInterval = 1;
    } else if (type == webrtc::kVideoCodecH264) {
        settings.H264()->numberOfTemporalLayers = 1;
        settings.H264()->keyFrameInterval = 1;
    } else if (type == webrtc::kVideoCodecAV1) {
        settings.AV1()->automatic_resize_on = false;
    }
    return settings;
}

webrtc::VideoFrame make_probe_frame(int width, int height) {
    auto buffer = webrtc::I420Buffer::Create(width, height);
    for (int row = 0; row < height; ++row)
        std::fill(buffer->MutableDataY() + row * buffer->StrideY(),
                  buffer->MutableDataY() + row * buffer->StrideY() + width,
                  static_cast<uint8_t>(row % 2 ? 96 : 160));
    for (int row = 0; row < (height + 1) / 2; ++row) {
        std::fill(buffer->MutableDataU() + row * buffer->StrideU(),
                  buffer->MutableDataU() + row * buffer->StrideU() + (width + 1) / 2,
                  static_cast<uint8_t>(96));
        std::fill(buffer->MutableDataV() + row * buffer->StrideV(),
                  buffer->MutableDataV() + row * buffer->StrideV() + (width + 1) / 2,
                  static_cast<uint8_t>(160));
    }
    return webrtc::VideoFrame::Builder()
        .set_video_frame_buffer(buffer)
        .set_timestamp_us(1'000'000)
        .set_rotation(webrtc::kVideoRotation_0)
        .build();
}

bool probe_encoder(
    webrtc::VideoEncoderFactory* factory,
    const std::string& codec,
    int width,
    int height,
    int fps,
    webrtc::EncodedImage* encoded_image,
    VideoCodecRuntimeDiagnostics* result) {
    const auto type = codec_type(codec);
    const auto format = find_format(factory->GetSupportedFormats(), codec);
    if (!type || !format) {
        result->encoder_failure = "encoder factory does not expose codec";
        return false;
    }
    auto encoder = factory->Create(webrtc::CreateEnvironment(), *format);
    if (!encoder) {
        result->encoder_failure = "encoder factory returned no instance";
        return false;
    }
    auto settings = make_codec_settings(*type, width, height, fps);
    webrtc::VideoEncoder::Settings encoder_settings(
        webrtc::VideoEncoder::Capabilities(false), 1, 1200);
    if (encoder->InitEncode(&settings, encoder_settings) < 0) {
        result->encoder_failure = "encoder initialization failed";
        encoder->Release();
        return false;
    }
    ProbeEncodedCallback callback;
    if (encoder->RegisterEncodeCompleteCallback(&callback) < 0) {
        result->encoder_failure = "encoder callback registration failed";
        encoder->Release();
        return false;
    }
    webrtc::VideoBitrateAllocation allocation;
    allocation.SetBitrate(
        0, 0, static_cast<uint32_t>(settings.startBitrate) * 1000);
    encoder->SetRates(webrtc::VideoEncoder::RateControlParameters(allocation, fps));
    const auto frame = make_probe_frame(width, height);
    const std::vector<webrtc::VideoFrameType> frame_types = {
        webrtc::VideoFrameType::kVideoFrameKey};
    const int encode_result = encoder->Encode(frame, &frame_types);
    const bool received = encode_result >= 0 && callback.Wait(std::chrono::milliseconds(1500));
    const auto info = encoder->GetEncoderInfo();
    result->encoder_implementation = info.implementation_name.empty()
        ? "unknown"
        : info.implementation_name;
    result->encoder_hardware = info.is_hardware_accelerated;
    if (!received) {
        result->encoder_failure = encode_result < 0
            ? "encoder rejected validation frame"
            : "encoder produced no validation frame";
        encoder->Release();
        return false;
    }
    *encoded_image = callback.image();
    result->encoder_supported = true;
    result->encoder_frame_validated = true;
    result->encoder_tested_width = width;
    result->encoder_tested_height = height;
    result->encoder_tested_fps = fps;
    encoder->Release();
    return true;
}

bool probe_decoder(
    webrtc::VideoDecoderFactory* factory,
    const std::string& codec,
    int width,
    int height,
    int fps,
    const webrtc::EncodedImage* encoded_image,
    VideoCodecRuntimeDiagnostics* result) {
    const auto type = codec_type(codec);
    const auto format = find_format(factory->GetSupportedFormats(), codec);
    if (!type || !format) {
        result->decoder_failure = "decoder factory does not expose codec";
        return false;
    }
    auto decoder = factory->Create(webrtc::CreateEnvironment(), *format);
    if (!decoder) {
        result->decoder_failure = "decoder factory returned no instance";
        return false;
    }
    webrtc::VideoDecoder::Settings decoder_settings;
    decoder_settings.set_codec_type(*type);
    decoder_settings.set_number_of_cores(1);
    if (!decoder->Configure(decoder_settings)) {
        result->decoder_failure = "decoder initialization failed";
        decoder->Release();
        return false;
    }
    result->decoder_configured = true;
    ProbeDecodedCallback callback;
    if (decoder->RegisterDecodeCompleteCallback(&callback) < 0) {
        result->decoder_failure = "decoder callback registration failed";
        decoder->Release();
        return false;
    }
    const auto info = decoder->GetDecoderInfo();
    result->decoder_implementation = info.implementation_name.empty()
        ? "unknown"
        : info.implementation_name;
    result->decoder_hardware = info.is_hardware_accelerated;
    if (!encoded_image || !encoded_image->GetEncodedData() || encoded_image->size() == 0) {
        result->decoder_failure = "decoder validation frame unavailable";
        result->decoder_supported = true;
        decoder->Release();
        return true;
    }
    const int decode_result = decoder->Decode(*encoded_image, 0);
    const bool received = decode_result >= 0 && callback.Wait(std::chrono::milliseconds(1500));
    const auto validated_info = decoder->GetDecoderInfo();
    result->decoder_implementation = validated_info.implementation_name.empty()
        ? "unknown"
        : validated_info.implementation_name;
    result->decoder_hardware = validated_info.is_hardware_accelerated;
    if (!received) {
        result->decoder_failure = decode_result < 0
            ? "decoder rejected validation frame"
            : "decoder produced no validation frame";
        result->decoder_supported = false;
        decoder->Release();
        return false;
    }
    result->decoder_supported = true;
    result->decoder_frame_validated = true;
    result->decoder_tested_width = width;
    result->decoder_tested_height = height;
    result->decoder_tested_fps = fps;
    decoder->Release();
    return true;
}

struct ProbeTarget {
    int width;
    int height;
    int fps;
};

static bool profile_is_better(
    int width,
    int height,
    int fps,
    int current_width,
    int current_height,
    int current_fps) {
    const auto pixels = static_cast<int64_t>(width) * height;
    const auto current_pixels =
        static_cast<int64_t>(current_width) * current_height;
    return pixels > current_pixels ||
        (pixels == current_pixels && fps > current_fps);
}

static std::string probe_profile(
    const std::string& codec,
    int width,
    int height,
    int fps,
    bool hardware) {
    return codec + " / " + std::to_string(width) + "x" +
        std::to_string(height) + "@" + std::to_string(fps) +
        (hardware ? " (hardware)" : " (software)");
}

static void merge_encoder_probe(
    const std::string& codec,
    const VideoCodecRuntimeDiagnostics& attempt,
    VideoCodecRuntimeDiagnostics* result) {
    if (!attempt.encoder_frame_validated) {
        if (!attempt.encoder_failure.empty())
            result->encoder_failure = attempt.encoder_failure;
        return;
    }
    const bool has_current = result->encoder_frame_validated;
    const bool prefer_attempt =
        !has_current ||
        (attempt.encoder_hardware && !result->encoder_hardware) ||
        (attempt.encoder_hardware == result->encoder_hardware &&
         profile_is_better(
             attempt.encoder_tested_width,
             attempt.encoder_tested_height,
             attempt.encoder_tested_fps,
             result->encoder_tested_width,
             result->encoder_tested_height,
             result->encoder_tested_fps));
    result->encoder_supported = true;
    if (prefer_attempt) {
        result->encoder_frame_validated = true;
        result->encoder_hardware = attempt.encoder_hardware;
        result->encoder_implementation = attempt.encoder_implementation;
        result->encoder_tested_width = attempt.encoder_tested_width;
        result->encoder_tested_height = attempt.encoder_tested_height;
        result->encoder_tested_fps = attempt.encoder_tested_fps;
    }
    result->encoder_failure.clear();
    result->encoder_tested_profiles.push_back(probe_profile(
        codec,
        attempt.encoder_tested_width,
        attempt.encoder_tested_height,
        attempt.encoder_tested_fps,
        attempt.encoder_hardware));
}

static void merge_decoder_probe(
    const std::string& codec,
    const VideoCodecRuntimeDiagnostics& attempt,
    VideoCodecRuntimeDiagnostics* result) {
    result->decoder_configured =
        result->decoder_configured || attempt.decoder_configured;
    if (attempt.decoder_supported && !attempt.decoder_frame_validated) {
        result->decoder_supported = true;
        if (!result->decoder_frame_validated) {
            result->decoder_hardware = attempt.decoder_hardware;
            result->decoder_implementation = attempt.decoder_implementation;
        }
    }
    if (!attempt.decoder_frame_validated) {
        if (!attempt.decoder_failure.empty())
            result->decoder_failure = attempt.decoder_failure;
        return;
    }
    const bool has_current = result->decoder_frame_validated;
    const bool prefer_attempt =
        !has_current ||
        (attempt.decoder_hardware && !result->decoder_hardware) ||
        (attempt.decoder_hardware == result->decoder_hardware &&
         profile_is_better(
             attempt.decoder_tested_width,
             attempt.decoder_tested_height,
             attempt.decoder_tested_fps,
             result->decoder_tested_width,
             result->decoder_tested_height,
             result->decoder_tested_fps));
    result->decoder_supported = true;
    if (prefer_attempt) {
        result->decoder_frame_validated = true;
        result->decoder_hardware = attempt.decoder_hardware;
        result->decoder_implementation = attempt.decoder_implementation;
        result->decoder_tested_width = attempt.decoder_tested_width;
        result->decoder_tested_height = attempt.decoder_tested_height;
        result->decoder_tested_fps = attempt.decoder_tested_fps;
    }
    result->decoder_failure.clear();
    result->decoder_tested_profiles.push_back(probe_profile(
        codec,
        attempt.decoder_tested_width,
        attempt.decoder_tested_height,
        attempt.decoder_tested_fps,
        attempt.decoder_hardware));
}

std::unique_ptr<webrtc::VideoEncoder> create_initialized_hardware_encoder(
    webrtc::VideoEncoderFactory* factory,
    const std::string& codec,
    const VideoCodecRuntimeDiagnostics& runtime) {
    const auto type = codec_type(codec);
    const auto format = find_format(factory->GetSupportedFormats(), codec);
    if (!type || !format) return nullptr;
    auto encoder = factory->Create(webrtc::CreateEnvironment(), *format);
    if (!encoder) return nullptr;
    const int width = runtime.encoder_tested_width > 0
        ? runtime.encoder_tested_width
        : 640;
    const int height = runtime.encoder_tested_height > 0
        ? runtime.encoder_tested_height
        : 360;
    const int fps = runtime.encoder_tested_fps > 0
        ? runtime.encoder_tested_fps
        : 15;
    auto settings = make_codec_settings(*type, width, height, fps);
    webrtc::VideoEncoder::Settings encoder_settings(
        webrtc::VideoEncoder::Capabilities(false), 1, 1200);
    if (encoder->InitEncode(&settings, encoder_settings) < 0 ||
        !encoder->GetEncoderInfo().is_hardware_accelerated) {
        encoder->Release();
        return nullptr;
    }
    return encoder;
}

void probe_concurrent_hardware_sessions(webrtc::VideoEncoderFactory* factory) {
    g_concurrent_hardware_sessions_tested = false;
    g_max_hardware_encode_sessions = 0;
    g_tested_codec_pairs.clear();
    if (!factory) return;
    std::vector<std::string> hardware_codecs;
    for (const auto& [codec, runtime] : g_runtime_codecs)
        if (runtime.encoder_supported && runtime.encoder_hardware)
            hardware_codecs.push_back(codec);
    if (hardware_codecs.empty()) {
        g_concurrent_hardware_sessions_tested = true;
        return;
    }
    for (size_t index = 0; index < hardware_codecs.size(); ++index)
        for (size_t next = index + 1; next < hardware_codecs.size(); ++next) {
            const auto left = g_runtime_codecs.find(hardware_codecs[index]);
            const auto right = g_runtime_codecs.find(hardware_codecs[next]);
            if (left == g_runtime_codecs.end() || right == g_runtime_codecs.end())
                continue;
            auto first = create_initialized_hardware_encoder(
                factory, left->first, left->second);
            auto second = create_initialized_hardware_encoder(
                factory, right->first, right->second);
            if (first && second)
                g_tested_codec_pairs.emplace_back(left->first, right->first);
            if (first) first->Release();
            if (second) second->Release();
        }
    constexpr size_t max_probe_sessions = 4;
    for (const auto& codec : hardware_codecs) {
        const auto found = g_runtime_codecs.find(codec);
        if (found == g_runtime_codecs.end()) continue;
        for (size_t count = 1; count <= max_probe_sessions; ++count) {
            std::vector<std::unique_ptr<webrtc::VideoEncoder>> encoders;
            bool all_initialized = true;
            for (size_t index = 0; index < count; ++index) {
                auto encoder = create_initialized_hardware_encoder(
                    factory, found->first, found->second);
                if (!encoder) {
                    all_initialized = false;
                    break;
                }
                encoders.push_back(std::move(encoder));
            }
            for (auto& encoder : encoders) encoder->Release();
            if (!all_initialized) break;
            g_max_hardware_encode_sessions = std::max(
                g_max_hardware_encode_sessions,
                static_cast<int>(count));
            if (count == 2)
                g_tested_codec_pairs.emplace_back(codec, codec);
        }
    }
    g_concurrent_hardware_sessions_tested = true;
}

void run_runtime_probe() {
    std::lock_guard<std::mutex> probe_lock(g_runtime_probe_mutex);
    if (g_runtime_probe_complete) return;
    g_runtime_codecs.clear();
    const std::vector<std::string> codec_names = {"H264", "H265", "VP8", "VP9", "AV1"};
    auto encoder_factory = create_video_encoder_factory();
    auto decoder_factory = create_video_decoder_factory();
    for (const auto& codec : codec_names) {
        VideoCodecRuntimeDiagnostics result;
        const bool hardware_hint =
#if defined(__APPLE__)
            codec == "H264" && video_toolbox_encoder_available();
#elif defined(_WIN32)
            codec == "H264" && media_foundation_encoder_available();
#else
            false;
#endif
        const std::vector<ProbeTarget> targets = hardware_hint
            ? std::vector<ProbeTarget>{
                  {1920, 1080, 30},
                  {1920, 1080, 60},
                  {2560, 1440, 30},
                  {2560, 1440, 60},
                  {3840, 2160, 30},
                  {3840, 2160, 60},
              }
            : std::vector<ProbeTarget>{{640, 360, 15}};
        for (const auto& target : targets) {
            VideoCodecRuntimeDiagnostics attempt;
            webrtc::EncodedImage encoded_image;
            if (!encoder_factory) {
                attempt.encoder_failure = "video encoder factory unavailable";
            } else {
                probe_encoder(
                    encoder_factory.get(),
                    codec,
                    target.width,
                    target.height,
                    target.fps,
                    &encoded_image,
                    &attempt);
            }
            merge_encoder_probe(codec, attempt, &result);
            if (!decoder_factory) {
                attempt.decoder_failure = "video decoder factory unavailable";
            } else {
                probe_decoder(
                    decoder_factory.get(),
                    codec,
                    target.width,
                    target.height,
                    target.fps,
                    &encoded_image,
                    &attempt);
            }
            merge_decoder_probe(codec, attempt, &result);
        }
        g_runtime_codecs.emplace(codec, std::move(result));
    }
    probe_concurrent_hardware_sessions(encoder_factory.get());
    g_runtime_probe_complete = true;
}

}

using SoftwareEncoderFactory = webrtc::VideoEncoderFactoryTemplate<
    webrtc::LibvpxVp8EncoderTemplateAdapter,
    webrtc::LibvpxVp9EncoderTemplateAdapter,
    webrtc::OpenH264EncoderTemplateAdapter>;

using SoftwareDecoderFactory = webrtc::VideoDecoderFactoryTemplate<
    webrtc::LibvpxVp8DecoderTemplateAdapter,
    webrtc::LibvpxVp9DecoderTemplateAdapter,
    webrtc::OpenH264DecoderTemplateAdapter>;

class FallbackVideoEncoder final : public webrtc::VideoEncoder {
public:
    FallbackVideoEncoder(std::unique_ptr<webrtc::VideoEncoder> hardware,
                         std::unique_ptr<webrtc::VideoEncoder> software,
                         std::string format,
                         std::string hardware_implementation)
        : hardware_(std::move(hardware)),
          software_(std::move(software)),
          format_(std::move(format)),
          hardware_implementation_(std::move(hardware_implementation)) {}

    int InitEncode(const webrtc::VideoCodec* codec_settings,
                   const Settings& settings) override {
        if (hardware_ && hardware_->InitEncode(codec_settings, settings) >= 0) {
            active_ = hardware_.get();
            record_encoder(hardware_implementation_, true);
            return 0;
        }
        if (hardware_) hardware_->Release();
        if (!software_) return -1;
        const int result = software_->InitEncode(codec_settings, settings);
        if (result >= 0) {
            active_ = software_.get();
            record_encoder("software-fallback:" + format_, false);
        }
        return result;
    }

    int32_t RegisterEncodeCompleteCallback(
        webrtc::EncodedImageCallback* callback) override {
        const int hardware_result = hardware_
            ? hardware_->RegisterEncodeCompleteCallback(callback)
            : 0;
        const int software_result = software_
            ? software_->RegisterEncodeCompleteCallback(callback)
            : 0;
        return hardware_result < 0 ? hardware_result : software_result;
    }

    int32_t Release() override {
        if (hardware_) hardware_->Release();
        if (software_) software_->Release();
        active_ = nullptr;
        return 0;
    }

    int32_t Encode(
        const webrtc::VideoFrame& frame,
        const std::vector<webrtc::VideoFrameType>* frame_types) override {
        return active_ ? active_->Encode(frame, frame_types) : -1;
    }

    void SetRates(const RateControlParameters& parameters) override {
        if (active_) active_->SetRates(parameters);
    }

    EncoderInfo GetEncoderInfo() const override {
        if (active_) return active_->GetEncoderInfo();
        if (hardware_) return hardware_->GetEncoderInfo();
        if (software_) return software_->GetEncoderInfo();
        return {};
    }

private:
    std::unique_ptr<webrtc::VideoEncoder> hardware_;
    std::unique_ptr<webrtc::VideoEncoder> software_;
    webrtc::VideoEncoder* active_ = nullptr;
    std::string format_;
    std::string hardware_implementation_;
};

class FallbackVideoDecoder final : public webrtc::VideoDecoder {
public:
    FallbackVideoDecoder(std::unique_ptr<webrtc::VideoDecoder> hardware,
                         std::unique_ptr<webrtc::VideoDecoder> software,
                         std::string format,
                         std::string hardware_implementation)
        : hardware_(std::move(hardware)),
          software_(std::move(software)),
          format_(std::move(format)),
          hardware_implementation_(std::move(hardware_implementation)) {}

    bool Configure(const Settings& settings) override {
        settings_ = settings;
        if (hardware_ && hardware_->Configure(settings)) {
            active_ = hardware_.get();
            using_hardware_ = true;
            record_decoder(hardware_implementation_, true);
            return true;
        }
        if (hardware_) hardware_->Release();
        if (!software_ || !software_->Configure(settings)) return false;
        active_ = software_.get();
        using_hardware_ = false;
        record_decoder("software-fallback:" + format_, false);
        return true;
    }

    int32_t RegisterDecodeCompleteCallback(
        webrtc::DecodedImageCallback* callback) override {
        const int hardware_result = hardware_
            ? hardware_->RegisterDecodeCompleteCallback(callback)
            : 0;
        const int software_result = software_
            ? software_->RegisterDecodeCompleteCallback(callback)
            : 0;
        return hardware_result < 0 ? hardware_result : software_result;
    }

    int32_t Decode(const webrtc::EncodedImage& input_image,
                   int64_t render_time_ms) override {
        if (!active_) return -1;
        const int32_t result = active_->Decode(input_image, render_time_ms);
        if (result >= 0 || !using_hardware_ || !software_) return result;
        active_->Release();
        if (!software_->Configure(settings_)) return result;
        active_ = software_.get();
        using_hardware_ = false;
        record_decoder("software-fallback:" + format_, false);
        return active_->Decode(input_image, render_time_ms);
    }

    int32_t Release() override {
        if (hardware_) hardware_->Release();
        if (software_) software_->Release();
        active_ = nullptr;
        using_hardware_ = false;
        return 0;
    }

    DecoderInfo GetDecoderInfo() const override {
        if (active_) return active_->GetDecoderInfo();
        if (hardware_) return hardware_->GetDecoderInfo();
        if (software_) return software_->GetDecoderInfo();
        return {};
    }

private:
    std::unique_ptr<webrtc::VideoDecoder> hardware_;
    std::unique_ptr<webrtc::VideoDecoder> software_;
    webrtc::VideoDecoder* active_ = nullptr;
    webrtc::VideoDecoder::Settings settings_;
    std::string format_;
    std::string hardware_implementation_;
    bool using_hardware_ = false;
};

class CompositeVideoEncoderFactory final : public webrtc::VideoEncoderFactory {
public:
    CompositeVideoEncoderFactory()
        : software_(std::make_unique<SoftwareEncoderFactory>()) {}

    std::vector<webrtc::SdpVideoFormat> GetSupportedFormats() const override {
        auto formats = software_->GetSupportedFormats();
        if (hardware_available()) {
            const auto native_formats = native_h264_formats();
            formats.insert(
                formats.begin(), native_formats.begin(), native_formats.end());
            formats.erase(
                std::unique(formats.begin(), formats.end(),
                            [](const auto& left, const auto& right) {
                                return left == right;
                            }),
                formats.end());
        }
        return formats;
    }

    CodecSupport QueryCodecSupport(
        const webrtc::SdpVideoFormat& format,
        std::optional<std::string> scalability_mode) const override {
        if (hardware_available() && format.name == "H264" && !scalability_mode)
            return {true, true};
        return software_->QueryCodecSupport(format, scalability_mode);
    }

    std::unique_ptr<webrtc::VideoEncoder> Create(
        const webrtc::Environment& environment,
        const webrtc::SdpVideoFormat& format) override {
        if (hardware_available() && format.name == "H264") {
#if defined(__APPLE__)
            if (auto encoder = create_video_toolbox_encoder(environment, format)) {
                return std::make_unique<FallbackVideoEncoder>(
                    std::move(encoder), software_->Create(environment, format),
                    format.name, "VideoToolbox");
            }
#endif
#if defined(_WIN32)
            if (auto encoder = create_media_foundation_encoder(environment, format)) {
                return std::make_unique<FallbackVideoEncoder>(
                    std::move(encoder), software_->Create(environment, format),
                    format.name, "Media Foundation");
            }
#endif
        }
        auto encoder = software_->Create(environment, format);
        if (encoder)
            record_encoder("software:" + format.name, false);
        return encoder;
    }

private:
    bool hardware_available() const {
#if defined(__APPLE__)
        return video_toolbox_encoder_available();
#elif defined(_WIN32)
        return media_foundation_encoder_available();
#else
        return false;
#endif
    }

    std::unique_ptr<SoftwareEncoderFactory> software_;
};

class CompositeVideoDecoderFactory final : public webrtc::VideoDecoderFactory {
public:
    CompositeVideoDecoderFactory()
        : software_(std::make_unique<SoftwareDecoderFactory>()) {}

    std::vector<webrtc::SdpVideoFormat> GetSupportedFormats() const override {
        auto formats = software_->GetSupportedFormats();
        if (hardware_available()) {
            const auto native_formats = native_h264_formats();
            formats.insert(
                formats.begin(), native_formats.begin(), native_formats.end());
            formats.erase(
                std::unique(formats.begin(), formats.end(),
                            [](const auto& left, const auto& right) {
                                return left == right;
                            }),
                formats.end());
        }
        return formats;
    }

    CodecSupport QueryCodecSupport(
        const webrtc::SdpVideoFormat& format,
        bool reference_scaling) const override {
        if (hardware_available() && format.name == "H264" && !reference_scaling)
            return {true, true};
        return software_->QueryCodecSupport(format, reference_scaling);
    }

    std::unique_ptr<webrtc::VideoDecoder> Create(
        const webrtc::Environment& environment,
        const webrtc::SdpVideoFormat& format) override {
        if (hardware_available() && format.name == "H264") {
#if defined(__APPLE__)
            if (auto decoder = create_video_toolbox_decoder(environment, format)) {
                return std::make_unique<FallbackVideoDecoder>(
                    std::move(decoder), software_->Create(environment, format),
                    format.name, "VideoToolbox");
            }
#endif
#if defined(_WIN32)
            if (auto decoder = create_media_foundation_decoder(environment, format)) {
                return std::make_unique<FallbackVideoDecoder>(
                    std::move(decoder), software_->Create(environment, format),
                    format.name, "Media Foundation");
            }
#endif
        }
        auto decoder = software_->Create(environment, format);
        if (decoder)
            record_decoder("software:" + format.name, false);
        return decoder;
    }

private:
    bool hardware_available() const {
#if defined(__APPLE__)
        return video_toolbox_decoder_available();
#elif defined(_WIN32)
        return media_foundation_decoder_available();
#else
        return false;
#endif
    }

    std::unique_ptr<SoftwareDecoderFactory> software_;
};

std::unique_ptr<webrtc::VideoEncoderFactory> create_video_encoder_factory() {
    return std::make_unique<CompositeVideoEncoderFactory>();
}

std::unique_ptr<webrtc::VideoDecoderFactory> create_video_decoder_factory() {
    return std::make_unique<CompositeVideoDecoderFactory>();
}

VideoCodecFactoryDiagnostics video_codec_factory_diagnostics() {
    run_runtime_probe();
    VideoCodecFactoryDiagnostics diagnostics;
#if defined(__APPLE__)
    diagnostics.platform = "macOS";
    diagnostics.hardware_encoder = video_toolbox_encoder_available();
    diagnostics.hardware_decoder = video_toolbox_decoder_available();
    diagnostics.encoder_implementation = diagnostics.hardware_encoder
        ? "VideoToolbox"
        : "software";
    diagnostics.decoder_implementation = diagnostics.hardware_decoder
        ? "VideoToolbox"
        : "software";
#elif defined(_WIN32)
    diagnostics.platform = "Windows";
    diagnostics.hardware_encoder = media_foundation_encoder_available();
    diagnostics.hardware_decoder = media_foundation_decoder_available();
    diagnostics.encoder_implementation = diagnostics.hardware_encoder
        ? "Media Foundation"
        : "software";
    diagnostics.decoder_implementation = diagnostics.hardware_decoder
        ? "Media Foundation"
        : "software";
#endif
    {
        std::lock_guard<std::mutex> lock(g_diagnostics_mutex);
        diagnostics.active_encoder_implementation = g_active_encoder_implementation;
        diagnostics.active_decoder_implementation = g_active_decoder_implementation;
        diagnostics.active_hardware_encoder = g_active_hardware_encoder;
        diagnostics.active_hardware_decoder = g_active_hardware_decoder;
        diagnostics.encoder_creations = g_encoder_creations;
        diagnostics.decoder_creations = g_decoder_creations;
    }
    {
        std::lock_guard<std::mutex> lock(g_runtime_probe_mutex);
        diagnostics.codecs = g_runtime_codecs;
        diagnostics.concurrent_hardware_sessions_tested =
            g_concurrent_hardware_sessions_tested;
        diagnostics.max_hardware_encode_sessions = g_max_hardware_encode_sessions;
        diagnostics.tested_codec_pairs = g_tested_codec_pairs;
        diagnostics.hardware_encoder = std::any_of(
            diagnostics.codecs.begin(), diagnostics.codecs.end(),
            [](const auto& entry) {
                return entry.second.encoder_supported &&
                    entry.second.encoder_frame_validated &&
                    entry.second.encoder_hardware;
            });
        diagnostics.hardware_decoder = std::any_of(
            diagnostics.codecs.begin(), diagnostics.codecs.end(),
            [](const auto& entry) {
                return entry.second.decoder_supported &&
                    entry.second.decoder_frame_validated &&
                    entry.second.decoder_hardware;
            });
    }
    return diagnostics;
}

void reset_video_codec_factory_diagnostics() {
    {
        std::lock_guard<std::mutex> lock(g_runtime_probe_mutex);
        g_runtime_probe_complete = false;
        g_runtime_codecs.clear();
        g_concurrent_hardware_sessions_tested = false;
        g_max_hardware_encode_sessions = 0;
        g_tested_codec_pairs.clear();
    }
    std::lock_guard<std::mutex> lock(g_diagnostics_mutex);
    g_active_encoder_implementation = "not-created";
    g_active_decoder_implementation = "not-created";
    g_active_hardware_encoder = false;
    g_active_hardware_decoder = false;
    g_encoder_creations = 0;
    g_decoder_creations = 0;
}

}
