#include "PlatformCaptureMacosInternal.h"
#include "../AudioSpscRing.hpp"

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
#include <cstring>
#include <cstdio>
#include <mutex>
#include <new>
#include <string>
#include <unistd.h>
#include <vector>

#if defined(__APPLE__)

static NSDictionary* device_dictionary(AVCaptureDevice* device, NSString* kind) {
    NSString* unique_id = device.uniqueID ?: @"";
    bool microphone = [kind isEqualToString:@"microphone"];
    NSString* source_id = [NSString stringWithFormat:@"macos:%@:%@", kind, unique_id];
    NSMutableDictionary* result = [NSMutableDictionary dictionaryWithDictionary:@{
        @"deviceId": unique_id,
        @"kind": microphone ? @"audioinput" : @"videoinput",
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

static NSArray* capture_devices_for_type(NSString* media_type, bool video) {
    NSMutableArray* device_types = [NSMutableArray array];
    if (video) {
        [device_types addObject:AVCaptureDeviceTypeBuiltInWideAngleCamera];
        if (@available(macOS 14.0, *)) {
            [device_types addObject:AVCaptureDeviceTypeExternal];
        } else {
            [device_types addObject:@"AVCaptureDeviceTypeExternalUnknown"];
        }
    } else if (@available(macOS 14.0, *)) {
        [device_types addObject:AVCaptureDeviceTypeMicrophone];
        [device_types addObject:AVCaptureDeviceTypeExternal];
    } else {
        [device_types addObject:@"AVCaptureDeviceTypeBuiltInMicrophone"];
        [device_types addObject:@"AVCaptureDeviceTypeExternalUnknown"];
    }
    AVCaptureDeviceDiscoverySession* discovery =
        [AVCaptureDeviceDiscoverySession discoverySessionWithDeviceTypes:device_types
                                                                 mediaType:media_type
                                                                  position:AVCaptureDevicePositionUnspecified];
    return discovery.devices ?: @[];
}

static NSArray* audio_output_sources(void);

static NSArray* capture_device_sources(void) {
    NSMutableArray* devices = [NSMutableArray array];
    NSArray* microphones = capture_devices_for_type(AVMediaTypeAudio, false);
    for (AVCaptureDevice* device in microphones) {
        [devices addObject:device_dictionary(device, @"microphone")];
    }
    NSArray* cameras = capture_devices_for_type(AVMediaTypeVideo, true);
    for (AVCaptureDevice* device in cameras) {
        [devices addObject:device_dictionary(device, @"camera")];
    }
    [devices addObjectsFromArray:audio_output_sources()];
    [devices sortUsingComparator:^NSComparisonResult(NSDictionary* left, NSDictionary* right) {
        return [left[@"deviceId"] compare:right[@"deviceId"]];
    }];
    return devices;
}

char* lib_dspeak_media_platform_capture_list_devices(void) {
    @autoreleasepool {
        return macos_json_string_from_object(capture_device_sources());
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
        return macos_json_string_from_object(result);
    }
}

static CFStringRef core_audio_device_string(AudioDeviceID device,
                                            AudioObjectPropertySelector selector) {
    if (device == kAudioObjectUnknown) return nullptr;
    AudioObjectPropertyAddress address = {
        selector,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain,
    };
    CFStringRef value = nullptr;
    UInt32 data_size = sizeof(value);
    if (AudioObjectGetPropertyData(device, &address, 0, nullptr, &data_size, &value) != noErr)
        return nullptr;
    return value;
}

static bool core_audio_device_has_output(AudioDeviceID device) {
    if (device == kAudioObjectUnknown) return false;
    AudioObjectPropertyAddress address = {
        kAudioDevicePropertyStreamConfiguration,
        kAudioDevicePropertyScopeOutput,
        kAudioObjectPropertyElementMain,
    };
    UInt32 data_size = 0;
    if (AudioObjectGetPropertyDataSize(device, &address, 0, nullptr, &data_size) != noErr ||
        data_size < sizeof(AudioBufferList)) return false;
    std::vector<uint8_t> storage(data_size);
    auto* buffer_list = reinterpret_cast<AudioBufferList*>(storage.data());
    if (AudioObjectGetPropertyData(device, &address, 0, nullptr, &data_size, buffer_list) != noErr)
        return false;
    for (UInt32 index = 0; index < buffer_list->mNumberBuffers; ++index) {
        if (buffer_list->mBuffers[index].mNumberChannels > 0) return true;
    }
    return false;
}

static NSArray* audio_output_sources(void) {
    NSMutableArray* outputs = [NSMutableArray array];
    AudioObjectPropertyAddress address = {
        kAudioHardwarePropertyDevices,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain,
    };
    UInt32 data_size = 0;
    if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &address, 0, nullptr, &data_size) != noErr ||
        data_size < sizeof(AudioDeviceID)) return outputs;
    std::vector<AudioDeviceID> devices(data_size / sizeof(AudioDeviceID));
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, 0, nullptr,
                                   &data_size, devices.data()) != noErr) return outputs;
    for (AudioDeviceID device : devices) {
        if (!core_audio_device_has_output(device)) continue;
        CFStringRef uid_ref = core_audio_device_string(device, kAudioDevicePropertyDeviceUID);
        if (!uid_ref) continue;
        CFStringRef name_ref = core_audio_device_string(device, kAudioObjectPropertyName);
        NSString* uid = (__bridge NSString*)uid_ref;
        NSString* name = name_ref ? (__bridge NSString*)name_ref : @"Unnamed speaker";
        NSDictionary* result = @{
            @"deviceId": uid,
            @"kind": @"audiooutput",
            @"sourceId": [NSString stringWithFormat:@"macos:audiooutput:%@", uid],
            @"sourceType": @"audiooutput",
            @"sourceKey": [NSString stringWithFormat:@"audiooutput:macos:audiooutput:%@", uid],
            @"title": name,
            @"label": name,
            @"groupId": uid,
            @"available": @YES,
            @"capabilities": @{
                @"audio": @YES,
                @"video": @NO,
                @"stereo": @YES,
                @"channels": @2,
                @"sampleRate": @48000,
            },
        };
        [outputs addObject:result];
        CFRelease(uid_ref);
        if (name_ref) CFRelease(name_ref);
    }
    return outputs;
}

