#ifndef LIB_DSPEAK_MEDIA_INTERNAL_RECEIVE_RENDER_HPP_
#define LIB_DSPEAK_MEDIA_INTERNAL_RECEIVE_RENDER_HPP_

#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "lib_dspeak_media/lib_dspeak_media.h"

#include <api/media_stream_interface.h>
#include <api/video/video_frame.h>
#include <api/video/video_sink_interface.h>

class NativeReceiveAudioSink final : public webrtc::AudioTrackSinkInterface {
public:
    explicit NativeReceiveAudioSink(std::string consumer_id);
    ~NativeReceiveAudioSink() override;

    void OnData(const void* audio_data,
                int bits_per_sample,
                int sample_rate,
                size_t number_of_channels,
                size_t number_of_frames,
                std::optional<int64_t> absolute_capture_timestamp_ms) override;

    void SetEnabled(bool enabled);
    void SetVolume(double volume);

private:
    std::string consumer_id_;
    void* output_ = nullptr;
};

class NativeReceiveVideoSink final : public webrtc::VideoSinkInterface<webrtc::VideoFrame> {
public:
    explicit NativeReceiveVideoSink(std::string consumer_id);
    ~NativeReceiveVideoSink() override = default;

    void OnFrame(const webrtc::VideoFrame& frame) override;
    void SetEnabled(bool enabled);

private:
    std::string consumer_id_;
    bool enabled_ = true;
};

extern "C" {

void* lib_dspeak_media_audio_output_create(const char* consumer_id);
void lib_dspeak_media_audio_output_destroy(void* output);
int lib_dspeak_media_audio_output_start(void* output);
void lib_dspeak_media_audio_output_stop(void* output);
void lib_dspeak_media_audio_output_set_enabled(void* output, bool enabled);
void lib_dspeak_media_audio_output_set_volume(void* output, double volume);
void lib_dspeak_media_audio_output_write(void* output,
                                         const float* samples,
                                         uint32_t frame_count,
                                         uint32_t sample_rate,
                                         uint8_t channels);

void lib_dspeak_media_push_receive_track_event(const char* event_name,
                                               const char* consumer_id,
                                               const char* producer_id,
                                               const char* kind,
                                               const char* app_data_json);
void lib_dspeak_media_push_receive_track_closed_event(const char* consumer_id,
                                                      const char* producer_id,
                                                      const char* kind);
void lib_dspeak_media_push_p2p_event(uint64_t p2p_handle,
                                     const char* event_name,
                                     const char* track_id,
                                     const char* kind,
                                     const char* value);

}

#endif
