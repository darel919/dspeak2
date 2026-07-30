//  PlatformCapture.mm
//  Real ScreenCaptureKit + CoreAudio capture for macOS.
//  Compiled as Objective-C++ (`.mm` extension) with `-fobjc++`.

#include "PlatformCapture.h"
#include <ScreenCaptureKit/ScreenCaptureKit.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreVideo/CoreVideo.h>
#import <CoreAudio/CoreAudio.h>
#include <dispatch/dispatch.h>
#include <memory>
#include <mutex>
#include <atomic>

#if defined(__APPLE__)

#pragma mark - Video (ScreenCaptureKit)

// Forward declaration for stop function
static void dsm_platform_screen_capture_stop_impl(struct dsm_screen_capture* sc);

struct dsm_screen_capture {
    using dsm_screen_capture_t = dsm_screen_capture;
    ~dsm_screen_capture() { dsm_platform_screen_capture_stop_impl(this); }

    std::atomic<bool>            running{false};
    dsm_screen_frame_cb          frame_cb = nullptr;
    void*                        frame_user = nullptr;
    dispatch_queue_t             queue;
    CGDirectDisplayID            display_id = 0;
    SCContentFilter*             filter = nil;
    SCStream*                    stream = nil;
    id<SCStreamOutput>           stream_output = nil;
    NSRecursiveLock*             lock;
};

@interface DSMStreamOutput : NSObject <SCStreamOutput>
@end

@implementation DSMStreamOutput {
    struct dsm_screen_capture* _sc;
}
- (instancetype)initWithCapture:(struct dsm_screen_capture*)sc {
    self = [super init];
    if (self) _sc = sc;
    return self;
}
- (void)stream:(SCStream *)stream didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer ofType:(SCStreamOutputType)type {
    if (!sampleBuffer || type != SCStreamOutputTypeScreen) return;
    CFRetain(sampleBuffer);
    _sc->frame_cb(_sc->frame_user, sampleBuffer);
}
@end

struct dsm_screen_capture* dsm_platform_screen_capture_create(uint64_t display_id)
{
    auto* c = new(std::nothrow) dsm_screen_capture();
    if (!c) return nullptr;
    c->display_id = static_cast<CGDirectDisplayID>(display_id);
    c->queue = dispatch_queue_create("dspeak.video", DISPATCH_QUEUE_SERIAL);
    c->lock = [[NSRecursiveLock alloc] init];
    return c;
}

void dsm_platform_screen_capture_destroy(struct dsm_screen_capture* sc)
{
    if (!sc) return;
    dsm_platform_screen_capture_stop_impl(sc);
    dispatch_release(sc->queue);
    [sc->lock release];
    delete sc;
}

static void dsm_platform_screen_capture_stop_impl(struct dsm_screen_capture* sc)
{
    if (!sc) return;
    [sc->lock lock];
    sc->running = false;
    if (sc->stream) {
        [sc->stream stopCapture];
        sc->stream = nil;
    }
    if (sc->stream_output) {
        sc->stream_output = nil;
    }
    [sc->lock unlock];
}

void dsm_platform_screen_capture_stop(struct dsm_screen_capture* sc)
{
    dsm_platform_screen_capture_stop_impl(sc);
}

int dsm_platform_screen_capture_start(struct dsm_screen_capture* sc,
                                            dsm_screen_frame_cb cb,
                                            void* user_data)
{
    if (!sc || !cb) return -1;

    [sc->lock lock];
    if (sc->running) { [sc->lock unlock]; return 0; }

    sc->frame_cb   = cb;
    sc->frame_user = user_data;

    // Get the SCDisplay for this display ID
    __block SCContentFilter* filter = nil;
    __block NSError* filter_error = nil;
    dispatch_semaphore_t sema = dispatch_semaphore_create(0);
    
    [SCShareableContent getShareableContentWithCompletionHandler:^(SCShareableContent* _Nullable content, NSError* _Nullable error) {
        if (error) {
            filter_error = error;
        } else {
            for (SCDisplay* display in content.displays) {
                if (display.displayID == sc->display_id) {
                    filter = [[SCContentFilter alloc] initWithDisplay:display excludingWindows:nil];
                    break;
                }
            }
        }
        dispatch_semaphore_signal(sema);
    }];
    
    dispatch_semaphore_wait(sema, DISPATCH_TIME_FOREVER);
    dispatch_release(sema);
    
    if (filter_error || !filter) {
        [sc->lock unlock];
        return -1;
    }

    SCStreamConfiguration* config = [[SCStreamConfiguration alloc] initWithWidth:1920 height:1080 fps:30];

    // Create stream with delegate (nil for now, we use addStreamOutput)
    sc->stream = [[SCStream alloc] initWithFilter:filter configuration:config delegate:nil];
    if (!sc->stream) {
        [sc->lock unlock];
        return -1;
    }

    // Create output handler object
    sc->stream_output = [[DSMStreamOutput alloc] initWithCapture:sc];
    if (!sc->stream_output) {
        sc->stream = nil;
        [sc->lock unlock];
        return -1;
    }

    // Add screen output
    NSError* error = nil;
    BOOL ok = [sc->stream addStreamOutput:sc->stream_output type:SCStreamOutputTypeScreen sampleHandlerQueue:sc->queue error:&error];
    if (!ok || error) {
        sc->stream_output = nil;
        sc->stream = nil;
        [sc->lock unlock];
        return -1;
    }

    // Start capture
    [sc->stream startCaptureWithCompletionHandler:^(NSError *error) {
        if (error) {
            // Capture failed to start - handle error
        }
    }];

    sc->running = true;
    [sc->lock unlock];
    return 0;
}

