#include "PlatformCaptureMacosInternal.h"

#include <ScreenCaptureKit/ScreenCaptureKit.h>
#include <AVFoundation/AVFoundation.h>
#include <CoreAudio/CoreAudio.h>
#include <CoreGraphics/CoreGraphics.h>
#include <CoreMedia/CoreMedia.h>
#include <CoreVideo/CoreVideo.h>
#include <AudioToolbox/AudioToolbox.h>
#include <dispatch/dispatch.h>

#include <algorithm>
#include <atomic>
#include <condition_variable>
#include <cmath>
#include <cstring>
#include <cstdio>
#include <mutex>
#include <new>
#include <string>
#include <deque>
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
    bool stop_requested = false;
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
    std::atomic<bool> audio_sample_logged{false};
    std::atomic<bool> audio_normalization_error_logged{false};
    std::atomic<bool> audio_normalized_sample_logged{false};
};

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

static bool application_visible_on_display(NSArray<SCWindow*>* windows,
                                            SCDisplay* display,
                                            SCRunningApplication* application) {
    if (!display || !application) return false;
    for (SCWindow* window in windows) {
        if (!window.onScreen || window.windowLayer != 0 ||
            window.owningApplication.processID != application.processID)
            continue;
        CGRect intersection = CGRectIntersection(display.frame, window.frame);
        if (!CGRectIsNull(intersection) && intersection.size.width > 0 &&
            intersection.size.height > 0)
            return true;
    }
    return false;
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

char* lib_dspeak_media_platform_capture_list_sources(void) {
    @autoreleasepool {
        if (!CGPreflightScreenCaptureAccess() && !CGRequestScreenCaptureAccess()) {
            return macos_json_string_from_object(@[]);
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
            return macos_json_string_from_object(@[]);
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
            for (SCDisplay* display in displays) {
                if (!application_visible_on_display(content.windows, display, application))
                    continue;
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
        char* result = macos_json_string_from_object(sources);
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
                if (is_current_process(window.owningApplication)) break;
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
            if (is_current_process(application)) continue;
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
        asbd->mSampleRate <= 0.0 || asbd->mChannelsPerFrame == 0 ||
        asbd->mChannelsPerFrame > 32) {
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

    const uint32_t channels = asbd->mChannelsPerFrame;
    const bool non_interleaved = (asbd->mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0;
    const uint32_t bits_per_channel = asbd->mBitsPerChannel;
    const size_t bytes_per_sample = bits_per_channel > 0
        ? (static_cast<size_t>(bits_per_channel) + 7) / 8
        : 0;
    const bool big_endian = (asbd->mFormatFlags & kAudioFormatFlagIsBigEndian) != 0;
    const bool is_float = (asbd->mFormatFlags & kAudioFormatFlagIsFloat) != 0;
    const bool is_signed = (asbd->mFormatFlags & kAudioFormatFlagIsSignedInteger) != 0;
    const bool is_unsigned = !is_float && !is_signed;
    if (bytes_per_sample == 0 || bytes_per_sample > sizeof(uint64_t) ||
        (!is_float && !is_signed && !is_unsigned) ||
        (is_float && bits_per_channel != 32 && bits_per_channel != 64)) {
        CFRelease(block_buffer);
        return false;
    }

    auto read_word = [big_endian](const uint8_t* data, size_t bytes) {
        uint64_t value = 0;
        if (big_endian) {
            for (size_t index = 0; index < bytes; ++index)
                value = (value << 8) | data[index];
        } else {
            for (size_t index = 0; index < bytes; ++index)
                value |= static_cast<uint64_t>(data[index]) << (index * 8);
        }
        return value;
    };

    auto sample_to_float = [&](const uint8_t* data) {
        const uint64_t value = read_word(data, bytes_per_sample);
        if (is_float && bits_per_channel == 32) {
            const uint32_t bits = static_cast<uint32_t>(value);
            float sample = 0.0f;
            std::memcpy(&sample, &bits, sizeof(sample));
            return std::isfinite(sample) ? std::max(-1.0f, std::min(1.0f, sample)) : 0.0f;
        }
        if (is_float && bits_per_channel == 64) {
            double sample = 0.0;
            std::memcpy(&sample, &value, sizeof(sample));
            if (!std::isfinite(sample)) return 0.0f;
            return static_cast<float>(std::max(-1.0, std::min(1.0, sample)));
        }
        const uint32_t bits = std::min<uint32_t>(bits_per_channel, 32);
        if (bits == 0) return 0.0f;
        const double scale = std::ldexp(1.0, static_cast<int>(bits - 1));
        if (is_unsigned)
            return static_cast<float>((static_cast<double>(value) - scale) / scale);
        const uint64_t mask = bits == 32
            ? UINT64_C(0xffffffff)
            : (UINT64_C(1) << bits) - 1;
        const uint64_t masked = value & mask;
        const int64_t signed_value = masked & (UINT64_C(1) << (bits - 1))
            ? static_cast<int64_t>(masked | (~mask))
            : static_cast<int64_t>(masked);
        return static_cast<float>(std::max(-1.0, std::min(1.0,
            static_cast<double>(signed_value) / scale)));
    };

    auto sample_pointer = [&](size_t frame, size_t channel) -> const uint8_t* {
        const AudioBuffer* buffer = nullptr;
        size_t sample_offset = 0;
        if (non_interleaved && buffer_list->mNumberBuffers >= channels) {
            buffer = &buffer_list->mBuffers[channel];
            sample_offset = frame * bytes_per_sample;
        } else if (buffer_list->mNumberBuffers > 0) {
            buffer = &buffer_list->mBuffers[0];
            const size_t channels_in_buffer = buffer->mNumberChannels > 0
                ? buffer->mNumberChannels
                : channels;
            sample_offset = (frame * channels_in_buffer + channel) * bytes_per_sample;
        }
        if (!buffer || !buffer->mData || sample_offset > buffer->mDataByteSize ||
            bytes_per_sample > buffer->mDataByteSize - sample_offset)
            return nullptr;
        return static_cast<const uint8_t*>(buffer->mData) + sample_offset;
    };

    std::vector<float> source(static_cast<size_t>(frames) * 2);
    for (size_t frame = 0; frame < frames; ++frame) {
        const uint8_t* left = sample_pointer(frame, 0);
        const uint8_t* right = sample_pointer(frame, channels > 1 ? 1 : 0);
        if (!left || !right) {
            CFRelease(block_buffer);
            return false;
        }
        source[frame * 2] = sample_to_float(left);
        source[frame * 2 + 1] = sample_to_float(right);
    }

    const double output_frame_count = std::ceil(
        static_cast<double>(frames) * 48000.0 / asbd->mSampleRate);
    if (!std::isfinite(output_frame_count) || output_frame_count <= 0.0 ||
        output_frame_count > static_cast<double>(UINT32_MAX)) {
        CFRelease(block_buffer);
        return false;
    }
    const size_t output_frames = static_cast<size_t>(output_frame_count);
    output.resize(output_frames * 2);
    const double source_step = asbd->mSampleRate / 48000.0;
    for (size_t frame = 0; frame < output_frames; ++frame) {
        const double source_position = static_cast<double>(frame) * source_step;
        const size_t first = std::min(frames - 1, static_cast<size_t>(source_position));
        const size_t second = std::min(frames - 1, first + 1);
        const float blend = static_cast<float>(source_position - first);
        output[frame * 2] = source[first * 2] +
            (source[second * 2] - source[first * 2]) * blend;
        output[frame * 2 + 1] = source[first * 2 + 1] +
            (source[second * 2 + 1] - source[first * 2 + 1]) * blend;
    }
    CFRelease(block_buffer);
    if (output_frames == 0 || output_frames > UINT32_MAX) {
        output.clear();
        return false;
    }
    frame_count = static_cast<uint32_t>(output_frames);
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
        CVPixelBufferRef pixel_buffer = CMSampleBufferGetImageBuffer(sample_buffer);
        if (!pixel_buffer) return;
        if (CVPixelBufferLockBaseAddress(pixel_buffer, kCVPixelBufferLock_ReadOnly) !=
            kCVReturnSuccess)
            return;
        const auto* data = static_cast<const uint8_t*>(CVPixelBufferGetBaseAddress(pixel_buffer));
        const size_t width = CVPixelBufferGetWidth(pixel_buffer);
        const size_t height = CVPixelBufferGetHeight(pixel_buffer);
        const size_t stride = CVPixelBufferGetBytesPerRow(pixel_buffer);
        CMTime pts = CMSampleBufferGetPresentationTimeStamp(sample_buffer);
        const int64_t timestamp_ms = pts.timescale > 0
            ? (pts.value * 1000) / pts.timescale
            : 0;
        if (data && width <= UINT32_MAX && height <= UINT32_MAX && stride <= UINT32_MAX)
            screen_cb(user_data, data, static_cast<uint32_t>(width),
                      static_cast<uint32_t>(height), static_cast<uint32_t>(stride),
                      timestamp_ms);
        CVPixelBufferUnlockBaseAddress(pixel_buffer, kCVPixelBufferLock_ReadOnly);
        return;
    }

    if (type != SCStreamOutputTypeAudio || !audio_cb) return;
    const CMFormatDescriptionRef format_description =
        CMSampleBufferGetFormatDescription(sample_buffer);
    const AudioStreamBasicDescription* asbd = format_description
        ? CMAudioFormatDescriptionGetStreamBasicDescription(format_description)
        : nullptr;
    if (!_session->audio_sample_logged.exchange(true)) {
        const uint32_t format_id = asbd ? asbd->mFormatID : 0;
        const uint32_t format_flags = asbd ? asbd->mFormatFlags : 0;
        const double sample_rate = asbd ? asbd->mSampleRate : 0.0;
        const uint32_t channels = asbd ? asbd->mChannelsPerFrame : 0;
        const uint32_t bits = asbd ? asbd->mBitsPerChannel : 0;
        std::fprintf(stderr,
                     "[dspeak:capture] screen audio sample format=%u flags=0x%x rate=%.2f channels=%u bits=%u frames=%lld\n",
                     format_id, format_flags, sample_rate, channels, bits,
                     static_cast<long long>(CMSampleBufferGetNumSamples(sample_buffer)));
    }
    std::vector<float> normalized;
    uint32_t frame_count = 0;
    if (!normalize_audio_sample(sample_buffer, normalized, frame_count)) {
        if (error_cb && !_session->audio_normalization_error_logged.exchange(true)) {
            error_cb(user_data, -204, "ScreenCaptureKit audio sample could not be normalized");
        }
        return;
    }
    if (!_session->audio_normalized_sample_logged.exchange(true))
        std::fprintf(stderr, "[dspeak:capture] screen audio normalized frames=%u\n",
                     frame_count);
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
        NSString* source_id_string = macos_string_from_utf8(source_id);
        NSString* source_type_string = macos_string_from_utf8(source_type);
        NSString* mode_string = macos_string_from_utf8(mode);
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
        dispatch_queue_attr_t capture_queue_attributes =
            dispatch_queue_attr_make_with_qos_class(
                DISPATCH_QUEUE_SERIAL, QOS_CLASS_USER_INITIATED, 0);
        if (capture_video) {
            session->video_queue = dispatch_queue_create(
                "com.dspeaks.media.capture.video", capture_queue_attributes);
        }
        if (capture_audio) {
            session->audio_queue = dispatch_queue_create(
                "com.dspeaks.media.capture.audio", capture_queue_attributes);
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
        session->stop_requested = false;
        session->screen_cb = screen_cb;
        session->audio_cb = audio_cb;
        session->error_cb = error_cb;
        session->user_data = user_data;
        session->starting = true;
    }

    @autoreleasepool {
        if (!CGPreflightScreenCaptureAccess() && !CGRequestScreenCaptureAccess()) {
            capture_report_error(session, -210, "Screen recording permission was denied");
            return -210;
        }
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
        configuration.colorSpaceName = kCGColorSpaceSRGB;
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

        bool installed = false;
        {
            std::lock_guard<std::mutex> lock(session->mutex);
            if (session->stop_requested) {
                session->starting = false;
                session->state_changed.notify_all();
            } else {
                session->stream = stream;
                session->output = output;
                session->delegate = delegate;
                installed = true;
            }
        }
        bool cancelled = false;
        {
            std::lock_guard<std::mutex> lock(session->mutex);
            cancelled = session->stop_requested;
        }
        if (cancelled) {
            if (installed) {
                lib_dspeak_media_platform_capture_stop(session);
                return 0;
            }
            dispatch_semaphore_t cancellation_semaphore = dispatch_semaphore_create(0);
            [stream stopCaptureWithCompletionHandler:^(NSError* error) {
                (void)error;
                dispatch_semaphore_signal(cancellation_semaphore);
            }];
            dispatch_semaphore_wait(
                cancellation_semaphore,
                dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));
            dispatch_release(cancellation_semaphore);
            [stream release];
            [output release];
            [delegate release];
            return 0;
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
            if (session->stop_requested) {
                session->starting = false;
            } else {
                session->starting = false;
                session->running = true;
            }
            session->state_changed.notify_all();
        }
        if (session->stop_requested) {
            lib_dspeak_media_platform_capture_stop(session);
            return 0;
        }
        return 0;
    }
}

void lib_dspeak_media_platform_capture_stop(struct lib_dspeak_media_capture_session* session) {
    if (!session) return;
    SCStream* stream = nil;
    {
        std::unique_lock<std::mutex> lock(session->mutex);
        while (session->starting && !session->stream)
            session->state_changed.wait(lock);
        if (session->stopping) return;
        session->stop_requested = true;
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
