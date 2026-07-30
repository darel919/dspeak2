#include "PlatformCapture.h"

#include <ScreenCaptureKit/ScreenCaptureKit.h>
#include <AVFoundation/AVFoundation.h>
#include <CoreAudio/CoreAudio.h>
#include <CoreGraphics/CoreGraphics.h>
#include <CoreMedia/CoreMedia.h>
#include <CoreVideo/CoreVideo.h>
#include <dispatch/dispatch.h>

#include <algorithm>
#include <atomic>
#include <condition_variable>
#include <cstring>
#include <mutex>
#include <new>
#include <string>
#include <vector>

#if defined(__APPLE__)

struct lib_dspeak_media_capture_session;

static void capture_report_error(lib_dspeak_media_capture_session* session,
                                 int error_code,
                                 const char* message);

struct lib_dspeak_media_capture_session {
    std::mutex mutex;
    std::condition_variable state_changed;
    bool starting = false;
    bool running = false;
    bool stopping = false;
    bool capture_video = false;
    bool capture_audio = false;
    bool exclude_self_audio = true;
    lib_dspeak_media_screen_frame_cb screen_cb = nullptr;
    lib_dspeak_media_audio_frame_cb audio_cb = nullptr;
    lib_dspeak_media_capture_error_cb error_cb = nullptr;
    void* user_data = nullptr;
    dispatch_queue_t video_queue = nullptr;
    dispatch_queue_t audio_queue = nullptr;
    SCStream* stream = nil;
    id<SCStreamOutput> output = nil;
    id<SCStreamDelegate> delegate = nil;
    NSString* source_id = nil;
    NSString* source_type = nil;
};

static NSString* string_from_utf8(const char* value) {
    if (!value) return nil;
    return [NSString stringWithUTF8String:value];
}

static NSString* source_id_for_display(CGDirectDisplayID display_id) {
    return [NSString stringWithFormat:@"macos:display:%u", display_id];
}

static NSString* source_id_for_window(CGWindowID window_id) {
    return [NSString stringWithFormat:@"macos:window:%u", window_id];
}

static NSString* source_id_for_application(NSString* bundle_id,
                                           pid_t process_id,
                                           CGDirectDisplayID display_id) {
    return [NSString stringWithFormat:@"macos:application:%@:%d:display:%u",
                                      bundle_id ?: @"unknown",
                                      process_id,
                                      display_id];
}

static SCDisplay* display_for_rect(NSArray<SCDisplay*>* displays, CGRect rect) {
    SCDisplay* best = nil;
    CGFloat best_area = 0;
    for (SCDisplay* display in displays) {
        CGRect intersection = CGRectIntersection(display.frame, rect);
        CGFloat area = CGRectIsNull(intersection) ? 0 : intersection.size.width * intersection.size.height;
        if (area > best_area) {
            best = display;
            best_area = area;
        }
    }
    return best ?: displays.firstObject;
}

static SCDisplay* display_for_application(NSArray<SCWindow*>* windows,
                                           NSArray<SCDisplay*>* displays,
                                           SCRunningApplication* application) {
    for (SCWindow* window in windows) {
        if (window.owningApplication.processID == application.processID) {
            return display_for_rect(displays, window.frame);
        }
    }
    return displays.firstObject;
}

static NSDictionary* video_audio_capabilities(bool video, bool audio) {
    return @{
        @"video": @(video),
        @"audio": @(audio),
        @"stereo": @(audio),
        @"channels": audio ? @2 : @0,
        @"sampleRate": audio ? @48000 : @0,
    };
}

static NSDictionary* source_dictionary(NSString* source_id,
                                       NSString* source_type,
                                       NSString* title,
                                       NSString* app_name,
                                       NSString* app_id,
                                       NSNumber* display_id,
                                       CGRect bounds,
                                       bool video,
                                       bool audio) {
    NSMutableDictionary* source = [NSMutableDictionary dictionaryWithDictionary:@{
        @"sourceId": source_id,
        @"sourceType": source_type,
        @"sourceKey": [NSString stringWithFormat:@"%@:%@", source_type, source_id],
        @"title": title ?: @"Untitled source",
        @"capabilities": video_audio_capabilities(video, audio),
        @"selfExcluded": @YES,
        @"available": @YES,
    }];
    if (app_name) source[@"appName"] = app_name;
    if (app_id) source[@"appId"] = app_id;
    if (display_id) source[@"displayId"] = display_id;
    source[@"bounds"] = @{
        @"x": @(bounds.origin.x),
        @"y": @(bounds.origin.y),
        @"width": @(bounds.size.width),
        @"height": @(bounds.size.height),
    };
    return source;
}