static AudioDeviceID core_audio_default_output_device(void) {
    AudioObjectPropertyAddress address = {
        kAudioHardwarePropertyDefaultOutputDevice,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain,
    };
    AudioDeviceID device = kAudioObjectUnknown;
    UInt32 data_size = sizeof(device);
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, 0, nullptr,
                                   &data_size, &device) != noErr) return kAudioObjectUnknown;
    return device;
}

extern "C" uint32_t lib_dspeak_media_platform_audio_output_device_id(const char* device_id) {
    @autoreleasepool {
        NSString* value = macos_string_from_utf8(device_id);
        if ([value hasPrefix:@"macos:audiooutput:"])
            value = [value substringFromIndex:[@"macos:audiooutput:" length]];
        AudioDeviceID device = value.length ? macos_core_audio_device_for_uid(value)
                                            : core_audio_default_output_device();
        if (!core_audio_device_has_output(device)) return 0;
        return static_cast<uint32_t>(device);
    }
}

struct PlatformAudioOutput {
    AudioUnit unit = nullptr;
    StereoAudioSpscRing<9600> samples;
    std::atomic<double> volume{1.0};
    std::atomic<bool> enabled{true};
    bool running = false;
    std::atomic<uint32_t> target_frames{0};
    std::atomic<bool> primed{true};
    uint32_t device_period_frames = 0;
    std::atomic<uint32_t> render_period_frames{0};
};

static std::mutex g_audio_output_registry_mutex;
static std::vector<PlatformAudioOutput*> g_audio_outputs;
static std::string g_audio_output_device_id;

