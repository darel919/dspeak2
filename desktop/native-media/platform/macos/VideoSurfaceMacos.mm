#include "../../libdspeak_media/src/internal/video_surface.hpp"

#if defined(__APPLE__)

#import <AppKit/AppKit.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>

#include <dispatch/dispatch.h>
#include <api/scoped_refptr.h>
#include <third_party/libyuv/include/libyuv/convert.h>
#include <third_party/libyuv/include/libyuv/convert_from.h>
#include <third_party/libyuv/include/libyuv/planar_functions.h>

#include <atomic>
#include <algorithm>
#include <map>
#include <mutex>
#include <string>

namespace {

struct NativeSurface {
    NSWindow* window = nil;
    NSView* view = nil;
    AVSampleBufferDisplayLayer* display_layer = nil;
    CMSampleBufferRef pending_sample = nullptr;
    bool visible = false;
    bool render_scheduled = false;
};

std::mutex g_surface_mutex;
std::map<std::string, NativeSurface> g_surfaces;
std::atomic_bool g_loop_running = false;

template <typename Function>
void run_on_main(Function&& function, bool wait) {
    if ([NSThread isMainThread]) {
        function();
        return;
    }
    if (wait)
        dispatch_sync(dispatch_get_main_queue(), function);
    else
        dispatch_async(dispatch_get_main_queue(), function);
}

NSRect screen_rect_from_top_left(int x, int y, int width, int height) {
    CGFloat desktop_top = 0;
    for (NSScreen* screen in NSScreen.screens)
        desktop_top = std::max(desktop_top, NSMaxY(screen.frame));
    return NSMakeRect(x,
                      desktop_top - y - height,
                      width,
                      height);
}

NativeSurface& ensure_surface(const char* surface_id) {
    auto& surface = g_surfaces[std::string(surface_id ? surface_id : "")];
    if (surface.window) return surface;
    surface.window = [[NSWindow alloc]
        initWithContentRect:NSZeroRect
                  styleMask:NSWindowStyleMaskBorderless
                    backing:NSBackingStoreBuffered
                      defer:NO];
    surface.window.opaque = YES;
    surface.window.backgroundColor = NSColor.blackColor;
    surface.window.level = NSFloatingWindowLevel;
    surface.window.hasShadow = NO;
    surface.window.ignoresMouseEvents = YES;
    surface.window.releasedWhenClosed = NO;
    surface.window.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
                                         NSWindowCollectionBehaviorFullScreenAuxiliary;
    surface.view = [[NSView alloc] initWithFrame:NSZeroRect];
    surface.view.wantsLayer = YES;
    surface.view.layer.backgroundColor = NSColor.blackColor.CGColor;
    surface.display_layer = [[AVSampleBufferDisplayLayer alloc] init];
    surface.display_layer.videoGravity = AVLayerVideoGravityResizeAspect;
    surface.display_layer.frame = surface.view.bounds;
    surface.display_layer.autoresizingMask = kCALayerWidthSizable | kCALayerHeightSizable;
    [surface.view.layer addSublayer:surface.display_layer];
    surface.window.contentView = surface.view;
    return surface;
}

bool surface_is_visible(const char* surface_id) {
    if (!surface_id || !*surface_id) return false;
    std::lock_guard<std::mutex> lock(g_surface_mutex);
    const auto it = g_surfaces.find(surface_id);
    return it != g_surfaces.end() && it->second.visible;
}

void present_pending_sample(const std::string& key) {
    CMSampleBufferRef sample = nullptr;
    {
        std::lock_guard<std::mutex> lock(g_surface_mutex);
        const auto it = g_surfaces.find(key);
        if (it == g_surfaces.end()) return;
        auto& surface = it->second;
        sample = surface.pending_sample;
        surface.pending_sample = nullptr;
        surface.render_scheduled = false;
        if (sample && surface.visible && surface.display_layer) {
            if (surface.display_layer.status == AVQueuedSampleBufferRenderingStatusFailed)
                [surface.display_layer flush];
            if (surface.display_layer.readyForMoreMediaData)
                [surface.display_layer enqueueSampleBuffer:sample];
        }
    }
    if (sample) CFRelease(sample);
}

void queue_sample(const std::string& key, CMSampleBufferRef sample) {
    bool schedule = false;
    {
        std::lock_guard<std::mutex> lock(g_surface_mutex);
        const auto it = g_surfaces.find(key);
        if (it == g_surfaces.end() || !it->second.visible) {
            CFRelease(sample);
            return;
        }
        auto& surface = it->second;
        if (surface.pending_sample) CFRelease(surface.pending_sample);
        surface.pending_sample = sample;
        if (!surface.render_scheduled) {
            surface.render_scheduled = true;
            schedule = true;
        }
    }
    if (schedule)
        run_on_main([key] { present_pending_sample(key); }, false);
}

CVPixelBufferRef nv12_pixel_buffer(
    webrtc::scoped_refptr<webrtc::VideoFrameBuffer> input) {
    if (!input) return nullptr;
    const int width = input->width();
    const int height = input->height();
    if (width <= 0 || height <= 0) return nullptr;
    CVPixelBufferRef pixel_buffer = nullptr;
    NSDictionary* attributes = @{
        (id)kCVPixelBufferIOSurfacePropertiesKey: @{},
        (id)kCVPixelBufferMetalCompatibilityKey: @YES,
    };
    if (CVPixelBufferCreate(kCFAllocatorDefault,
                            width,
                            height,
                            kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
                            (__bridge CFDictionaryRef)attributes,
                            &pixel_buffer) != kCVReturnSuccess)
        return nullptr;
    if (CVPixelBufferLockBaseAddress(pixel_buffer, 0) != kCVReturnSuccess) {
        CFRelease(pixel_buffer);
        return nullptr;
    }
    const auto i420 = input->ToI420();
    if (!i420) {
        CVPixelBufferUnlockBaseAddress(pixel_buffer, 0);
        CFRelease(pixel_buffer);
        return nullptr;
    }
    const int result = libyuv::I420ToNV12(
        i420->DataY(), i420->StrideY(),
        i420->DataU(), i420->StrideU(),
        i420->DataV(), i420->StrideV(),
        static_cast<uint8_t*>(CVPixelBufferGetBaseAddressOfPlane(pixel_buffer, 0)),
        static_cast<int>(CVPixelBufferGetBytesPerRowOfPlane(pixel_buffer, 0)),
        static_cast<uint8_t*>(CVPixelBufferGetBaseAddressOfPlane(pixel_buffer, 1)),
        static_cast<int>(CVPixelBufferGetBytesPerRowOfPlane(pixel_buffer, 1)),
        width,
        height);
    CVPixelBufferUnlockBaseAddress(pixel_buffer, 0);
    if (result != 0) {
        CFRelease(pixel_buffer);
        return nullptr;
    }
    return pixel_buffer;
}

}

