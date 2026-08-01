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
#include <cstdio>
#include <mutex>
#include <new>
#include <string>
#include <unistd.h>
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
    uint32_t video_width = 1920;
    uint32_t video_height = 1080;
    uint32_t video_frame_rate = 60;
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

static bool is_current_process(SCRunningApplication* application) {
    return application && application.processID == getpid();
}

static NSArray<SCRunningApplication*>* current_process_exclusions(
    SCShareableContent* content) {
    NSMutableArray<SCRunningApplication*>* exclusions = [NSMutableArray array];
    for (SCRunningApplication* application in content.applications) {
        if (is_current_process(application)) [exclusions addObject:application];
    }
    return exclusions;
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
                                       bool audio,
                                       bool self_excluded) {
    NSMutableDictionary* source = [NSMutableDictionary dictionaryWithDictionary:@{
        @"sourceId": source_id,
        @"sourceType": source_type,
        @"sourceKey": [NSString stringWithFormat:@"%@:%@", source_type, source_id],
        @"title": title ?: @"Untitled source",
        @"capabilities": video_audio_capabilities(video, audio),
        @"selfExcluded": @(self_excluded),
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
                audio_available,
                true)];
        }

        for (SCWindow* window in content.windows) {
            if (!window.onScreen || window.windowLayer != 0) continue;
            SCDisplay* display = display_for_rect(displays, window.frame);
            if (!display) continue;
            SCRunningApplication* application = window.owningApplication;
            if (is_current_process(application)) continue;
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
                audio_available,
                true)];
        }

        for (SCRunningApplication* application in content.applications) {
            if (!application.bundleIdentifier.length || is_current_process(application)) continue;
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
                audio_available,
                true)];
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
                true,
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
        NSArray<SCRunningApplication*>* exclusions = current_process_exclusions(content);
        for (SCDisplay* display in content.displays) {
            NSString* candidate = [source_id_for_display(display.displayID) lowercaseString];
            if ([candidate isEqualToString:[source_id lowercaseString]] || [source_type isEqualToString:@"system-audio"]) {
                return [[SCContentFilter alloc] initWithDisplay:display
                                         excludingApplications:exclusions
                                                exceptingWindows:@[]];
            }
        }
    }

    if ([source_type isEqualToString:@"application"]) {
        for (SCRunningApplication* application in content.applications) {
            for (SCDisplay* display in content.displays) {
                NSString* candidate = source_id_for_application(application.bundleIdentifier,
                                                                 application.processID,
                                                                 display.displayID);
                if ([[candidate lowercaseString] isEqualToString:[source_id lowercaseString]]) {
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
                                         bool exclude_self_audio,
                                         uint32_t video_width,
                                         uint32_t video_height,
                                         uint32_t video_frame_rate) {
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
        session->video_width = video_width >= 320 && video_width <= 7680 ? video_width : 1920;
        session->video_height = video_height >= 180 && video_height <= 4320 ? video_height : 1080;
        session->video_frame_rate = video_frame_rate >= 1 && video_frame_rate <= 60 ? video_frame_rate : 60;
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
        configuration.width = session->video_width;
        configuration.height = session->video_height;
        configuration.minimumFrameInterval = CMTimeMake(1, session->video_frame_rate);
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

static NSString* device_id_from_source_id(NSString* source_id, NSString* kind) {
    if (!source_id) return nil;
    NSString* prefix = [NSString stringWithFormat:@"macos:%@:", kind];
    if ([source_id hasPrefix:prefix]) return [source_id substringFromIndex:prefix.length];
    return source_id;
}

static NSDictionary* device_dictionary(AVCaptureDevice* device, NSString* kind) {
    NSString* unique_id = device.uniqueID ?: @"";
    bool microphone = [kind isEqualToString:@"microphone"];
    NSString* source_id = [NSString stringWithFormat:@"macos:%@:%@", kind, unique_id];
    NSMutableDictionary* result = [NSMutableDictionary dictionaryWithDictionary:@{
        @"deviceId": unique_id,
        @"sourceId": source_id,
        @"sourceType": kind,
        @"sourceKey": [NSString stringWithFormat:@"%@:%@", kind, source_id],
        @"title": device.localizedName ?: @"Unnamed device",
        @"label": device.localizedName ?: @"Unnamed device",
        @"available": @YES,
        @"capabilities": microphone ? @{
            @"audio": @YES,
            @"video": @NO,
            @"stereo": @YES,
            @"channels": @2,
            @"sampleRate": @48000,
        } : @{
            @"audio": @NO,
            @"video": @YES,
            @"stereo": @NO,
            @"channels": @0,
            @"sampleRate": @0,
        },
    }];
    return result;
}

static NSArray* capture_device_sources(void) {
    NSMutableArray* devices = [NSMutableArray array];
    NSArray* microphones = [AVCaptureDevice devicesWithMediaType:AVMediaTypeAudio];
    for (AVCaptureDevice* device in microphones) {
        [devices addObject:device_dictionary(device, @"microphone")];
    }
    NSArray* cameras = [AVCaptureDevice devicesWithMediaType:AVMediaTypeVideo];
    for (AVCaptureDevice* device in cameras) {
        [devices addObject:device_dictionary(device, @"camera")];
    }
    [devices sortUsingComparator:^NSComparisonResult(NSDictionary* left, NSDictionary* right) {
        return [left[@"deviceId"] compare:right[@"deviceId"]];
    }];
    return devices;
}

char* lib_dspeak_media_platform_capture_list_devices(void) {
    @autoreleasepool {
        return json_string_from_object(capture_device_sources());
    }
}

char* lib_dspeak_media_platform_capture_capabilities(void) {
    @autoreleasepool {
        NSArray* sources = capture_device_sources();
        NSMutableArray* microphones = [NSMutableArray array];
        NSMutableArray* cameras = [NSMutableArray array];
        for (NSDictionary* source in sources) {
            if ([source[@"sourceType"] isEqualToString:@"microphone"]) {
                [microphones addObject:source];
            } else if ([source[@"sourceType"] isEqualToString:@"camera"]) {
                [cameras addObject:source];
            }
        }
        bool microphone_available = microphones.count > 0;
        bool camera_available = cameras.count > 0;
        NSDictionary* result = @{
            @"microphone": @{
                @"available": @(microphone_available),
                @"reason": microphone_available
                    ? @"AVAudioEngine has an enumerated CoreAudio input device"
                    : @"No CoreAudio input device is available",
                @"sources": microphones,
            },
            @"camera": @{
                @"available": @(camera_available),
                @"reason": camera_available
                    ? @"AVCaptureSession has an enumerated camera device"
                    : @"No AVCaptureSession camera device is available",
                @"sources": cameras,
            },
        };
        return json_string_from_object(result);
    }
}

static AudioDeviceID core_audio_device_for_uid(NSString* uid) {
    if (!uid.length) return kAudioObjectUnknown;
    AudioObjectPropertyAddress address = {
        kAudioHardwarePropertyDevices,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain,
    };
    UInt32 data_size = 0;
    if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &address, 0, nullptr, &data_size) != noErr ||
        data_size < sizeof(AudioDeviceID)) return kAudioObjectUnknown;
    std::vector<AudioDeviceID> devices(data_size / sizeof(AudioDeviceID));
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, 0, nullptr,
                                   &data_size, devices.data()) != noErr) return kAudioObjectUnknown;
    address.mSelector = kAudioDevicePropertyDeviceUID;
    address.mScope = kAudioObjectPropertyScopeGlobal;
    for (AudioDeviceID device : devices) {
        CFStringRef device_uid = nullptr;
        UInt32 uid_size = sizeof(device_uid);
        if (AudioObjectGetPropertyData(device, &address, 0, nullptr, &uid_size, &device_uid) != noErr ||
            !device_uid) continue;
        bool matches = CFStringCompare(device_uid, (__bridge CFStringRef)uid, 0) == kCFCompareEqualTo;
        CFRelease(device_uid);
        if (matches) return device;
    }
    return kAudioObjectUnknown;
}