static char* json_string_from_object(id object) {
    NSError* error = nil;
    NSData* data = [NSJSONSerialization dataWithJSONObject:object options:0 error:&error];
    if (!data || error) return nullptr;
    const uint8_t* bytes = static_cast<const uint8_t*>(data.bytes);
    size_t length = data.length;
    char* result = static_cast<char*>(std::malloc(length + 1));
    if (!result) return nullptr;
    std::memcpy(result, bytes, length);
    result[length] = '\0';
    return result;
}

char* lib_dspeak_media_platform_capture_list_sources(void) {
    @autoreleasepool {
        if (!CGPreflightScreenCaptureAccess()) {
            return json_string_from_object(@[]);
        }

        __block SCShareableContent* content = nil;
        __block NSError* content_error = nil;
        dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
        [SCShareableContent getShareableContentExcludingDesktopWindows:YES
                                                    onScreenWindowsOnly:YES
                                                    completionHandler:^(SCShareableContent* value, NSError* error) {
            content = [value retain];
            content_error = [error retain];
            dispatch_semaphore_signal(semaphore);
        }];
        const long wait_result = dispatch_semaphore_wait(
            semaphore, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));
        dispatch_release(semaphore);
        if (wait_result != 0 || content_error || !content) {
            [content_error release];
            [content release];
            return json_string_from_object(@[]);
        }

        bool audio_available = false;
        if (@available(macOS 13.0, *)) audio_available = true;
        NSMutableArray* sources = [NSMutableArray array];
        NSArray<SCDisplay*>* displays = content.displays;

        for (SCDisplay* display in displays) {
            [sources addObject:source_dictionary(
                source_id_for_display(display.displayID),
                @"display",
                [NSString stringWithFormat:@"Display %u", display.displayID],
                nil,
                nil,
                @(display.displayID),
                display.frame,
                true,
                audio_available)];
        }

        for (SCWindow* window in content.windows) {
            if (!window.onScreen || window.windowLayer != 0) continue;
            SCDisplay* display = display_for_rect(displays, window.frame);
            if (!display) continue;
            SCRunningApplication* application = window.owningApplication;
            NSString* title = window.title.length ? window.title : @"Untitled window";
            NSString* app_name = application.applicationName;
            NSString* app_id = application.bundleIdentifier;
            [sources addObject:source_dictionary(
                source_id_for_window(window.windowID),
                @"window",
                title,
                app_name,
                app_id,
                @(display.displayID),
                window.frame,
                true,
                audio_available)];
        }

        for (SCRunningApplication* application in content.applications) {
            if (!application.bundleIdentifier.length) continue;
            SCDisplay* display = display_for_application(content.windows, displays, application);
            if (!display) continue;
            [sources addObject:source_dictionary(
                source_id_for_application(application.bundleIdentifier,
                                           application.processID,
                                           display.displayID),
                @"application",
                application.applicationName,
                application.applicationName,
                application.bundleIdentifier,
                @(display.displayID),
                display.frame,
                true,
                audio_available)];
        }

        if (audio_available && displays.count) {
            SCDisplay* display = displays.firstObject;
            [sources addObject:source_dictionary(
                @"macos:system-audio",
                @"system-audio",
                @"System audio",
                nil,
                nil,
                @(display.displayID),
                display.frame,
                false,
                true)];
        }

        [sources sortUsingComparator:^NSComparisonResult(NSDictionary* left, NSDictionary* right) {
            return [left[@"sourceId"] compare:right[@"sourceId"]];
        }];
        char* result = json_string_from_object(sources);
        [content_error release];
        [content release];
        return result;
    }
}