static int set_audio_output_device(PlatformAudioOutput* output, uint32_t device_id) {
    if (!output || !output->unit || device_id == 0) return -1;
    const AudioDeviceID audio_device = static_cast<AudioDeviceID>(device_id);
    const auto result = AudioUnitSetProperty(
        output->unit,
        kAudioOutputUnitProperty_CurrentDevice,
        kAudioUnitScope_Global,
        0,
        &audio_device,
        sizeof(audio_device));
    return result == noErr ? 0 : -1;
}

static uint32_t requested_audio_output_device_id() {
    std::string device_id;
    {
        std::lock_guard<std::mutex> lock(g_audio_output_registry_mutex);
        device_id = g_audio_output_device_id;
    }
    return lib_dspeak_media_platform_audio_output_device_id(
        device_id.empty() ? nullptr : device_id.c_str());
}

static uint32_t core_audio_device_buffer_frames(AudioDeviceID device) {
    if (device == kAudioObjectUnknown) return 0;
    AudioObjectPropertyAddress address = {
        kAudioDevicePropertyBufferFrameSize,
        kAudioDevicePropertyScopeOutput,
        kAudioObjectPropertyElementMain,
    };
    UInt32 frames = 0;
    UInt32 data_size = sizeof(frames);
    if (AudioObjectGetPropertyData(device, &address, 0, nullptr, &data_size, &frames) != noErr)
        return 0;
    return frames;
}

static OSStatus render_audio(void* user_data,
                             AudioUnitRenderActionFlags*,
                             const AudioTimeStamp*,
                             UInt32,
                             UInt32 frame_count,
                             AudioBufferList* io_data) {
    auto* output = static_cast<PlatformAudioOutput*>(user_data);
    if (!output || !io_data) return noErr;
    output->render_period_frames.store(frame_count, std::memory_order_relaxed);
    if (!output->enabled.load(std::memory_order_acquire)) output->samples.reset();
    const size_t queued_frames = output->samples.available();
    if (queued_frames > 9600) output->samples.discard(queued_frames - 9600);
    const uint32_t target_frames = output->target_frames.load(std::memory_order_acquire);
    const bool target_reached = target_frames == 0 ||
        output->samples.available() >= static_cast<size_t>(target_frames);
    if (target_reached) output->primed.store(true, std::memory_order_release);
    const bool ready = output->enabled.load(std::memory_order_acquire) &&
        output->primed.load(std::memory_order_acquire);
    const bool interleaved = io_data->mNumberBuffers == 1;
    if (interleaved) {
        auto& buffer = io_data->mBuffers[0];
        auto* destination = static_cast<float*>(buffer.mData);
        if (!destination) return noErr;
        const UInt32 channels = buffer.mNumberChannels ? buffer.mNumberChannels : 2;
        bool underflow = false;
        for (UInt32 frame = 0; frame < frame_count; ++frame) {
            float left = 0.0f;
            float right = 0.0f;
            StereoAudioSpscRing<9600>::Frame sample;
            if (ready && output->samples.pop(sample)) {
                const float volume = static_cast<float>(
                    output->volume.load(std::memory_order_relaxed));
                left = sample.left * volume;
                right = sample.right * volume;
            } else if (ready) {
                underflow = true;
            }
            for (UInt32 channel = 0; channel < channels; ++channel)
                destination[frame * channels + channel] = channel == 0
                    ? left
                    : channel == 1 ? right : (left + right) * 0.5f;
        }
        if (underflow)
            output->primed.store(false, std::memory_order_release);
        return noErr;
    }
    bool underflow = false;
    for (UInt32 frame = 0; frame < frame_count; ++frame) {
        float left = 0.0f;
        float right = 0.0f;
        StereoAudioSpscRing<9600>::Frame sample;
        if (ready && output->samples.pop(sample)) {
            const float volume = static_cast<float>(
                output->volume.load(std::memory_order_relaxed));
            left = sample.left * volume;
            right = sample.right * volume;
        } else if (ready) {
            underflow = true;
        }
        for (UInt32 buffer_index = 0; buffer_index < io_data->mNumberBuffers; ++buffer_index) {
            auto& buffer = io_data->mBuffers[buffer_index];
            auto* destination = static_cast<float*>(buffer.mData);
            if (!destination) continue;
            const UInt32 channels = buffer.mNumberChannels ? buffer.mNumberChannels : 1;
            const float value = buffer_index == 0 ? left : right;
            for (UInt32 channel = 0; channel < channels; ++channel)
                destination[frame * channels + channel] = value;
        }
    }
    if (underflow)
        output->primed.store(false, std::memory_order_release);
    return noErr;
}

