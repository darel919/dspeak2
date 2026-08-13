#ifndef LIB_DSPEAK_MEDIA_INTERNAL_PLATFORM_VIDEO_CODEC_FACTORIES_HPP_
#define LIB_DSPEAK_MEDIA_INTERNAL_PLATFORM_VIDEO_CODEC_FACTORIES_HPP_

#include <memory>
#include <cstdint>
#include <string>

#include <api/video_codecs/video_decoder_factory.h>
#include <api/video_codecs/video_encoder_factory.h>

namespace dspeak_native {

struct VideoCodecFactoryDiagnostics {
    bool hardware_encoder = false;
    bool hardware_decoder = false;
    std::string encoder_implementation = "software";
    std::string decoder_implementation = "software";
    std::string platform = "unsupported";
    std::string active_encoder_implementation = "not-created";
    std::string active_decoder_implementation = "not-created";
    bool active_hardware_encoder = false;
    bool active_hardware_decoder = false;
    uint64_t encoder_creations = 0;
    uint64_t decoder_creations = 0;
};

std::unique_ptr<webrtc::VideoEncoderFactory> create_video_encoder_factory();
std::unique_ptr<webrtc::VideoDecoderFactory> create_video_decoder_factory();
VideoCodecFactoryDiagnostics video_codec_factory_diagnostics();
void reset_video_codec_factory_diagnostics();

}

#endif
