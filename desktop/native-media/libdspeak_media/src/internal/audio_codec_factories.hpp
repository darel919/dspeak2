#ifndef LIB_DSPEAK_MEDIA_INTERNAL_AUDIO_CODEC_FACTORIES_HPP_
#define LIB_DSPEAK_MEDIA_INTERNAL_AUDIO_CODEC_FACTORIES_HPP_

#include <api/audio_codecs/audio_decoder_factory.h>
#include <api/audio_codecs/audio_encoder_factory.h>
#include <api/scoped_refptr.h>

namespace dspeak_native {

webrtc::scoped_refptr<webrtc::AudioEncoderFactory> create_dspeak_audio_encoder_factory();
webrtc::scoped_refptr<webrtc::AudioDecoderFactory> create_dspeak_audio_decoder_factory();

}  // namespace dspeak_native

#endif
