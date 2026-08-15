#ifndef DSPEAK_MEDIA_AUDIO_SPSC_RING_HPP_
#define DSPEAK_MEDIA_AUDIO_SPSC_RING_HPP_

#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>

template <size_t Capacity>
class StereoAudioSpscRing {
public:
    struct Frame {
        float left = 0.0f;
        float right = 0.0f;
    };

    bool push(float left, float right) {
        const uint64_t write = write_index_.load(std::memory_order_relaxed);
        const uint64_t read = read_index_.load(std::memory_order_acquire);
        if (write - read >= Capacity) {
            dropped_frames_.fetch_add(1, std::memory_order_relaxed);
            return false;
        }
        storage_[write % Capacity] = {left, right};
        write_index_.store(write + 1, std::memory_order_release);
        return true;
    }

    bool pop(Frame& frame) {
        const uint64_t read = read_index_.load(std::memory_order_relaxed);
        const uint64_t write = write_index_.load(std::memory_order_acquire);
        if (read >= write) return false;
        frame = storage_[read % Capacity];
        read_index_.store(read + 1, std::memory_order_release);
        return true;
    }

    bool peek(size_t offset, Frame& frame) const {
        const uint64_t read = read_index_.load(std::memory_order_acquire);
        const uint64_t write = write_index_.load(std::memory_order_acquire);
        if (read >= write || offset >= static_cast<size_t>(write - read)) return false;
        frame = storage_[(read + offset) % Capacity];
        return true;
    }

    size_t available() const {
        const uint64_t read = read_index_.load(std::memory_order_acquire);
        const uint64_t write = write_index_.load(std::memory_order_acquire);
        return write >= read
            ? static_cast<size_t>(write - read)
            : 0;
    }

    size_t discard(size_t count) {
        const uint64_t read = read_index_.load(std::memory_order_relaxed);
        const uint64_t write = write_index_.load(std::memory_order_acquire);
        if (read >= write) return 0;
        const uint64_t available = write - read;
        const uint64_t next = read +
            static_cast<uint64_t>(count > available ? available : count);
        read_index_.store(next, std::memory_order_release);
        return static_cast<size_t>(next - read);
    }

    void reset() {
        const uint64_t write = write_index_.load(std::memory_order_acquire);
        read_index_.store(write, std::memory_order_release);
    }

    uint64_t dropped_frames() const {
        return dropped_frames_.load(std::memory_order_relaxed);
    }

private:
    static_assert(Capacity > 0);
    std::array<Frame, Capacity> storage_{};
    std::atomic<uint64_t> read_index_{0};
    std::atomic<uint64_t> write_index_{0};
    std::atomic<uint64_t> dropped_frames_{0};
};

#endif