static int device_capture_permission(NSString* media_type) {
    AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:media_type];
    if (status == AVAuthorizationStatusAuthorized) return 0;
    if (status == AVAuthorizationStatusDenied || status == AVAuthorizationStatusRestricted) return -220;
    __block bool granted = false;
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    [AVCaptureDevice requestAccessForMediaType:media_type completionHandler:^(BOOL value) {
        granted = value;
        dispatch_semaphore_signal(semaphore);
    }];
    dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC));
    dispatch_release(semaphore);
    return granted ? 0 : -220;
}

struct lib_dspeak_media_device_capture_session {
    std::mutex mutex;
    std::condition_variable state_changed;
    bool starting = false;
    bool running = false;
    bool stopping = false;
    bool error_reported = false;
    uint32_t in_flight_callbacks = 0;
    bool microphone = false;
    lib_dspeak_media_screen_frame_cb screen_cb = nullptr;
    lib_dspeak_media_audio_frame_cb audio_cb = nullptr;
    lib_dspeak_media_capture_error_cb error_cb = nullptr;
    void* user_data = nullptr;
    NSString* device_id = nil;
    AVAudioEngine* audio_engine = nil;
    AVAudioInputNode* audio_input = nil;
    AVAudioMixerNode* audio_mixer = nil;
    AVAudioFormat* audio_format = nil;
    AVCaptureSession* camera_session = nil;
    AVCaptureDeviceInput* camera_input = nil;
    AVCaptureVideoDataOutput* camera_output = nil;
    id camera_delegate = nil;
    dispatch_queue_t queue = nullptr;
};

