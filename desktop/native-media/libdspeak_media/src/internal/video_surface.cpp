#include "video_surface.hpp"

#if defined(__APPLE__) || defined(_WIN32)
namespace dspeak_media_video_surface_platform {
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
void run_loop();
void stop_loop();
}
#else
namespace dspeak_media_video_surface_platform {
int set_bounds(const char*, int, int, int, int, bool) { return -1; }
int destroy(const char*) { return -1; }
bool is_visible(const char*) { return false; }
void render(const char*, const webrtc::VideoFrame&) {}
void clear() {}
void run_loop() {}
void stop_loop() {}
}
#endif

namespace dspeak_media_video_surface {

int set_bounds(const char* surface_id,
               int x,
               int y,
               int width,
               int height,
               bool visible) {
    return dspeak_media_video_surface_platform::set_bounds(
        surface_id, x, y, width, height, visible);
}

int destroy(const char* surface_id) {
    return dspeak_media_video_surface_platform::destroy(surface_id);
}

bool is_visible(const char* surface_id) {
    return dspeak_media_video_surface_platform::is_visible(surface_id);
}

void render(const char* surface_id, const webrtc::VideoFrame& frame) {
    dspeak_media_video_surface_platform::render(surface_id, frame);
}

void clear() {
    dspeak_media_video_surface_platform::clear();
}

void run_loop() {
    dspeak_media_video_surface_platform::run_loop();
}

void stop_loop() {
    dspeak_media_video_surface_platform::stop_loop();
}

}

extern "C" int lib_dspeak_media_video_surface_set_bounds(const char* surface_id,
                                                           int x,
                                                           int y,
                                                           int width,
                                                           int height,
                                                           bool visible) {
    return dspeak_media_video_surface::set_bounds(
        surface_id, x, y, width, height, visible);
}

extern "C" int lib_dspeak_media_video_surface_destroy(const char* surface_id) {
    return dspeak_media_video_surface::destroy(surface_id);
}

extern "C" void lib_dspeak_media_video_surface_clear(void) {
    dspeak_media_video_surface::clear();
}

extern "C" void lib_dspeak_media_video_surface_run_loop(void) {
    dspeak_media_video_surface::run_loop();
}

extern "C" void lib_dspeak_media_video_surface_stop_loop(void) {
    dspeak_media_video_surface::stop_loop();
}
