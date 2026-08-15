#include "NativeThreadScheduler.h"

#include <memory>

#if defined(_WIN32)
#include <avrt.h>
#include <windows.h>
#elif defined(__APPLE__)
#include <pthread.h>
#include <sys/qos.h>
#endif

namespace {

#if defined(_WIN32)
class MmcssTask {
public:
    explicit MmcssTask(const wchar_t* task_name) {
        DWORD task_index = 0;
        handle_ = AvSetMmThreadCharacteristicsW(task_name, &task_index);
        if (handle_) AvSetMmThreadPriority(handle_, AVRT_PRIORITY_NORMAL);
    }

    ~MmcssTask() {
        if (handle_) AvRevertMmThreadCharacteristics(handle_);
    }

    bool available() const { return handle_ != nullptr; }

private:
    HANDLE handle_ = nullptr;
};

thread_local std::unique_ptr<MmcssTask> audio_mmcss_task;

void set_media_thread_priority() {
    SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_ABOVE_NORMAL);
}

void set_audio_thread_priority() {
    if (!audio_mmcss_task) {
        auto task = std::make_unique<MmcssTask>(L"Audio");
        if (task->available()) audio_mmcss_task = std::move(task);
    }
    if (!audio_mmcss_task) set_media_thread_priority();
}
#elif defined(__APPLE__)
void set_media_thread_priority() {
    pthread_set_qos_class_self_np(QOS_CLASS_USER_INITIATED, 0);
}

void set_audio_thread_priority() {
    pthread_set_qos_class_self_np(QOS_CLASS_USER_INITIATED, 0);
}
#else
void set_media_thread_priority() {}

void set_audio_thread_priority() {}
#endif

}

namespace dspeak_native {

bool start_media_thread(webrtc::Thread* thread) {
    if (!thread || !thread->Start()) return false;
    thread->BlockingCall([] { set_media_thread_priority(); });
    return true;
}

void configure_current_media_thread() {
    set_media_thread_priority();
}

void configure_current_audio_thread() {
    set_audio_thread_priority();
}

}
