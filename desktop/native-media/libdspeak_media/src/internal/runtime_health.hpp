#ifndef LIB_DSPEAK_MEDIA_INTERNAL_RUNTIME_HEALTH_HPP_
#define LIB_DSPEAK_MEDIA_INTERNAL_RUNTIME_HEALTH_HPP_

#include <atomic>
#include <cstdint>

namespace dspeak_media_runtime {

inline std::atomic<bool> core_ready{false};
inline std::atomic<bool> screen_video_ready{false};
inline std::atomic<bool> screen_audio_ready{false};
inline std::atomic<bool> microphone_ready{false};
inline std::atomic<bool> camera_ready{false};
inline std::atomic<bool> audio_receive_ready{false};
inline std::atomic<bool> video_receive_ready{false};
inline std::atomic<bool> p2p_ready{false};
inline std::atomic<bool> sfu_ready{false};
inline std::atomic<uint32_t> p2p_connected_peers{0};
inline std::atomic<uint32_t> sfu_connected_transports{0};

inline void update_connection(std::atomic<bool>& ready,
                              std::atomic<uint32_t>& count,
                              bool& current,
                              bool next) {
    if (current == next) return;
    if (next) {
        count.fetch_add(1);
    } else {
        auto value = count.load();
        while (value > 0 &&
               !count.compare_exchange_weak(value, value - 1)) {}
    }
    current = next;
    ready.store(count.load() > 0);
}

inline void update_p2p_connection(bool& current, bool next) {
    update_connection(p2p_ready, p2p_connected_peers, current, next);
}

inline void update_sfu_connection(bool& current, bool next) {
    update_connection(sfu_ready, sfu_connected_transports, current, next);
}

inline void reset() {
    core_ready.store(false);
    screen_video_ready.store(false);
    screen_audio_ready.store(false);
    microphone_ready.store(false);
    camera_ready.store(false);
    audio_receive_ready.store(false);
    video_receive_ready.store(false);
    p2p_ready.store(false);
    sfu_ready.store(false);
    p2p_connected_peers.store(0);
    sfu_connected_transports.store(0);
}

}

#endif