static SCShareableContent* current_shareable_content(NSError** error_out) {
    __block SCShareableContent* content = nil;
    __block NSError* content_error = nil;
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    [SCShareableContent getShareableContentExcludingDesktopWindows:YES
                                                onScreenWindowsOnly:YES
                                                completionHandler:^(SCShareableContent* value, NSError* error) {
        content = [value retain];
        content_error = [error retain];
        dispatch_semaphore_signal(semaphore);
    }];
    const long wait_result = dispatch_semaphore_wait(
        semaphore, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));
    dispatch_release(semaphore);
    if (wait_result != 0) {
        if (error_out) *error_out = [[NSError alloc] initWithDomain:@"dSpeakCapture"
                                                                code:-201
                                                            userInfo:@{NSLocalizedDescriptionKey: @"Timed out enumerating shareable content"}];
        [content_error release];
        [content release];
        return nil;
    }
    if (error_out) *error_out = content_error;
    else [content_error release];
    return content;
}

static SCDisplay* display_matching_id(NSArray<SCDisplay*>* displays, NSNumber* display_id) {
    if (!display_id) return displays.firstObject;
    for (SCDisplay* display in displays) {
        if (display.displayID == display_id.unsignedIntValue) return display;
    }
    return nil;
}

static SCContentFilter* filter_for_source(SCShareableContent* content,
                                           NSString* source_id,
                                           NSString* source_type,
                                           NSError** error_out) {
    if ([source_type isEqualToString:@"window"]) {
        for (SCWindow* window in content.windows) {
            if ([[source_id_for_window(window.windowID) lowercaseString] isEqualToString:[source_id lowercaseString]]) {
                return [[SCContentFilter alloc] initWithDesktopIndependentWindow:window];
            }
        }
    }

    if ([source_type isEqualToString:@"display"] || [source_type isEqualToString:@"system-audio"]) {
        for (SCDisplay* display in content.displays) {
            NSString* candidate = [source_id_for_display(display.displayID) lowercaseString];
            if ([candidate isEqualToString:[source_id lowercaseString]] || [source_type isEqualToString:@"system-audio"]) {
                return [[SCContentFilter alloc] initWithDisplay:display excludingWindows:@[]];
            }
        }
    }

    if ([source_type isEqualToString:@"application"]) {
        for (SCRunningApplication* application in content.applications) {
            for (SCDisplay* display in content.displays) {
                NSString* candidate = source_id_for_application(application.bundleIdentifier,
                                                                 application.processID,
                                                                 display.displayID);
                if ([candidate isEqualToString:source_id]) {
                    return [[SCContentFilter alloc] initWithDisplay:display
                                               includingApplications:@[application]
                                                    exceptingWindows:@[]];
                }
            }
        }
    }

    if (error_out) {
        *error_out = [[NSError alloc] initWithDomain:@"dSpeakCapture"
                                                code:-202
                                            userInfo:@{NSLocalizedDescriptionKey: @"Capture source is no longer available"}];
    }
    return nil;
}

static bool normalize_audio_sample(CMSampleBufferRef sample_buffer,
                                   std::vector<float>& output,
                                   uint32_t& frame_count) {
    CMFormatDescriptionRef format_description = CMSampleBufferGetFormatDescription(sample_buffer);
    const AudioStreamBasicDescription* asbd = format_description
        ? CMAudioFormatDescriptionGetStreamBasicDescription(format_description)
        : nullptr;
    if (!asbd || asbd->mFormatID != kAudioFormatLinearPCM ||
        asbd->mSampleRate != 48000.0 || asbd->mChannelsPerFrame != 2 ||
        asbd->mBitsPerChannel != 32 ||
        (asbd->mFormatFlags & kAudioFormatFlagIsFloat) == 0 ||
        (asbd->mFormatFlags & kAudioFormatFlagIsPacked) == 0) {
        return false;
    }

    const size_t frames = CMSampleBufferGetNumSamples(sample_buffer);
    if (frames == 0 || frames > UINT32_MAX) return false;

    size_t list_size = 0;
    OSStatus status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
        sample_buffer, &list_size, nullptr, 0, nullptr, nullptr, 0, nullptr);
    if (status != noErr && status != kCMSampleBufferError_ArrayTooSmall) return false;
    if (list_size < sizeof(AudioBufferList)) return false;

    std::vector<uint8_t> list_storage(list_size);
    AudioBufferList* buffer_list = reinterpret_cast<AudioBufferList*>(list_storage.data());
    CMBlockBufferRef block_buffer = nullptr;
    status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
        sample_buffer, nullptr, buffer_list, list_size, nullptr, nullptr, 0, &block_buffer);
    if (status != noErr || !block_buffer) {
        if (block_buffer) CFRelease(block_buffer);
        return false;
    }

    output.resize(frames * 2);
    const bool non_interleaved = (asbd->mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0;
    bool valid = false;
    if (!non_interleaved && buffer_list->mNumberBuffers == 1 &&
        buffer_list->mBuffers[0].mNumberChannels == 2 &&
        buffer_list->mBuffers[0].mDataByteSize >= frames * 2 * sizeof(float)) {
        const float* input = static_cast<const float*>(buffer_list->mBuffers[0].mData);
        if (input) {
            std::copy(input, input + output.size(), output.begin());
            valid = true;
        }
    } else if (non_interleaved && buffer_list->mNumberBuffers == 2 &&
               buffer_list->mBuffers[0].mNumberChannels == 1 &&
               buffer_list->mBuffers[1].mNumberChannels == 1 &&
               buffer_list->mBuffers[0].mDataByteSize >= frames * sizeof(float) &&
               buffer_list->mBuffers[1].mDataByteSize >= frames * sizeof(float)) {
        const float* left = static_cast<const float*>(buffer_list->mBuffers[0].mData);
        const float* right = static_cast<const float*>(buffer_list->mBuffers[1].mData);
        if (left && right) {
            for (size_t index = 0; index < frames; ++index) {
                output[index * 2] = left[index];
                output[index * 2 + 1] = right[index];
            }
            valid = true;
        }
    }
    CFRelease(block_buffer);
    if (!valid) {
        output.clear();
        return false;
    }
    frame_count = static_cast<uint32_t>(frames);
    return true;
}