static bool device_capture_begin_callback(lib_dspeak_media_device_capture_session* session,
                                           lib_dspeak_media_screen_frame_cb* screen_cb,
                                           lib_dspeak_media_audio_frame_cb* audio_cb,
                                           void** user_data) {
    std::lock_guard<std::mutex> lock(session->mutex);
    if (!session->running) return false;
    session->in_flight_callbacks += 1;
    *screen_cb = session->screen_cb;
    *audio_cb = session->audio_cb;
    *user_data = session->user_data;
    return true;
}

static void device_capture_end_callback(lib_dspeak_media_device_capture_session* session) {
    std::lock_guard<std::mutex> lock(session->mutex);
    if (session->in_flight_callbacks > 0) session->in_flight_callbacks -= 1;
    session->state_changed.notify_all();
}

static void device_capture_report_error(lib_dspeak_media_device_capture_session* session,
                                        int error_code,
                                        const char* message) {
    fprintf(stderr, "[dspeak:capture] device-error code=%d message=%s\n",
            error_code, message ?: "Native device capture failed");
    lib_dspeak_media_capture_error_cb callback = nullptr;
    void* user_data = nullptr;
    {
        std::lock_guard<std::mutex> lock(session->mutex);
        if (session->error_reported) return;
        session->error_reported = true;
        session->running = false;
        session->starting = false;
        callback = session->error_cb;
        user_data = session->user_data;
        session->screen_cb = nullptr;
        session->audio_cb = nullptr;
        session->state_changed.notify_all();
    }
    if (callback) callback(user_data, error_code, message ?: "Native device capture failed");
}

@interface DSMDeviceCameraDelegate : NSObject <AVCaptureVideoDataOutputSampleBufferDelegate>
- (instancetype)initWithSession:(lib_dspeak_media_device_capture_session*)session;
@end

@implementation DSMDeviceCameraDelegate {
    lib_dspeak_media_device_capture_session* _session;
}

