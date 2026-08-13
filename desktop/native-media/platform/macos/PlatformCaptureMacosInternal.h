#ifndef LIB_DSPEAK_MEDIA_PLATFORM_MACOS_INTERNAL_H_
#define LIB_DSPEAK_MEDIA_PLATFORM_MACOS_INTERNAL_H_

#include "../PlatformCapture.h"

#import <CoreAudio/CoreAudio.h>
#import <Foundation/Foundation.h>

NSString* macos_string_from_utf8(const char* value);
char* macos_json_string_from_object(id object);
NSString* macos_device_id_from_source_id(NSString* source_id, NSString* kind);
AudioDeviceID macos_core_audio_device_for_uid(NSString* uid);

#endif

