#include "audio_quantum.hpp"

#include <atomic>
#include <cstring>

namespace dspeak_native {

namespace {
std::atomic<int> g_capture_quantum_profile{
    static_cast<int>(AudioQuantumProfile::kStandard10Ms)};

constexpr bool kSub10MsCodecPathAvailable = false;
}  // namespace

void set_capture_quantum_profile(AudioQuantumProfile profile) {
    const int raw = static_cast<int>(profile);
    if (raw != 0 && raw != 5 && raw != 2)
        return;
    g_capture_quantum_profile.store(raw, std::memory_order_relaxed);
}

AudioQuantumProfile capture_quantum_profile() {
    switch (g_capture_quantum_profile.load(std::memory_order_relaxed)) {
        case 5:
            return AudioQuantumProfile::kUltraLow5Ms;
        case 2:
            return AudioQuantumProfile::kUltraLow2_5Ms;
        case 0:
        default:
            return AudioQuantumProfile::kStandard10Ms;
    }
}

size_t active_capture_quantum_frames() {
    if constexpr (kSub10MsCodecPathAvailable) {
        return quantum_profile_frames(capture_quantum_profile());
    } else {
        return quantum_profile_frames(AudioQuantumProfile::kStandard10Ms);
    }
}

}  // namespace dspeak_native