extern "C" int lib_dspeak_media_platform_set_output_device(const char* device_id) {
    const std::string requested = device_id ? device_id : "";
    const uint32_t audio_device_id = lib_dspeak_media_platform_audio_output_device_id(
        requested.empty() ? nullptr : requested.c_str());
    if (audio_device_id == 0) return -1;
    std::lock_guard<std::mutex> lock(g_audio_output_registry_mutex);
    g_audio_output_device_id = requested;
    for (PlatformAudioOutput* output : g_audio_outputs)
        if (set_audio_output_device(output, audio_device_id) != 0) return -1;
    return 0;
}

extern "C" void* lib_dspeak_media_platform_audio_output_create(const char*) {
    auto* output = new(std::nothrow) PlatformAudioOutput();
    if (!output) return nullptr;
    AudioComponentDescription description{};
    description.componentType = kAudioUnitType_Output;
    description.componentSubType = kAudioUnitSubType_DefaultOutput;
    description.componentManufacturer = kAudioUnitManufacturer_Apple;
    const AudioComponent component = AudioComponentFindNext(nullptr, &description);
    if (!component || AudioComponentInstanceNew(component, &output->unit) != noErr) {
        delete output;
        return nullptr;
    }
    AudioStreamBasicDescription format{};
    format.mSampleRate = 48000;
    format.mFormatID = kAudioFormatLinearPCM;
    format.mFormatFlags = kAudioFormatFlagsNativeFloatPacked;
    format.mBytesPerPacket = sizeof(float) * 2;
    format.mFramesPerPacket = 1;
    format.mBytesPerFrame = sizeof(float) * 2;
    format.mChannelsPerFrame = 2;
    format.mBitsPerChannel = 32;
    if (AudioUnitSetProperty(output->unit, kAudioUnitProperty_StreamFormat,
                             kAudioUnitScope_Input, 0, &format,
                             sizeof(format)) != noErr) {
        AudioComponentInstanceDispose(output->unit);
        delete output;
        return nullptr;
    }
    AURenderCallbackStruct callback{};
    callback.inputProc = render_audio;
    callback.inputProcRefCon = output;
    if (AudioUnitSetProperty(output->unit, kAudioUnitProperty_SetRenderCallback,
                             kAudioUnitScope_Input, 0, &callback,
                             sizeof(callback)) != noErr) {
        AudioComponentInstanceDispose(output->unit);
        delete output;
        return nullptr;
    }
    const uint32_t audio_device_id = requested_audio_output_device_id();
    if (audio_device_id == 0 || set_audio_output_device(output, audio_device_id) != 0) {
        AudioComponentInstanceDispose(output->unit);
        delete output;
        return nullptr;
    }
    output->device_period_frames = core_audio_device_buffer_frames(
        static_cast<AudioDeviceID>(audio_device_id));
    if (AudioUnitInitialize(output->unit) != noErr) {
        AudioComponentInstanceDispose(output->unit);
        delete output;
        return nullptr;
    }
    if (AudioOutputUnitStart(output->unit) != noErr) {
        AudioUnitUninitialize(output->unit);
        AudioComponentInstanceDispose(output->unit);
        delete output;
        return nullptr;
    }
    output->running = true;
    {
        std::lock_guard<std::mutex> lock(g_audio_output_registry_mutex);
        g_audio_outputs.push_back(output);
    }
    return output;
}

extern "C" void lib_dspeak_media_platform_audio_output_destroy(void* value) {
    auto* output = static_cast<PlatformAudioOutput*>(value);
    if (!output) return;
    {
        std::lock_guard<std::mutex> lock(g_audio_output_registry_mutex);
        g_audio_outputs.erase(
            std::remove(g_audio_outputs.begin(), g_audio_outputs.end(), output),
            g_audio_outputs.end());
    }
    if (output->running) AudioOutputUnitStop(output->unit);
    AudioUnitUninitialize(output->unit);
    AudioComponentInstanceDispose(output->unit);
    delete output;
}

