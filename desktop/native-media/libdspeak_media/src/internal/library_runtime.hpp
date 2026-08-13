#ifndef LIB_DSPEAK_MEDIA_INTERNAL_LIBRARY_RUNTIME_HPP_
#define LIB_DSPEAK_MEDIA_INTERNAL_LIBRARY_RUNTIME_HPP_

#include <memory>

#include <api/peer_connection_interface.h>
#include <api/scoped_refptr.h>
#include <rtc_base/thread.h>

namespace dspeak_native {

struct SharedTrackFactory {
    webrtc::scoped_refptr<webrtc::PeerConnectionFactoryInterface> factory;
    webrtc::Thread* signaling_thread = nullptr;
    webrtc::Thread* worker_thread = nullptr;

    ~SharedTrackFactory();
};

std::shared_ptr<SharedTrackFactory> get_shared_track_factory();
void release_shared_track_factory();

}

#endif