- (instancetype)initWithSession:(lib_dspeak_media_device_capture_session*)session {
    self = [super init];
    if (self) _session = session;
    return self;
}

- (void)captureOutput:(AVCaptureOutput*)output
    didOutputSampleBuffer:(CMSampleBufferRef)sample_buffer
    fromConnection:(AVCaptureConnection*)connection {
    (void)output;
    (void)connection;
    if (!_session || !sample_buffer) return;
    lib_dspeak_media_screen_frame_cb screen_cb = nullptr;
    lib_dspeak_media_audio_frame_cb audio_cb = nullptr;
    void* user_data = nullptr;
    if (!device_capture_begin_callback(_session, &screen_cb, &audio_cb, &user_data)) return;
    if (screen_cb) {
        CFRetain(sample_buffer);
        screen_cb(user_data, sample_buffer);
    }
    device_capture_end_callback(_session);
}
@end

static bool audio_buffer_to_stereo(AVAudioPCMBuffer* buffer,
                                   std::vector<float>& samples,
                                   uint32_t& frame_count) {
    AVAudioFormat* format = buffer.format;
    if (!format || format.sampleRate != 48000.0 || format.channelCount != 2 ||
        format.commonFormat != AVAudioPCMFormatFloat32 || buffer.frameLength == 0) return false;
    const uint32_t frames = buffer.frameLength;
    if (frames > UINT32_MAX) return false;
    samples.resize(static_cast<size_t>(frames) * 2);
    const AudioBufferList* list = buffer.audioBufferList;
    if (!list) return false;
    if (format.isInterleaved) {
        if (list->mNumberBuffers != 1 || list->mBuffers[0].mNumberChannels != 2 ||
            list->mBuffers[0].mDataByteSize < samples.size() * sizeof(float) ||
            !list->mBuffers[0].mData) return false;
        const float* input = static_cast<const float*>(list->mBuffers[0].mData);
        std::copy(input, input + samples.size(), samples.begin());
    } else {
        if (list->mNumberBuffers != 2 || !list->mBuffers[0].mData || !list->mBuffers[1].mData ||
            list->mBuffers[0].mDataByteSize < frames * sizeof(float) ||
            list->mBuffers[1].mDataByteSize < frames * sizeof(float)) return false;
        const float* left = static_cast<const float*>(list->mBuffers[0].mData);
        const float* right = static_cast<const float*>(list->mBuffers[1].mData);
        for (uint32_t index = 0; index < frames; ++index) {
            samples[static_cast<size_t>(index) * 2] = left[index];
            samples[static_cast<size_t>(index) * 2 + 1] = right[index];
        }
    }
    frame_count = frames;
    return true;
}

static void device_capture_cleanup(lib_dspeak_media_device_capture_session* session) {
    AVAudioEngine* audio_engine = nil;
    AVAudioInputNode* audio_input = nil;
    AVAudioMixerNode* audio_mixer = nil;
    AVAudioFormat* audio_format = nil;
    AVCaptureSession* camera_session = nil;
    AVCaptureVideoDataOutput* camera_output = nil;
    AVCaptureDeviceInput* camera_input = nil;
    id camera_delegate = nil;
    dispatch_queue_t queue = nullptr;
    {
        std::lock_guard<std::mutex> lock(session->mutex);
        audio_engine = session->audio_engine;
        audio_input = session->audio_input;
        audio_mixer = session->audio_mixer;
        audio_format = session->audio_format;
        camera_session = session->camera_session;
        camera_input = session->camera_input;
        camera_output = session->camera_output;
        camera_delegate = session->camera_delegate;
        queue = session->queue;
        session->audio_engine = nil;
        session->audio_input = nil;
        session->audio_mixer = nil;
        session->audio_format = nil;
        session->camera_session = nil;
        session->camera_input = nil;
        session->camera_output = nil;
        session->camera_delegate = nil;
        session->queue = nullptr;
    }
    if (audio_mixer) {
        @try {
            [audio_mixer removeTapOnBus:0];
        } @catch (NSException* exception) {
            (void)exception;
        }
    }
    if (audio_engine) [audio_engine stop];
    if (camera_output) [camera_output setSampleBufferDelegate:nil queue:nil];
    if (camera_session && camera_session.isRunning) [camera_session stopRunning];
    if (camera_session && camera_input) [camera_session removeInput:camera_input];
    if (camera_session && camera_output) [camera_session removeOutput:camera_output];
    {
        std::unique_lock<std::mutex> lock(session->mutex);
        session->state_changed.wait(lock, [session] { return session->in_flight_callbacks == 0; });
        [audio_engine release];
        [audio_mixer release];
        [camera_session release];
        [camera_output release];
        [camera_input release];
        [camera_delegate release];
        [audio_input release];
        [audio_format release];
        if (queue) dispatch_release(queue);
    }
}