@interface DSMStreamOutput : NSObject <SCStreamOutput>
- (instancetype)initWithSession:(lib_dspeak_media_capture_session*)session;
@end

@interface DSMStreamDelegate : NSObject <SCStreamDelegate>
- (instancetype)initWithSession:(lib_dspeak_media_capture_session*)session;
@end

@implementation DSMStreamOutput {
    lib_dspeak_media_capture_session* _session;
}

- (instancetype)initWithSession:(lib_dspeak_media_capture_session*)session {
    self = [super init];
    if (self) _session = session;
    return self;
}

- (void)stream:(SCStream*)stream
    didOutputSampleBuffer:(CMSampleBufferRef)sample_buffer
    ofType:(SCStreamOutputType)type {
    (void)stream;
    if (!sample_buffer || !_session) return;

    lib_dspeak_media_screen_frame_cb screen_cb = nullptr;
    lib_dspeak_media_audio_frame_cb audio_cb = nullptr;
    lib_dspeak_media_capture_error_cb error_cb = nullptr;
    void* user_data = nullptr;
    {
        std::lock_guard<std::mutex> lock(_session->mutex);
        if (!_session->running) return;
        screen_cb = _session->screen_cb;
        audio_cb = _session->audio_cb;
        error_cb = _session->error_cb;
        user_data = _session->user_data;
    }

    if (type == SCStreamOutputTypeScreen) {
        if (!screen_cb) return;
        CFRetain(sample_buffer);
        screen_cb(user_data, sample_buffer);
        return;
    }

    if (type != SCStreamOutputTypeAudio || !audio_cb) return;
    std::vector<float> normalized;
    uint32_t frame_count = 0;
    if (!normalize_audio_sample(sample_buffer, normalized, frame_count)) {
        if (error_cb) {
            error_cb(user_data, -204, "ScreenCaptureKit audio was not stereo 48 kHz float PCM");
        }
        return;
    }
    audio_cb(user_data, normalized.data(), frame_count, 48000, 2);
}
@end

@implementation DSMStreamDelegate {
    lib_dspeak_media_capture_session* _session;
}

- (instancetype)initWithSession:(lib_dspeak_media_capture_session*)session {
    self = [super init];
    if (self) _session = session;
    return self;
}

- (void)stream:(SCStream*)stream didStopWithError:(NSError*)error {
    (void)stream;
    if (!_session || !error) return;
    const char* message = error.localizedDescription.UTF8String;
    capture_report_error(_session, -205, message ?: "ScreenCaptureKit stopped the stream");
}
@end