namespace dspeak_media_video_surface_platform {

bool is_visible(const char* surface_id) {
    return surface_is_visible(surface_id);
}

int set_bounds(const char* surface_id,
               int x,
               int y,
               int width,
               int height,
               bool visible) {
    if (!surface_id || width <= 0 || height <= 0) return -1;
    const std::string key(surface_id);
    int result = -1;
    run_on_main([&] {
        std::lock_guard<std::mutex> lock(g_surface_mutex);
        auto& surface = ensure_surface(key.c_str());
        if (!surface.window) return;
        [surface.window setFrame:screen_rect_from_top_left(x, y, width, height)
                         display:YES];
        surface.view.frame = surface.window.contentView.bounds;
        surface.display_layer.frame = surface.view.bounds;
        surface.visible = visible;
        if (!visible && surface.pending_sample) {
            CFRelease(surface.pending_sample);
            surface.pending_sample = nullptr;
        }
        if (visible)
            [surface.window orderFrontRegardless];
        else
            [surface.window orderOut:nil];
        result = 0;
    }, true);
    return result;
}

int destroy(const char* surface_id) {
    if (!surface_id) return -1;
    const std::string key(surface_id);
    run_on_main([&] {
        std::lock_guard<std::mutex> lock(g_surface_mutex);
        auto it = g_surfaces.find(key);
        if (it == g_surfaces.end()) return;
        if (it->second.pending_sample) CFRelease(it->second.pending_sample);
        it->second.pending_sample = nullptr;
        [it->second.window orderOut:nil];
        [it->second.window close];
        g_surfaces.erase(it);
    }, true);
    return 0;
}

void render(const char* surface_id, const webrtc::VideoFrame& frame) {
    if (!surface_id || !*surface_id || !surface_is_visible(surface_id)) return;
    const auto pixel_buffer = nv12_pixel_buffer(frame.video_frame_buffer());
    if (!pixel_buffer) return;
    CMVideoFormatDescriptionRef format_description = nullptr;
    CMSampleBufferRef sample_buffer = nullptr;
    if (CMVideoFormatDescriptionCreateForImageBuffer(
            kCFAllocatorDefault, pixel_buffer, &format_description) != noErr) {
        CFRelease(pixel_buffer);
        return;
    }
    CMSampleTimingInfo timing = {
        CMTimeMake(1, 30),
        CMTimeMake(frame.timestamp_us(), 1000000),
        kCMTimeInvalid,
    };
    if (CMSampleBufferCreateForImageBuffer(
            kCFAllocatorDefault,
            pixel_buffer,
            true,
            nullptr,
            nullptr,
            format_description,
            &timing,
            &sample_buffer) != noErr) {
        CFRelease(format_description);
        CFRelease(pixel_buffer);
        return;
    }
    queue_sample(std::string(surface_id), sample_buffer);
    CFRelease(format_description);
    CFRelease(pixel_buffer);
}

void clear() {
    run_on_main([] {
        std::lock_guard<std::mutex> lock(g_surface_mutex);
        for (auto& [key, surface] : g_surfaces) {
            if (surface.pending_sample) CFRelease(surface.pending_sample);
            surface.pending_sample = nullptr;
            [surface.window orderOut:nil];
            [surface.window close];
        }
        g_surfaces.clear();
    }, true);
}

void run_loop() {
    @autoreleasepool {
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
        g_loop_running.store(true, std::memory_order_release);
        [NSApp run];
        g_loop_running.store(false, std::memory_order_release);
    }
}

void stop_loop() {
    if (!g_loop_running.exchange(false, std::memory_order_acq_rel)) return;
    run_on_main([] {
        [NSApp stop:nil];
        NSEvent* event = [NSEvent otherEventWithType:NSEventTypeApplicationDefined
                                            location:NSZeroPoint
                                       modifierFlags:0
                                           timestamp:0
                                        windowNumber:0
                                             context:nil
                                             subtype:0
                                               data1:0
                                               data2:0];
        [NSApp postEvent:event atStart:YES];
    }, false);
}

}

#endif
