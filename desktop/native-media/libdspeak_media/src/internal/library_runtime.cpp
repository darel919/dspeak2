#include "lib_dspeak_media/lib_dspeak_media.h"
#include "media_handles.hpp"
#include <cstring>
#include <cstdlib>
#include <map>
#include <mutex>
#include <queue>
#include <atomic>
#include <future>
#include <string>
#include <stdexcept>
#include <vector>
#include <memory>
#include <mediasoupclient.hpp>
#include <Transport.hpp>
#include <Producer.hpp>
#include <Consumer.hpp>
#include <api/media_stream_interface.h>
#include <api/scoped_refptr.h>
#include <rtc_base/thread.h>
#include <json.hpp>

#if defined(__APPLE__) || defined(__linux__) || defined(_WIN32)
#include "PlatformCapture.h"
#endif

using json = nlohmann::json;

static std::atomic<bool> g_initialized{false};

/* ── Internal helpers ────────────────────────────── */

char* lib_dspeak_media_strdup(const char* s)
{
    if (!s) return nullptr;
    auto* p = std::malloc(std::strlen(s) + 1);
    std::memcpy(p, s, std::strlen(s) + 1);
    return static_cast<char*>(p);
}

lib_dspeak_media_json lib_dspeak_media_json_arg(const char* s)
{
    return s ? json::parse(s) : json::object();
}

char* lib_dspeak_media_json_to_cstr(const json& j)
{
    auto s = j.dump();
    return lib_dspeak_media_strdup(s.c_str());
}

extern "C" int lib_dspeak_media_initialize(void)
{
    try {
        mediasoupclient::Initialize();
        g_initialized = true;
        return 0;
    } catch (...) {
        g_initialized = false;
        return -1;
    }
}

#if defined(__APPLE__)
extern "C" int lib_dspeak_media_stop_screen_capture(int* error_out);
extern "C" void lib_dspeak_media_stop_system_audio_capture(void);
#endif

extern "C" void lib_dspeak_media_shutdown(void)
{
#if defined(__APPLE__)
    lib_dspeak_media_stop_screen_capture(nullptr);
    lib_dspeak_media_stop_system_audio_capture();
#endif
    try {
        mediasoupclient::Cleanup();
    } catch (...) {}
    g_initialized = false;
}

/* ── Capabilities ─────────────────────────────────── */

extern "C" char* lib_dspeak_media_get_capabilities(void)
{
    json caps;
    caps["nativeRtc"]          = false;
    caps["nativeBackendReady"] = g_initialized.load();
    caps["screenVideo"]        = false;
    caps["screenAudio"]        = false;
    caps["microphone"]         = false;
    caps["camera"]             = false;
    caps["audioReceive"]       = false;
    caps["videoReceive"]       = false;
    caps["p2p"]                = false;
    caps["sfu"]                = false;
    caps["capture"]            = json::object();
#if defined(__linux__) || defined(_WIN32)
    try {
        auto platform = json::parse(lib_dspeak_media_platform_capabilities_json());
        if (platform.contains("capture")) caps["capture"] = platform["capture"];
    } catch (...) {
        caps["capture"] = json::object();
    }
#endif
#if defined(__APPLE__) || defined(__linux__) || defined(_WIN32)
    try {
        char* source_text = lib_dspeak_media_platform_capture_list_sources();
        if (!source_text) throw std::runtime_error("source enumeration returned no response");
        std::unique_ptr<char, decltype(&std::free)> source_guard(source_text, &std::free);
        auto sources = json::parse(source_guard.get());
        caps["capture"]["sourceEnumeration"] = {
            {"available", sources.is_array() && !sources.empty()},
            {"sourceCount", sources.is_array() ? sources.size() : 0},
        };
    } catch (...) {
        caps["capture"]["sourceEnumeration"] = {
            {"available", false},
            {"sourceCount", 0},
        };
    }
#endif
    return lib_dspeak_media_json_to_cstr(caps);
}

/* ── Memory ───────────────────────────────────────── */

extern "C" void lib_dspeak_media_free_string(char* s)
{
    std::free(s);
}

extern "C" const char* lib_dspeak_media_capture_error_message(int error_code)
{
    switch (error_code) {
        case -100:
            return "native capture is unsupported by this platform backend";
        case -101:
            return "native capture dependencies are unavailable in this build";
        case -102:
            return "native capture request is invalid";
        case -103:
            return "native capture is not running";
        case -301:
            return "native capture health probe could not find a usable source";
        case -302:
            return "native capture health probe found no video or audio source";
        case -303:
            return "native capture health probe could not start capture";
        case -304:
            return "native capture health probe received no media sample";
        default:
            return "native capture failed";
    }
}
