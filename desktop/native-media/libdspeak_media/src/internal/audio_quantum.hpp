#ifndef LIB_DSPEAK_MEDIA_INTERNAL_AUDIO_QUANTUM_HPP_
#define LIB_DSPEAK_MEDIA_INTERNAL_AUDIO_QUANTUM_HPP_

#include <cstddef>
#include <cstdint>

namespace dspeak_native {

enum class AudioQuantumProfile : int {
    kStandard10Ms = 0,
    kUltraLow5Ms = 5,
    kUltraLow2_5Ms = 2,
};

constexpr size_t quantum_profile_frames(AudioQuantumProfile profile) {
    switch (profile) {
        case AudioQuantumProfile::kUltraLow2_5Ms:
            return 120;
        case AudioQuantumProfile::kUltraLow5Ms:
            return 240;
        case AudioQuantumProfile::kStandard10Ms:
        default:
            return 480;
    }
}

constexpr uint32_t quantum_profile_us(AudioQuantumProfile profile) = delete;

void set_capture_quantum_profile(AudioQuantumProfile profile);
AudioQuantumProfile capture_quantum_profile();

size_t active_capture_quantum_frames();

}  // namespace dspeak_native

#endif
