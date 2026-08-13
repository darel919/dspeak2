#ifndef LIB_DSPEAK_MEDIA_INTERNAL_VIDEO_SURFACE_HPP_
#define LIB_DSPEAK_MEDIA_INTERNAL_VIDEO_SURFACE_HPP_

#include <cstdint>

#include <api/video/video_frame.h>

namespace dspeak_media_video_surface {

int set_bounds(const char* surface_id,
               int x,
               int y,
               int width,
               int height,
               bool visible);
int destroy(const char* surface_id);
bool is_visible(const char* surface_id);
void render(const char* surface_id, const webrtc::VideoFrame& frame);
void clear();

}

extern "C" {

int lib_dspeak_media_video_surface_set_bounds(const char* surface_id,
                                              int x,
                                              int y,
                                              int width,
                                              int height,
                                              bool visible);
int lib_dspeak_media_video_surface_destroy(const char* surface_id);
void lib_dspeak_media_video_surface_clear(void);
void lib_dspeak_media_video_surface_run_loop(void);
void lib_dspeak_media_video_surface_stop_loop(void);

}

#endif
