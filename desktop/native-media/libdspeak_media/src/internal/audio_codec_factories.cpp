#include "audio_codec_factories.hpp"

#include <api/audio_codecs/builtin_audio_decoder_factory.h>
#include <api/audio_codecs/builtin_audio_encoder_factory.h>

namespace dspeak_native {

webrtc::scoped_refptr<webrtc::AudioEncoderFactory> create_dspeak_audio_encoder_factory() {
    return webrtc::CreateBuiltinAudioEncoderFactory();
}

webrtc::scoped_refptr<webrtc::AudioDecoderFactory> create_dspeak_audio_decoder_factory() {
    return webrtc::CreateBuiltinAudioDecoderFactory();
}

}  // namespace dspeak_native
