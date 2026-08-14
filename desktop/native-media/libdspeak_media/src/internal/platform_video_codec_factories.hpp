#ifndef LIB_DSPEAK_MEDIA_INTERNAL_PLATFORM_VIDEO_CODEC_FACTORIES_HPP_
#define LIB_DSPEAK_MEDIA_INTERNAL_PLATFORM_VIDEO_CODEC_FACTORIES_HPP_

#include <memory>
#include <cstdint>
#include <map>
#include <string>
#include <utility>
#include <vector>

#include <api/video_codecs/video_decoder_factory.h>
#include <api/video_codecs/video_encoder_factory.h>

namespace dspeak_native {

struct VideoCodecRuntimeDiagnostics {
    bool encoder_supported = false;
    bool decoder_supported = false;
    bool decoder_configured = false;
    bool encoder_frame_validated = false;
    bool decoder_frame_validated = false;
    bool encoder_hardware = false;
    bool decoder_hardware = false;
    std::string encoder_implementation = "unsupported";
    std::string decoder_implementation = "unsupported";
    std::string encoder_failure;
    std::string decoder_failure;
    int encoder_tested_width = 0;
    int encoder_tested_height = 0;
    int encoder_tested_fps = 0;
    int decoder_tested_width = 0;
    int decoder_tested_height = 0;
    int decoder_tested_fps = 0;
};

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
    std::map<std::string, VideoCodecRuntimeDiagnostics> codecs;
    bool concurrent_hardware_sessions_tested = false;
    int max_hardware_encode_sessions = 0;
    std::vector<std::pair<std::string, std::string>> tested_codec_pairs;
};

std::unique_ptr<webrtc::VideoEncoderFactory> create_video_encoder_factory();
std::unique_ptr<webrtc::VideoDecoderFactory> create_video_decoder_factory();
VideoCodecFactoryDiagnostics video_codec_factory_diagnostics();
void reset_video_codec_factory_diagnostics();

}

#endif