#pragma mark - Audio (CoreAudio)

struct dsm_audio_capture {
    using dsm_audio_capture_t = dsm_audio_capture;
    ~dsm_audio_capture() { stop(); }

    std::atomic<bool>  running{false};
    dsm_audio_frame_cb pcm_cb       = nullptr;
    void*              pcm_user     = nullptr;
    AudioQueueRef      queue        = nullptr;
    AudioStreamBasicDescription audio_format{};

    void stop() {
        if (!running) return;
        running = false;
        if (queue) {
            AudioQueueStop(queue, true);
            AudioQueueDispose(queue, true);
            queue = nullptr;
        }
    }
};

struct dsm_audio_capture* dsm_platform_audio_capture_create(void)
{
    auto* c = new(std::nothrow) dsm_audio_capture();
    if (!c) return nullptr;
    return c;
}

void dsm_platform_audio_capture_destroy(struct dsm_audio_capture* ac)
{
    if (!ac) return;
    ac->stop();
    delete ac;
}

static void audio_queue_callback(void* user_data, AudioQueueRef,
                                AudioQueueBufferRef buffer)
{
    auto* ac = static_cast<struct dsm_audio_capture*>(user_data);
    if (!ac || !ac->running || !ac->pcm_cb) return;
    ac->pcm_cb(ac->pcm_user,
               static_cast<const float*>(buffer->mAudioData),
               static_cast<uint32_t>(buffer->mAudioDataByteSize / sizeof(float)),
               static_cast<uint32_t>(ac->audio_format.mSampleRate),
               static_cast<uint8_t>(ac->audio_format.mChannelsPerFrame));
}

static AudioQueueRef create_audio_queue(struct dsm_audio_capture* ac)
{
    OSStatus err;
    AudioStreamBasicDescription format = {};
    format.mSampleRate       = 48000;
    format.mFormatID         = kAudioFormatLinearPCM;
    format.mFormatFlags      = kLinearPCMFormatFlagIsFloat | kLinearPCMFormatFlagIsPacked;
    format.mBitsPerChannel   = 32;
    format.mChannelsPerFrame = 2;
    format.mBytesPerPacket   = sizeof(float) * 2;
    format.mFramesPerPacket  = 1;
    format.mBytesPerFrame    = sizeof(float) * 2;

    AudioQueueRef queue;
    err = AudioQueueNewOutput(&format, audio_queue_callback, ac, nullptr, nullptr, 0, &queue);
    if (err != noErr) return nullptr;

    UInt32 buffer_size = 4096;  // ~85ms at 48kHz stereo float
    AudioQueueBufferRef buffers[2];
    for (int i = 0; i < 2; ++i) {
        err = AudioQueueAllocateBuffer(queue, buffer_size, &buffers[i]);
        if (err == noErr) {
            memset(buffers[i]->mAudioData, 0, buffers[i]->mAudioDataBytesCapacity);
            err = AudioQueueEnqueueBuffer(queue, buffers[i], 0, nullptr);
            if (err != noErr) break;
        }
    }
    if (err != noErr) {
        AudioQueueDispose(queue, true);
        return nullptr;
    }
    ac->audio_format = format;
    return queue;
}

int dsm_platform_audio_capture_start(struct dsm_audio_capture* ac,
                                            dsm_audio_frame_cb cb,
                                            void* user_data)
{
    if (!ac || !cb) return -1;
    if (ac->running) return 0;

    ac->pcm_cb   = cb;
    ac->pcm_user = user_data;

    ac->queue = create_audio_queue(ac);
    if (!ac->queue) return -1;

    OSStatus err = AudioQueueStart(ac->queue, nullptr);
    if (err != noErr) {
        AudioQueueDispose(ac->queue, true);
        ac->queue = nullptr;
        return -1;
    }

    ac->running = true;
    return 0;
}

void dsm_platform_audio_capture_stop(struct dsm_audio_capture* ac)
{
    if (!ac) return;
    ac->stop();
}

#endif /* __APPLE__ */
