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
#include <array>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <cstdio>
#include <cmath>
#include <mutex>
#include <new>
#include <string>
#include <thread>
#include <unistd.h>
#include <vector>

#include "../AudioSpscRing.hpp"

#if defined(__APPLE__)

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
    AVAudioConverter* audio_converter = nil;
    AVAudioFormat* audio_converter_input_format = nil;
    std::mutex audio_converter_mutex;
    AVCaptureSession* camera_session = nil;
    AVCaptureDeviceInput* camera_input = nil;
    AVCaptureVideoDataOutput* camera_output = nil;
    id camera_delegate = nil;
    dispatch_queue_t queue = nullptr;
    StereoAudioSpscRing<9600> audio_samples;
    std::atomic<bool> audio_worker_stop{false};
    std::atomic<bool> callback_active{false};
    std::condition_variable audio_worker_wake;
    std::mutex audio_worker_mutex;
    std::thread audio_worker;
};

static bool device_capture_begin_callback(lib_dspeak_media_device_capture_session* session,
                                           lib_dspeak_media_screen_frame_cb* screen_cb,
                                           lib_dspeak_media_audio_frame_cb* audio_cb,
                                           void** user_data,
                                           dispatch_queue_t* callback_queue) {
    std::lock_guard<std::mutex> lock(session->mutex);
    if (!session->running) return false;
    session->in_flight_callbacks += 1;
    *screen_cb = session->screen_cb;
    *audio_cb = session->audio_cb;
    *user_data = session->user_data;
    if (callback_queue) {
        *callback_queue = session->queue;
        if (*callback_queue) dispatch_retain(*callback_queue);
    }
    return true;
}

static void device_capture_end_callback(lib_dspeak_media_device_capture_session* session) {
    std::lock_guard<std::mutex> lock(session->mutex);
    if (session->in_flight_callbacks > 0) session->in_flight_callbacks -= 1;
    session->state_changed.notify_all();
}

static void device_capture_audio_worker(
    lib_dspeak_media_device_capture_session* session) {
    constexpr size_t frames_per_callback = 480;
    std::array<float, frames_per_callback * 2> samples{};
    while (!session->audio_worker_stop.load(std::memory_order_acquire)) {
        if (session->audio_samples.available() < frames_per_callback) {
            std::unique_lock<std::mutex> lock(session->audio_worker_mutex);
            session->audio_worker_wake.wait_for(
                lock,
                std::chrono::milliseconds(10),
                [session] {
                    return session->audio_worker_stop.load(std::memory_order_acquire) ||
                           session->audio_samples.available() >= frames_per_callback;
                });
            continue;
        }
        lib_dspeak_media_screen_frame_cb screen_callback = nullptr;
        lib_dspeak_media_audio_frame_cb audio_callback = nullptr;
        void* callback_user_data = nullptr;
        if (!device_capture_begin_callback(
                session, &screen_callback, &audio_callback,
                &callback_user_data, nullptr)) {
            session->audio_samples.reset();
            continue;
        }
        (void)screen_callback;
        size_t popped_frames = 0;
        for (; popped_frames < frames_per_callback; ++popped_frames) {
            StereoAudioSpscRing<9600>::Frame frame;
            if (!session->audio_samples.pop(frame)) break;
            samples[popped_frames * 2] = frame.left;
            samples[popped_frames * 2 + 1] = frame.right;
        }
        if (audio_callback && popped_frames == frames_per_callback)
            audio_callback(callback_user_data, samples.data(),
                           static_cast<uint32_t>(frames_per_callback), 48000, 2);
        device_capture_end_callback(session);
    }
    session->audio_samples.reset();
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
        session->callback_active.store(false, std::memory_order_release);
        session->audio_worker_stop.store(true, std::memory_order_release);
        callback = session->error_cb;
        user_data = session->user_data;
        session->screen_cb = nullptr;
        session->audio_cb = nullptr;
        session->state_changed.notify_all();
    }
    session->audio_worker_wake.notify_one();
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
    if (!device_capture_begin_callback(
            _session, &screen_cb, &audio_cb, &user_data, nullptr)) return;
    if (screen_cb) {
        CVPixelBufferRef pixel_buffer = CMSampleBufferGetImageBuffer(sample_buffer);
        if (pixel_buffer &&
            CVPixelBufferLockBaseAddress(pixel_buffer, kCVPixelBufferLock_ReadOnly) ==
                kCVReturnSuccess) {
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
        }
    }
    device_capture_end_callback(_session);
}
@end