extern "C" int lib_dspeak_media_platform_audio_output_start(void* value) {
    auto* output = static_cast<PlatformAudioOutput*>(value);
    if (!output) return -1;
    if (output->running) return 0;
    const auto result = AudioOutputUnitStart(output->unit);
    output->running = result == noErr;
    return result == noErr ? 0 : -1;
}

extern "C" void lib_dspeak_media_platform_audio_output_stop(void* value) {
    auto* output = static_cast<PlatformAudioOutput*>(value);
    if (!output) return;
    if (output->running) AudioOutputUnitStop(output->unit);
    output->running = false;
}

extern "C" void lib_dspeak_media_platform_audio_output_set_enabled(void* value,
                                                                      bool enabled) {
    auto* output = static_cast<PlatformAudioOutput*>(value);
    if (!output) return;
    output->enabled.store(enabled, std::memory_order_release);
    if (!enabled) {
        output->samples.reset();
        output->primed.store(
            output->target_frames.load(std::memory_order_acquire) == 0,
            std::memory_order_release);
    }
}

extern "C" void lib_dspeak_media_platform_audio_output_set_volume(void* value,
                                                                     double volume) {
    auto* output = static_cast<PlatformAudioOutput*>(value);
    if (!output) return;
    output->volume.store(
        std::max(0.0, std::min(2.0, volume)), std::memory_order_release);
}

extern "C" void lib_dspeak_media_platform_audio_output_set_jitter_buffer(
    void* value,
    int min_delay_ms,
    int target_delay_ms) {
    auto* output = static_cast<PlatformAudioOutput*>(value);
    if (!output) return;
    const int effective_delay_ms = std::min(
        200, std::max(0, std::max(min_delay_ms, target_delay_ms)));
    output->target_frames.store(
        static_cast<uint32_t>(effective_delay_ms * 48000 / 1000),
        std::memory_order_release);
    output->primed.store(effective_delay_ms == 0, std::memory_order_release);
}

extern "C" void lib_dspeak_media_platform_audio_output_write(
    void* value,
    const float* samples,
    uint32_t frame_count,
    uint32_t sample_rate,
    uint8_t channels) {
    auto* output = static_cast<PlatformAudioOutput*>(value);
    if (!output || !samples || !frame_count || !channels || sample_rate != 48000) return;
    for (uint32_t frame = 0; frame < frame_count; ++frame) {
        const float left = samples[frame * channels];
        const float right = channels > 1 ? samples[frame * channels + 1] : left;
        output->samples.push(left, right);
    }
}

extern "C" void lib_dspeak_media_platform_audio_output_get_metrics(
    uint32_t* device_period_frames,
    uint32_t* render_period_frames,
    uint32_t* queue_frames,
    uint64_t* dropped_frames,
    uint32_t* target_frames,
    uint32_t* output_count) {
    std::lock_guard<std::mutex> lock(g_audio_output_registry_mutex);
    if (output_count) *output_count = static_cast<uint32_t>(g_audio_outputs.size());
    const auto* output = g_audio_outputs.empty() ? nullptr : g_audio_outputs.front();
    if (!output) {
        if (device_period_frames) *device_period_frames = 0;
        if (render_period_frames) *render_period_frames = 0;
        if (queue_frames) *queue_frames = 0;
        if (dropped_frames) *dropped_frames = 0;
        if (target_frames) *target_frames = 0;
        return;
    }
    if (device_period_frames) *device_period_frames = output->device_period_frames;
    if (render_period_frames)
        *render_period_frames = output->render_period_frames.load(std::memory_order_relaxed);
    if (queue_frames) *queue_frames = static_cast<uint32_t>(output->samples.available());
    if (dropped_frames) *dropped_frames = output->samples.dropped_frames();
    if (target_frames)
        *target_frames = output->target_frames.load(std::memory_order_relaxed);
}


#endif
