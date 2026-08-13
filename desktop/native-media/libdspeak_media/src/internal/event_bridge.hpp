#ifndef LIB_DSPEAK_MEDIA_INTERNAL_EVENT_BRIDGE_HPP_
#define LIB_DSPEAK_MEDIA_INTERNAL_EVENT_BRIDGE_HPP_

#include <cstdint>

void lib_dspeak_media_signal_event();

extern "C" int lib_dspeak_media_wait_for_event(uint32_t timeout_ms);
extern "C" void lib_dspeak_media_wake_event();

#endif