static bool copy_stereo_float_buffer(AVAudioPCMBuffer* buffer,
                                     std::vector<float>& samples,
                                     uint32_t& frame_count) {
    AVAudioFormat* format = buffer.format;
    if (!format || format.sampleRate != 48000.0 || format.channelCount != 2 ||
        format.commonFormat != AVAudioPCMFormatFloat32 || buffer.frameLength == 0) return false;
    const uint32_t frames = buffer.frameLength;
    if (frames > UINT32_MAX) return false;
    const size_t sample_count = static_cast<size_t>(frames) * 2;
    samples.resize(sample_count);
    const AudioBufferList* list = buffer.audioBufferList;
    if (!list) return false;
    if (format.isInterleaved) {
        if (list->mNumberBuffers != 1 || list->mBuffers[0].mNumberChannels != 2 ||
            list->mBuffers[0].mDataByteSize < sample_count * sizeof(float) ||
            !list->mBuffers[0].mData) return false;
        const float* input = static_cast<const float*>(list->mBuffers[0].mData);
        std::copy(input, input + sample_count, samples.data());
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

static bool audio_buffer_to_stereo(
    lib_dspeak_media_device_capture_session* session,
    AVAudioPCMBuffer* buffer,
    std::vector<float>& samples,
    uint32_t& frame_count) {
    if (!session || !buffer || !session->audio_format) return false;
    AVAudioPCMBuffer* converted = nil;
    {
        std::lock_guard<std::mutex> lock(session->audio_converter_mutex);
        if (![buffer.format isEqual:session->audio_format]) {
            if (!session->audio_converter ||
                ![session->audio_converter_input_format isEqual:buffer.format]) {
                AVAudioConverter* converter =
                    [[AVAudioConverter alloc] initFromFormat:buffer.format
                                                    toFormat:session->audio_format];
                if (!converter) return false;
                converter.downmix = YES;
                converter.primeMethod = AVAudioConverterPrimeMethod_None;
                [session->audio_converter release];
                [session->audio_converter_input_format release];
                session->audio_converter = converter;
                session->audio_converter_input_format = [buffer.format retain];
            }
            const double source_rate = buffer.format.sampleRate;
            const double target_rate = session->audio_format.sampleRate;
            if (!std::isfinite(source_rate) || source_rate <= 0.0 ||
                !std::isfinite(target_rate) || target_rate <= 0.0) return false;
            const uint64_t capacity = static_cast<uint64_t>(std::ceil(
                static_cast<double>(buffer.frameLength) * target_rate / source_rate)) + 32;
            if (capacity == 0 || capacity > UINT32_MAX) return false;
            converted = [[AVAudioPCMBuffer alloc]
                initWithPCMFormat:session->audio_format
                      frameCapacity:static_cast<AVAudioFrameCount>(capacity)];
            if (!converted) return false;
            __block bool supplied = false;
            NSError* conversion_error = nil;
            const AVAudioConverterOutputStatus status =
                [session->audio_converter
                    convertToBuffer:converted
                              error:&conversion_error
                withInputFromBlock:^AVAudioBuffer*(AVAudioPacketCount packets,
                                                    AVAudioConverterInputStatus* out_status) {
                    (void)packets;
                    if (supplied) {
                        *out_status = AVAudioConverterInputStatus_NoDataNow;
                        return nil;
                    }
                    supplied = true;
                    *out_status = AVAudioConverterInputStatus_HaveData;
                    return buffer;
                }];
            if (status == AVAudioConverterOutputStatus_Error || converted.frameLength == 0) {
                [converted release];
                return false;
            }
        } else {
            converted = [buffer retain];
        }
    }
    const bool copied = copy_stereo_float_buffer(converted, samples, frame_count);
    [converted release];
    return copied;
}

static void device_capture_cleanup(lib_dspeak_media_device_capture_session* session) {
    AVAudioEngine* audio_engine = nil;
    AVAudioInputNode* audio_input = nil;
    AVAudioMixerNode* audio_mixer = nil;
    AVAudioFormat* audio_format = nil;
    AVAudioConverter* audio_converter = nil;
    AVAudioFormat* audio_converter_input_format = nil;
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
        session->camera_session = nil;
        session->camera_input = nil;
        session->camera_output = nil;
        session->camera_delegate = nil;
        session->queue = nullptr;
        session->audio_worker_stop.store(true, std::memory_order_release);
        session->callback_active.store(false, std::memory_order_release);
    }
    session->audio_worker_wake.notify_one();
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
    if (session->audio_worker.joinable()) session->audio_worker.join();
    {
        std::unique_lock<std::mutex> lock(session->mutex);
        session->state_changed.wait(lock, [session] { return session->in_flight_callbacks == 0; });
        {
            std::lock_guard<std::mutex> converter_lock(session->audio_converter_mutex);
            audio_converter = session->audio_converter;
            audio_converter_input_format = session->audio_converter_input_format;
            session->audio_format = nil;
            session->audio_converter = nil;
            session->audio_converter_input_format = nil;
        }
        [audio_engine release];
        [audio_mixer release];
        [camera_session release];
        [camera_output release];
        [camera_input release];
        [camera_delegate release];
        [audio_input release];
        [audio_format release];
        [audio_converter release];
        [audio_converter_input_format release];
        if (queue) dispatch_release(queue);
    }
}

struct lib_dspeak_media_device_capture_session*
lib_dspeak_media_platform_device_capture_create(const char* device_id,
                                                const char* kind) {
    @autoreleasepool {
        NSString* device_id_string = macos_string_from_utf8(device_id);
        NSString* kind_string = macos_string_from_utf8(kind);
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
        dispatch_queue_attr_t capture_queue_attributes =
            dispatch_queue_attr_make_with_qos_class(
                DISPATCH_QUEUE_SERIAL, QOS_CLASS_USER_INITIATED, 0);
        session->queue = dispatch_queue_create(
            session->microphone ? "com.dspeaks.media.capture.microphone" :
                                  "com.dspeaks.media.capture.camera",
            capture_queue_attributes);
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
            NSString* core_audio_uid = macos_device_id_from_source_id(session->device_id, @"microphone");
            if (core_audio_uid.length) {
                AudioDeviceID device = macos_core_audio_device_for_uid(core_audio_uid);
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
                [mixer setOutputVolume:0.0f];
                __block lib_dspeak_media_device_capture_session* block_session = session;
                [mixer installTapOnBus:0 bufferSize:480 format:nil block:^(AVAudioPCMBuffer* buffer,
                                                                                   AVAudioTime* time) {
                    (void)time;
                    if (!block_session || !buffer) return;
                    lib_dspeak_media_screen_frame_cb screen_callback = nullptr;
                    lib_dspeak_media_audio_frame_cb audio_callback = nullptr;
                    void* callback_user_data = nullptr;
                    if (!device_capture_begin_callback(
                            block_session, &screen_callback, &audio_callback,
                            &callback_user_data, nullptr)) return;
                    (void)screen_callback;
                    (void)callback_user_data;
                    std::vector<float> samples;
                    uint32_t frame_count = 0;
                    if (audio_buffer_to_stereo(
                            block_session, buffer, samples, frame_count)) {
                        if (audio_callback)
                            for (uint32_t frame = 0; frame < frame_count; ++frame)
                                block_session->audio_samples.push(
                                    samples[static_cast<size_t>(frame) * 2],
                                    samples[static_cast<size_t>(frame) * 2 + 1]);
                        block_session->audio_worker_wake.notify_one();
                    } else {
                        device_capture_report_error(block_session, -222,
                                                    "AVAudioEngine microphone format conversion failed");
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
            NSString* selected_id = macos_device_id_from_source_id(session->device_id, @"camera");
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
            if (!capture_session.isRunning) {
                device_capture_report_error(session, -223,
                                             "AVCaptureSession failed to start");
                device_capture_cleanup(session);
                return -223;
            }
        }
        {
            std::lock_guard<std::mutex> lock(session->mutex);
            session->starting = false;
            session->running = true;
            session->callback_active.store(true, std::memory_order_release);
            session->state_changed.notify_all();
        }
        if (session->microphone) {
            session->audio_worker_stop.store(false, std::memory_order_release);
            session->audio_samples.reset();
            session->audio_worker = std::thread(device_capture_audio_worker, session);
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
        session->callback_active.store(false, std::memory_order_release);
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
