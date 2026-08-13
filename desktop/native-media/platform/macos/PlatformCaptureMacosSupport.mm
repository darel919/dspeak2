#include "PlatformCaptureMacosInternal.h"

#include <cstdlib>
#include <cstring>
#include <vector>

#if defined(__APPLE__)

NSString* macos_string_from_utf8(const char* value) {
    if (!value) return nil;
    return [NSString stringWithUTF8String:value];
}

char* macos_json_string_from_object(id object) {
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

NSString* macos_device_id_from_source_id(NSString* source_id, NSString* kind) {
    if (!source_id) return nil;
    NSString* prefix = [NSString stringWithFormat:@"macos:%@:", kind];
    if ([source_id hasPrefix:prefix]) return [source_id substringFromIndex:prefix.length];
    return source_id;
}

AudioDeviceID macos_core_audio_device_for_uid(NSString* uid) {
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

#endif