static void capture_report_error(lib_dspeak_media_capture_session* session,
                                 int error_code,
                                 const char* message) {
    lib_dspeak_media_capture_error_cb callback = nullptr;
    void* user_data = nullptr;
    {
        std::lock_guard<std::mutex> lock(session->mutex);
        session->running = false;
        session->starting = false;
        callback = session->error_cb;
        user_data = session->user_data;
        session->state_changed.notify_all();
    }
    if (callback) callback(user_data, error_code, message ?: "Capture failed");
}

struct lib_dspeak_media_capture_session*
lib_dspeak_media_platform_capture_create(const char* source_id,
                                         const char* source_type,
                                         const char* mode,
                                         bool exclude_self_audio) {
    @autoreleasepool {
        NSString* source_id_string = string_from_utf8(source_id);
        NSString* source_type_string = string_from_utf8(source_type);
        NSString* mode_string = string_from_utf8(mode);
        if (!source_id_string || !source_type_string || !mode_string) return nullptr;
        bool capture_video = [mode_string isEqualToString:@"video"] || [mode_string isEqualToString:@"both"];
        bool capture_audio = [mode_string isEqualToString:@"audio"] || [mode_string isEqualToString:@"both"];
        if (!capture_video && !capture_audio) return nullptr;
        if ([source_type_string isEqualToString:@"system-audio"] && capture_video) return nullptr;
        bool audio_available = false;
        if (@available(macOS 13.0, *)) audio_available = true;
        if (capture_audio && !audio_available) return nullptr;
        if (capture_audio && !exclude_self_audio) return nullptr;

        auto* session = new(std::nothrow) lib_dspeak_media_capture_session();
        if (!session) return nullptr;
        session->capture_video = capture_video;
        session->capture_audio = capture_audio;
        session->exclude_self_audio = exclude_self_audio;
        session->source_id = [source_id_string retain];
        session->source_type = [source_type_string retain];
        if (capture_video) {
            session->video_queue = dispatch_queue_create("com.dspeaks.media.capture.video", DISPATCH_QUEUE_SERIAL);
        }
        if (capture_audio) {
            session->audio_queue = dispatch_queue_create("com.dspeaks.media.capture.audio", DISPATCH_QUEUE_SERIAL);
        }
        if ((capture_video && !session->video_queue) || (capture_audio && !session->audio_queue)) {
            if (session->video_queue) dispatch_release(session->video_queue);
            if (session->audio_queue) dispatch_release(session->audio_queue);
            [session->source_id release];
            [session->source_type release];
            delete session;
            return nullptr;
        }
        return session;
    }
}