struct lib_dspeak_media_device_capture_session*
lib_dspeak_media_platform_device_capture_create(const char* device_id,
                                                const char* kind) {
    @autoreleasepool {
        NSString* device_id_string = string_from_utf8(device_id);
        NSString* kind_string = string_from_utf8(kind);
        if (!kind_string || (![kind_string isEqualToString:@"microphone"] &&
                             ![kind_string isEqualToString:@"camera"])) {
            fprintf(stderr, "[dspeak:capture] device-create rejected kind=%s\n", kind ?: "<null>");
            return nullptr;
        }
        auto* session = new(std::nothrow) lib_dspeak_media_device_capture_session();
        if (!session) {
            fprintf(stderr, "[dspeak:capture] device-create allocation failed kind=%s\n", kind);
            return nullptr;
        }
        session->microphone = [kind_string isEqualToString:@"microphone"];
        session->device_id = [device_id_string retain];
        session->queue = dispatch_queue_create(
            session->microphone ? "com.dspeaks.media.capture.microphone" :
                                  "com.dspeaks.media.capture.camera",
            DISPATCH_QUEUE_SERIAL);
        if (!session->queue) {
            fprintf(stderr, "[dspeak:capture] device-create queue failed kind=%s\n", kind);
            [session->device_id release];
            delete session;
            return nullptr;
        }
        fprintf(stderr, "[dspeak:capture] device-create success kind=%s device=%s\n",
                kind, device_id ?: "<default>");
        return session;
    }
}

