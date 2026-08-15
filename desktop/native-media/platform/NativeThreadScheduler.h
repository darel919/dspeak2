#ifndef DSPEAK_NATIVE_THREAD_SCHEDULER_H_
#define DSPEAK_NATIVE_THREAD_SCHEDULER_H_

#include <rtc_base/thread.h>

namespace dspeak_native {

bool start_media_thread(webrtc::Thread* thread);
void configure_current_media_thread();
void configure_current_audio_thread();

}

#endif