int lib_dspeak_media_platform_capture_start(
    struct lib_dspeak_media_capture_session* session,
    lib_dspeak_media_screen_frame_cb screen_cb,
    lib_dspeak_media_audio_frame_cb audio_cb,
    lib_dspeak_media_capture_error_cb error_cb,
    void* user_data) {
    if (!session) return -200;
    {
        std::lock_guard<std::mutex> lock(session->mutex);
        if (session->running || session->starting) return 0;
        session->screen_cb = screen_cb;
        session->audio_cb = audio_cb;
        session->error_cb = error_cb;
        session->user_data = user_data;
        session->starting = true;
    }

    @autoreleasepool {
        NSError* content_error = nil;
        SCShareableContent* content = current_shareable_content(&content_error);
        if (!content) {
            const char* message = content_error.localizedDescription.UTF8String;
            capture_report_error(session, -201, message ?: "Unable to enumerate shareable content");
            [content_error release];
            return -201;
        }

        NSError* filter_error = nil;
        SCContentFilter* filter = filter_for_source(content,
                                                     session->source_id,
                                                     session->source_type,
                                                     &filter_error);
        [content release];
        if (!filter) {
            const char* message = filter_error.localizedDescription.UTF8String;
            capture_report_error(session, -202, message ?: "Capture source is no longer available");
            [filter_error release];
            return -202;
        }

        SCStreamConfiguration* configuration = [[SCStreamConfiguration alloc] init];
        configuration.width = 1920;
        configuration.height = 1080;
        configuration.minimumFrameInterval = CMTimeMake(1, 60);
        configuration.queueDepth = 2;
        configuration.pixelFormat = kCVPixelFormatType_32BGRA;
        configuration.showsCursor = YES;
        if (session->capture_audio) {
            if (@available(macOS 13.0, *)) {
                configuration.capturesAudio = YES;
                configuration.sampleRate = 48000;
                configuration.channelCount = 2;
                configuration.excludesCurrentProcessAudio = YES;
            } else {
                [configuration release];
                [filter release];
                capture_report_error(session, -203, "ScreenCaptureKit audio requires macOS 13 or later");
                return -203;
            }
        }

        DSMStreamOutput* output = [[DSMStreamOutput alloc] initWithSession:session];
        DSMStreamDelegate* delegate = [[DSMStreamDelegate alloc] initWithSession:session];
        SCStream* stream = [[SCStream alloc] initWithFilter:filter
                                              configuration:configuration
                                                   delegate:delegate];
        [configuration release];
        [filter release];
        if (!stream || !output || !delegate) {
            [stream release];
            [output release];
            [delegate release];
            capture_report_error(session, -206, "Unable to create ScreenCaptureKit stream");
            return -206;
        }

        NSError* output_error = nil;
        if (session->capture_video) {
            BOOL added = [stream addStreamOutput:output
                                            type:SCStreamOutputTypeScreen
                              sampleHandlerQueue:session->video_queue
                                             error:&output_error];
            if (!added || output_error) {
                const char* message = output_error.localizedDescription.UTF8String;
                [stream release];
                [output release];
                [delegate release];
                capture_report_error(session, -207, message ?: "Unable to add screen capture output");
                return -207;
            }
        }
        if (session->capture_audio) {
            if (@available(macOS 13.0, *)) {
                output_error = nil;
                BOOL added = [stream addStreamOutput:output
                                                type:SCStreamOutputTypeAudio
                                  sampleHandlerQueue:session->audio_queue
                                                 error:&output_error];
                if (!added || output_error) {
                    const char* message = output_error.localizedDescription.UTF8String;
                    [stream release];
                    [output release];
                    [delegate release];
                    capture_report_error(session, -208, message ?: "Unable to add audio capture output");
                    return -208;
                }
            } else {
                [stream release];
                [output release];
                [delegate release];
                capture_report_error(session, -203, "ScreenCaptureKit audio requires macOS 13 or later");
                return -203;
            }
        }

        {
            std::lock_guard<std::mutex> lock(session->mutex);
            session->stream = stream;
            session->output = output;
            session->delegate = delegate;
        }

        __block NSError* start_error = nil;
        dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
        [stream startCaptureWithCompletionHandler:^(NSError* error) {
            start_error = [error retain];
            dispatch_semaphore_signal(semaphore);
        }];
        const long wait_result = dispatch_semaphore_wait(
            semaphore, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));
        dispatch_release(semaphore);
        if (wait_result != 0 || start_error) {
            const char* message = start_error.localizedDescription.UTF8String;
            lib_dspeak_media_platform_capture_stop(session);
            [start_error release];
            capture_report_error(session, -209, message ?: "Timed out starting ScreenCaptureKit");
            return -209;
        }
        [start_error release];
        {
            std::lock_guard<std::mutex> lock(session->mutex);
            session->starting = false;
            session->running = true;
            session->state_changed.notify_all();
        }
        return 0;
    }
}

void lib_dspeak_media_platform_capture_stop(struct lib_dspeak_media_capture_session* session) {
    if (!session) return;
    SCStream* stream = nil;
    {
        std::lock_guard<std::mutex> lock(session->mutex);
        if (session->stopping) return;
        session->running = false;
        session->starting = false;
        stream = [session->stream retain];
        if (!stream) {
            session->state_changed.notify_all();
            return;
        }
        session->stopping = true;
    }

    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    [stream stopCaptureWithCompletionHandler:^(NSError* error) {
        (void)error;
        dispatch_semaphore_signal(semaphore);
    }];
    dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));
    dispatch_release(semaphore);

    {
        std::lock_guard<std::mutex> lock(session->mutex);
        if (session->stream == stream) {
            [session->stream release];
            session->stream = nil;
        }
        [session->output release];
        session->output = nil;
        [session->delegate release];
        session->delegate = nil;
        session->stopping = false;
        session->state_changed.notify_all();
    }
    [stream release];
}

void lib_dspeak_media_platform_capture_destroy(struct lib_dspeak_media_capture_session* session) {
    if (!session) return;
    lib_dspeak_media_platform_capture_stop(session);
    if (session->video_queue) dispatch_release(session->video_queue);
    if (session->audio_queue) dispatch_release(session->audio_queue);
    [session->source_id release];
    [session->source_type release];
    delete session;
}

#endif