int lib_dspeak_media_platform_device_capture_start(
    struct lib_dspeak_media_device_capture_session* session,
    lib_dspeak_media_screen_frame_cb screen_cb,
    lib_dspeak_media_audio_frame_cb audio_cb,
    lib_dspeak_media_capture_error_cb error_cb,
    void* user_data) {
    if (!session) return -224;
    {
        std::unique_lock<std::mutex> lock(session->mutex);
        while (session->starting || session->stopping) {
            session->state_changed.wait(lock);
        }
        if (session->running) return 0;
        session->starting = true;
        session->error_reported = false;
        session->screen_cb = screen_cb;
        session->audio_cb = audio_cb;
        session->error_cb = error_cb;
        session->user_data = user_data;
    }
    @autoreleasepool {
        const int permission_error = device_capture_permission(
            session->microphone ? AVMediaTypeAudio : AVMediaTypeVideo);
        if (permission_error != 0) {
            device_capture_report_error(session, permission_error,
                                         session->microphone ?
                                         "Microphone permission was denied" :
                                         "Camera permission was denied");
            device_capture_cleanup(session);
            return permission_error;
        }
        if (session->microphone) {
            AVAudioEngine* engine = [[AVAudioEngine alloc] init];
            AVAudioInputNode* input = [engine inputNode];
            AVAudioMixerNode* mixer = [[AVAudioMixerNode alloc] init];
            AVAudioFormat* format = [[AVAudioFormat alloc] initStandardFormatWithSampleRate:48000.0
                                                                                      channels:2];
            if (!engine || !input || !mixer || !format) {
                [engine release];
                [mixer release];
                [format release];
                device_capture_report_error(session, -224, "AVAudioEngine microphone graph could not be created");
                device_capture_cleanup(session);
                return -224;
            }
            NSString* core_audio_uid = device_id_from_source_id(session->device_id, @"microphone");
            if (core_audio_uid.length) {
                AudioDeviceID device = core_audio_device_for_uid(core_audio_uid);
                if (device == kAudioObjectUnknown ||
                    AudioUnitSetProperty(input.audioUnit, kAudioOutputUnitProperty_CurrentDevice,
                                         kAudioUnitScope_Global, 0, &device, sizeof(device)) != noErr) {
                    [engine release];
                    [mixer release];
                    [format release];
                    device_capture_report_error(session, -225, "Selected microphone is not available");
                    device_capture_cleanup(session);
                    return -225;
                }
            }
            @try {
                [engine attachNode:mixer];
                [engine connect:input to:mixer format:nil];
                [engine connect:mixer to:engine.mainMixerNode format:format];
                __block lib_dspeak_media_device_capture_session* block_session = session;
                [mixer installTapOnBus:0 bufferSize:480 format:format block:^(AVAudioPCMBuffer* buffer,
                                                                                   AVAudioTime* time) {
                    (void)time;
                    if (!block_session || !buffer) return;
                    lib_dspeak_media_screen_frame_cb screen_callback = nullptr;
                    lib_dspeak_media_audio_frame_cb audio_callback = nullptr;
                    void* callback_user_data = nullptr;
                    if (!device_capture_begin_callback(block_session, &screen_callback,
                                                       &audio_callback, &callback_user_data)) return;
                    std::vector<float> samples;
                    uint32_t frame_count = 0;
                    if (!audio_buffer_to_stereo(buffer, samples, frame_count)) {
                        device_capture_report_error(block_session, -222,
                                                    "AVAudioEngine did not deliver real stereo 48 kHz float PCM");
                    } else if (audio_callback) {
                        dispatch_queue_t callback_queue = nullptr;
                        {
                            std::lock_guard<std::mutex> lock(block_session->mutex);
                            callback_queue = block_session->queue;
                        }
                        auto* queued_samples = new std::vector<float>(std::move(samples));
                        dispatch_async(callback_queue, ^{
                            audio_callback(callback_user_data, queued_samples->data(), frame_count, 48000, 2);
                            delete queued_samples;
                            device_capture_end_callback(block_session);
                        });
                        return;
                    }
                    device_capture_end_callback(block_session);
                }];
            } @catch (NSException* exception) {
                NSString* description = exception.reason ?: @"AVAudioEngine microphone graph failed";
                const char* message = description.UTF8String;
                fprintf(stderr, "[dspeak:capture] microphone-graph exception=%s\n",
                        message ?: "AVAudioEngine microphone graph failed");
                [engine release];
                [mixer release];
                [format release];
                device_capture_report_error(session, -224, message);
                device_capture_cleanup(session);
                return -224;
            }
            {
                std::lock_guard<std::mutex> lock(session->mutex);
                session->audio_engine = engine;
                session->audio_input = [input retain];
                session->audio_mixer = mixer;
                session->audio_format = format;
            }
            [engine prepare];
            NSError* start_error = nil;
            if (![engine startAndReturnError:&start_error]) {
                const char* message = start_error.localizedDescription.UTF8String;
                device_capture_report_error(session, -221,
                                             message ?: "AVAudioEngine microphone failed to start");
                device_capture_cleanup(session);
                return -221;
            }
        } else {
            AVCaptureDevice* device = nil;
            NSString* selected_id = device_id_from_source_id(session->device_id, @"camera");
            if (selected_id.length) {
                device = [AVCaptureDevice deviceWithUniqueID:selected_id];
            } else {
                device = [AVCaptureDevice defaultDeviceWithMediaType:AVMediaTypeVideo];
            }
            if (!device) {
                device_capture_report_error(session, -224, "Selected camera is not available");
                device_capture_cleanup(session);
                return -224;
            }
            NSError* input_error = nil;
            AVCaptureDeviceInput* input = [[AVCaptureDeviceInput alloc] initWithDevice:device error:&input_error];
            AVCaptureSession* capture_session = [[AVCaptureSession alloc] init];
            AVCaptureVideoDataOutput* output = [[AVCaptureVideoDataOutput alloc] init];
            DSMDeviceCameraDelegate* delegate = [[DSMDeviceCameraDelegate alloc] initWithSession:session];
            if (!input || !capture_session || !output || !delegate) {
                [input release];
                [capture_session release];
                [output release];
                [delegate release];
                device_capture_report_error(session, -223, input_error.localizedDescription.UTF8String);
                device_capture_cleanup(session);
                return -223;
            }
            @try {
                [capture_session beginConfiguration];
                if ([capture_session canSetSessionPreset:AVCaptureSessionPresetHigh]) {
                    capture_session.sessionPreset = AVCaptureSessionPresetHigh;
                }
                output.videoSettings = @{(id)kCVPixelBufferPixelFormatTypeKey: @(kCVPixelFormatType_32BGRA)};
                output.alwaysDiscardsLateVideoFrames = YES;
                if (![capture_session canAddInput:input] || ![capture_session canAddOutput:output]) {
                    [capture_session commitConfiguration];
                    [input release];
                    [capture_session release];
                    [output release];
                    [delegate release];
                    device_capture_report_error(session, -223, "AVCaptureSession rejected the camera graph");
                    device_capture_cleanup(session);
                    return -223;
                }
                [capture_session addInput:input];
                [capture_session addOutput:output];
                [capture_session commitConfiguration];
                [output setSampleBufferDelegate:delegate queue:session->queue];
            } @catch (NSException* exception) {
                [capture_session commitConfiguration];
                NSString* description = exception.reason ?: @"AVCaptureSession camera graph failed";
                const char* message = description.UTF8String;
                [input release];
                [capture_session release];
                [output release];
                [delegate release];
                device_capture_report_error(session, -223, message);
                device_capture_cleanup(session);
                return -223;
            }
            {
                std::lock_guard<std::mutex> lock(session->mutex);
                session->camera_session = capture_session;
                session->camera_input = input;
                session->camera_output = output;
                session->camera_delegate = delegate;
            }
            [capture_session startRunning];
        }
        {
            std::lock_guard<std::mutex> lock(session->mutex);
            session->starting = false;
            session->running = true;
            session->state_changed.notify_all();
        }
        return 0;
    }
}

void lib_dspeak_media_platform_device_capture_stop(
    struct lib_dspeak_media_device_capture_session* session) {
    if (!session) return;
    {
        std::unique_lock<std::mutex> lock(session->mutex);
        while (session->starting) session->state_changed.wait(lock);
        if (session->stopping) {
            session->state_changed.wait(lock, [session] { return !session->stopping; });
            return;
        }
        const bool has_resources = session->audio_engine || session->camera_session || session->queue;
        if (!session->running && !has_resources) return;
        session->running = false;
        session->screen_cb = nullptr;
        session->audio_cb = nullptr;
        session->error_cb = nullptr;
        session->user_data = nullptr;
        session->stopping = true;
    }
    device_capture_cleanup(session);
    {
        std::lock_guard<std::mutex> lock(session->mutex);
        session->stopping = false;
        session->state_changed.notify_all();
    }
}

void lib_dspeak_media_platform_device_capture_destroy(
    struct lib_dspeak_media_device_capture_session* session) {
    if (!session) return;
    lib_dspeak_media_platform_device_capture_stop(session);
    [session->device_id release];
    delete session;
}

#endif
