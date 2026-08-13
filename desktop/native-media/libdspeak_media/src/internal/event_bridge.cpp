#include "event_bridge.hpp"

#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <mutex>

namespace {

std::condition_variable g_event_condition;
std::mutex g_event_mutex;
bool g_event_pending = false;

}

void lib_dspeak_media_signal_event() {
    {
        std::lock_guard<std::mutex> lock(g_event_mutex);
        g_event_pending = true;
    }
    g_event_condition.notify_all();
}

extern "C" int lib_dspeak_media_wait_for_event(uint32_t timeout_ms) {
    std::unique_lock<std::mutex> lock(g_event_mutex);
    const auto consume_pending = []() {
        if (!g_event_pending) return 0;
        g_event_pending = false;
        return 1;
    };
    if (consume_pending()) return 1;
    if (timeout_ms == 0) return 0;
    g_event_condition.wait_for(lock, std::chrono::milliseconds(timeout_ms), [] {
        return g_event_pending;
    });
    return consume_pending();
}

extern "C" void lib_dspeak_media_wake_event() {
    lib_dspeak_media_signal_event();
}
