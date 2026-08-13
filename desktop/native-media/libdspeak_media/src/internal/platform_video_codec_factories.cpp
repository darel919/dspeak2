#include "platform_video_codec_factories.hpp"

#include <algorithm>
#include <cstdint>
#include <mutex>
#include <string>
#include <utility>
#include <vector>

#include <api/video_codecs/video_decoder_factory_template.h>
#include <api/video_codecs/video_decoder_factory_template_libvpx_vp8_adapter.h>
#include <api/video_codecs/video_decoder_factory_template_libvpx_vp9_adapter.h>
#include <api/video_codecs/video_decoder_factory_template_open_h264_adapter.h>
#include <api/video_codecs/video_encoder_factory_template.h>
#include <api/video_codecs/video_encoder_factory_template_libvpx_vp8_adapter.h>
#include <api/video_codecs/video_encoder_factory_template_libvpx_vp9_adapter.h>
#include <api/video_codecs/video_encoder_factory_template_open_h264_adapter.h>

namespace dspeak_native {

namespace {

std::mutex g_diagnostics_mutex;
std::string g_active_encoder_implementation = "not-created";
std::string g_active_decoder_implementation = "not-created";
bool g_active_hardware_encoder = false;
bool g_active_hardware_decoder = false;
uint64_t g_encoder_creations = 0;
uint64_t g_decoder_creations = 0;

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

}

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
            formats.insert(formats.begin(), webrtc::SdpVideoFormat::H264());
            formats.erase(
                std::unique(formats.begin(), formats.end(),
                            [](const auto& left, const auto& right) {
                                return left.IsSameCodec(right);
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
            formats.insert(formats.begin(), webrtc::SdpVideoFormat::H264());
            formats.erase(
                std::unique(formats.begin(), formats.end(),
                            [](const auto& left, const auto& right) {
                                return left.IsSameCodec(right);
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
    return diagnostics;
}

void reset_video_codec_factory_diagnostics() {
    std::lock_guard<std::mutex> lock(g_diagnostics_mutex);
    g_active_encoder_implementation = "not-created";
    g_active_decoder_implementation = "not-created";
    g_active_hardware_encoder = false;
    g_active_hardware_decoder = false;
    g_encoder_creations = 0;
    g_decoder_creations = 0;
}

}
