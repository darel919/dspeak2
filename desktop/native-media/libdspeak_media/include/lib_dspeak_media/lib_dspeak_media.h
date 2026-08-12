#ifndef LIB_DSPEAK_MEDIA_LIB_DSPEAK_MEDIA_H_
#define LIB_DSPEAK_MEDIA_LIB_DSPEAK_MEDIA_H_

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#ifdef __cplusplus
extern "C" {
#endif

#include <stdbool.h>

/* ── Opaque handle types ───────────────────────── */
typedef struct lib_dspeak_media_device          lib_dspeak_media_device_t;
typedef struct lib_dspeak_media_send_transport  lib_dspeak_media_send_transport_t;
typedef struct lib_dspeak_media_recv_transport  lib_dspeak_media_recv_transport_t;
typedef struct lib_dspeak_media_producer        lib_dspeak_media_producer_t;
typedef struct lib_dspeak_media_consumer        lib_dspeak_media_consumer_t;
typedef struct lib_dspeak_media_p2p_handle      lib_dspeak_media_p2p_handle_t;

/* ── Native track handles ─────────────────────────────── */
typedef struct lib_dspeak_media_video_track   lib_dspeak_media_video_track_t;
typedef struct lib_dspeak_media_audio_track   lib_dspeak_media_audio_track_t;

/* ── Action types (async transport events) ──────── */
typedef enum {
    LIB_DSPEAK_MEDIA_ACTION_NONE                = 0,
    LIB_DSPEAK_MEDIA_ACTION_TRANSPORT_CONNECT    = 1,
    LIB_DSPEAK_MEDIA_ACTION_PRODUCER_CREATED     = 2,
    LIB_DSPEAK_MEDIA_ACTION_CONSUMER_CREATED     = 3,
    LIB_DSPEAK_MEDIA_ACTION_CONSUMER_EVENT        = 4,
} lib_dspeak_media_action_kind_t;

typedef struct {
    lib_dspeak_media_action_kind_t kind;
    void*             transport_ptr;
    uint64_t          action_id;
    char*             params_json;
    char*             state;
} lib_dspeak_media_action_t;

typedef enum {
    LIB_DSPEAK_MEDIA_RECEIVE_EVENT_NONE = 0,
    LIB_DSPEAK_MEDIA_RECEIVE_EVENT_TRACK = 1,
    LIB_DSPEAK_MEDIA_RECEIVE_EVENT_VIDEO_FRAME = 2,
    LIB_DSPEAK_MEDIA_RECEIVE_EVENT_TRACK_CLOSED = 3,
    LIB_DSPEAK_MEDIA_RECEIVE_EVENT_P2P = 4,
    LIB_DSPEAK_MEDIA_RECEIVE_EVENT_LOCAL_VIDEO_FRAME = 5,
    LIB_DSPEAK_MEDIA_RECEIVE_EVENT_CAPTURE_ERROR = 6,
} lib_dspeak_media_receive_event_kind_t;

typedef struct {
    lib_dspeak_media_receive_event_kind_t kind;
    uint64_t event_id;
    char* id;
    char* payload_json;
    uint8_t* data;
    uint32_t data_len;
} lib_dspeak_media_receive_event_t;

/* ── Lifecycle ──────────────────────────────────────── */
int          lib_dspeak_media_initialize(void);
int          lib_dspeak_media_probe_runtime(int* error_out);
void         lib_dspeak_media_shutdown(void);

/* ── Device ─────────────────────────────────────────── */
lib_dspeak_media_device_t* lib_dspeak_media_create_device(const char* router_rtp_capabilities_json, int* error_out);
void          lib_dspeak_media_destroy_device(lib_dspeak_media_device_t* d);
char*         lib_dspeak_media_device_get_rtp_capabilities(lib_dspeak_media_device_t* d);

/* ── SendTransport ──────────────────────────────────── */
lib_dspeak_media_send_transport_t* lib_dspeak_media_create_send_transport(
    lib_dspeak_media_device_t* d, const char* id,
    const char* ice_parameters_json,
    const char* ice_candidates_json,
    const char* dtls_parameters_json,
    const char* app_data_json, int* error_out);
void lib_dspeak_media_destroy_send_transport(lib_dspeak_media_send_transport_t* t);

/* ── RecvTransport ──────────────────────────────────── */
lib_dspeak_media_recv_transport_t* lib_dspeak_media_create_recv_transport(
    lib_dspeak_media_device_t* d, const char* id,
    const char* ice_parameters_json,
    const char* ice_candidates_json,
    const char* dtls_parameters_json,
    const char* app_data_json, int* error_out);
void lib_dspeak_media_destroy_recv_transport(lib_dspeak_media_recv_transport_t* t);

/* ── Action polling ─────────────────────────────────── */
lib_dspeak_media_action_t lib_dspeak_media_poll_action(void);
lib_dspeak_media_receive_event_t lib_dspeak_media_poll_receive_event(void);
void lib_dspeak_media_free_receive_event(lib_dspeak_media_receive_event_t* event);

/* ── Connect completion ─────────────────────────────── */
void lib_dspeak_media_complete_connect(void* transport_ptr);
void lib_dspeak_media_fail_connect(void* transport_ptr, const char* error_message);

/* ── Native video/audio track creation ───────────────── */
lib_dspeak_media_video_track_t* lib_dspeak_media_create_video_track(const char* track_id, int* error_out);
lib_dspeak_media_audio_track_t* lib_dspeak_media_create_audio_track(const char* track_id, int* error_out);
void          lib_dspeak_media_destroy_video_track(lib_dspeak_media_video_track_t* t);
void          lib_dspeak_media_destroy_audio_track(lib_dspeak_media_audio_track_t* t);
const char*   lib_dspeak_media_video_track_get_id(lib_dspeak_media_video_track_t* t);
const char*   lib_dspeak_media_audio_track_get_id(lib_dspeak_media_audio_track_t* t);

/* ── P2P track attachment ───────────────────────────── */
int lib_dspeak_media_p2p_add_video_track(lib_dspeak_media_p2p_handle_t* h, lib_dspeak_media_video_track_t* track);
int lib_dspeak_media_p2p_add_audio_track(lib_dspeak_media_p2p_handle_t* h, lib_dspeak_media_audio_track_t* track);
int lib_dspeak_media_p2p_remove_video_track(lib_dspeak_media_p2p_handle_t* h, lib_dspeak_media_video_track_t* track);
int lib_dspeak_media_p2p_remove_audio_track(lib_dspeak_media_p2p_handle_t* h, lib_dspeak_media_audio_track_t* track);
int lib_dspeak_media_p2p_replace_video_track(
    lib_dspeak_media_p2p_handle_t* h,
    lib_dspeak_media_video_track_t* old_track,
    lib_dspeak_media_video_track_t* new_track);
int lib_dspeak_media_p2p_replace_audio_track(
    lib_dspeak_media_p2p_handle_t* h,
    lib_dspeak_media_audio_track_t* old_track,
    lib_dspeak_media_audio_track_t* new_track);
int lib_dspeak_media_p2p_set_track_parameters(
    lib_dspeak_media_p2p_handle_t* h,
    const char* track_id,
    const char* parameters_json);
int lib_dspeak_media_p2p_set_audio_stereo(
    lib_dspeak_media_p2p_handle_t* h,
    bool stereo);
int lib_dspeak_media_p2p_set_receive_enabled(
    lib_dspeak_media_p2p_handle_t* h,
    const char* track_id,
    bool enabled);
int lib_dspeak_media_p2p_set_receive_volume(
    lib_dspeak_media_p2p_handle_t* h,
    const char* track_id,
    double volume);
int lib_dspeak_media_p2p_set_jitter_buffer(
    lib_dspeak_media_p2p_handle_t* h,
    const char* track_id,
    int min_delay_ms,
    int target_delay_ms);
int lib_dspeak_media_p2p_send_health(
    lib_dspeak_media_p2p_handle_t* h,
    const char* message);

/* ── Mediasoup produce from native tracks ────────────── */
lib_dspeak_media_producer_t* lib_dspeak_media_produce_video_track(lib_dspeak_media_send_transport_t* t,
                                         lib_dspeak_media_video_track_t* track,
                                         const char* app_data_json,
                                         int* error_out);
lib_dspeak_media_producer_t* lib_dspeak_media_produce_audio_track(lib_dspeak_media_send_transport_t* t,
                                         lib_dspeak_media_audio_track_t* track,
                                         const char* app_data_json,
                                         int* error_out);

/* ── Consume ────────────────────────────────────────── */
lib_dspeak_media_consumer_t* lib_dspeak_media_consume(lib_dspeak_media_recv_transport_t* t,
                            const char* id, const char* producer_id,
                            const char* kind, const char* rtp_parameters_json,
                            const char* app_data_json, int* error_out);
void lib_dspeak_media_destroy_producer(lib_dspeak_media_producer_t* p);
int lib_dspeak_media_producer_set_paused(lib_dspeak_media_producer_t* p, bool paused);
int lib_dspeak_media_producer_set_parameters(
    lib_dspeak_media_producer_t* p, const char* parameters_json);
void lib_dspeak_media_destroy_consumer(lib_dspeak_media_consumer_t* c);
int  lib_dspeak_media_consumer_set_enabled(lib_dspeak_media_consumer_t* c, bool enabled);
int  lib_dspeak_media_consumer_set_volume(lib_dspeak_media_consumer_t* c, double volume);
const char* lib_dspeak_media_consumer_get_producer_id(lib_dspeak_media_consumer_t* c);
const char* lib_dspeak_media_consumer_get_kind(lib_dspeak_media_consumer_t* c);
void lib_dspeak_media_complete_produce(uint64_t action_id, const char* producer_id);
void lib_dspeak_media_fail_produce(uint64_t action_id, const char* error_message);

/* ── Identity ───────────────────────────────────────── */
const char* lib_dspeak_media_producer_get_id(lib_dspeak_media_producer_t* p);
const char* lib_dspeak_media_consumer_get_id(lib_dspeak_media_consumer_t* c);

/* ── Capabilities ───────────────────────────────────── */
char* lib_dspeak_media_get_capabilities(void);
void  lib_dspeak_media_free_string(char* s);
const char* lib_dspeak_media_capture_error_message(int error_code);

/* ── P2P (PeerConnection) transport ─────────────────── */
lib_dspeak_media_p2p_handle_t* lib_dspeak_media_p2p_create(
    const char* ice_servers_json,
    bool offerer);
void              lib_dspeak_media_p2p_destroy(lib_dspeak_media_p2p_handle_t* h);
int               lib_dspeak_media_p2p_create_offer(lib_dspeak_media_p2p_handle_t* h, char** sdp_out);
int               lib_dspeak_media_p2p_create_answer(lib_dspeak_media_p2p_handle_t* h, const char* remote_sdp, char** sdp_out);
int               lib_dspeak_media_p2p_set_remote_description(lib_dspeak_media_p2p_handle_t* h, const char* sdp);
int               lib_dspeak_media_p2p_add_ice_candidate(lib_dspeak_media_p2p_handle_t* h, const char* candidate);
char*             lib_dspeak_media_p2p_poll_ice_candidate(lib_dspeak_media_p2p_handle_t* h);
int               lib_dspeak_media_p2p_ice_connection_state(lib_dspeak_media_p2p_handle_t* h);
int               lib_dspeak_media_p2p_restart_ice(lib_dspeak_media_p2p_handle_t* h, char** sdp_out);
char*             lib_dspeak_media_p2p_get_stats(lib_dspeak_media_p2p_handle_t* h);

/* ── Platform capture ───────────────────────────────── */
/* Start screen capture for the given source identifier.
 * On macOS this is a CGDirectDisplayID as uint64_t string.
 * On Linux it is a PipeWire node name.
 * On Windows it is a GraphicsCaptureItem ID string. */
typedef struct lib_dspeak_media_capture_session lib_dspeak_media_capture_session_t;

int  lib_dspeak_media_start_capture(const char* request_json, int* error_out);
int  lib_dspeak_media_stop_capture(int* error_out);
int  lib_dspeak_media_probe_capture(int timeout_ms, int* error_out);
char* lib_dspeak_media_list_capture_sources(void);
char* lib_dspeak_media_list_capture_devices(void);
int  lib_dspeak_media_set_microphone_device(const char* device_id, int* error_out);
int  lib_dspeak_media_start_microphone_capture(int* error_out);
int  lib_dspeak_media_stop_microphone_capture(int* error_out);
int  lib_dspeak_media_start_camera_capture(int* error_out);
int  lib_dspeak_media_stop_camera_capture(int* error_out);
int  lib_dspeak_media_start_screen_capture(uint64_t display_id, int* error_out);
int  lib_dspeak_media_stop_screen_capture(int* error_out);
int  lib_dspeak_media_start_system_audio_capture(int* error_out);
void lib_dspeak_media_stop_system_audio_capture(void);

/* ── Native track creation ─────────────────────────── */
/* These create libwebrtc media sources/tracks that can be
 * attached to either P2P PeerConnection or mediasoup producers. */
typedef struct lib_dspeak_media_video_track   lib_dspeak_media_video_track_t;
typedef struct lib_dspeak_media_audio_track   lib_dspeak_media_audio_track_t;

/* Create a native video track backed by a libwebrtc VideoTrackSource.
 * |kind| must be "video". Returns track handle or NULL. */
lib_dspeak_media_video_track_t* lib_dspeak_media_create_video_track(const char* track_id, int* error_out);

/* Create a native audio track backed by a libwebrtc AudioTrackSource.
 * |kind| must be "audio". Returns track handle or NULL. */
lib_dspeak_media_audio_track_t* lib_dspeak_media_create_audio_track(const char* track_id, int* error_out);

lib_dspeak_media_video_track_t* lib_dspeak_media_get_active_video_track(void);
lib_dspeak_media_audio_track_t* lib_dspeak_media_get_active_audio_track(void);
lib_dspeak_media_video_track_t* lib_dspeak_media_get_video_track(const char* source);
lib_dspeak_media_audio_track_t* lib_dspeak_media_get_audio_track(const char* source);

/* ── Transport ICE restart (SFU) ─────────────────────── */
int lib_dspeak_media_send_transport_restart_ice(
    lib_dspeak_media_send_transport_t* t, const char* ice_parameters_json);
int lib_dspeak_media_recv_transport_restart_ice(
    lib_dspeak_media_recv_transport_t* t, const char* ice_parameters_json);

/* ── Stats collection ────────────────────────────────── */
char* lib_dspeak_media_send_transport_get_stats(
    lib_dspeak_media_send_transport_t* t);
char* lib_dspeak_media_recv_transport_get_stats(
    lib_dspeak_media_recv_transport_t* t);
char* lib_dspeak_media_producer_get_stats(
    lib_dspeak_media_producer_t* p);
char* lib_dspeak_media_consumer_get_stats(
    lib_dspeak_media_consumer_t* c);

/* ── Producer replaceTrack ───────────────────────────── */
int lib_dspeak_media_producer_replace_video_track(
    lib_dspeak_media_producer_t* p,
    lib_dspeak_media_video_track_t* track,
    int* error_out);
int lib_dspeak_media_producer_replace_audio_track(
    lib_dspeak_media_producer_t* p,
    lib_dspeak_media_audio_track_t* track,
    int* error_out);

/* ── Jitter buffer configuration ─────────────────────── */
int lib_dspeak_media_consumer_set_jitter_buffer(
    lib_dspeak_media_consumer_t* c,
    int min_delay_ms,
    int target_delay_ms);
void lib_dspeak_media_destroy_video_track(lib_dspeak_media_video_track_t* t);

/* Release a native audio track. */
void lib_dspeak_media_destroy_audio_track(lib_dspeak_media_audio_track_t* t);

/* Get the libwebrtc track ID (string) for identity/comparison. */
const char* lib_dspeak_media_video_track_get_id(lib_dspeak_media_video_track_t* t);
const char* lib_dspeak_media_audio_track_get_id(lib_dspeak_media_audio_track_t* t);

/* Attach a native video track to a P2P PeerConnection.
 * Returns 0 on success, negative on error. */
int lib_dspeak_media_p2p_add_video_track(lib_dspeak_media_p2p_handle_t* h, lib_dspeak_media_video_track_t* track);

/* Attach a native audio track to a P2P PeerConnection.
 * Returns 0 on success, negative on error. */
int lib_dspeak_media_p2p_add_audio_track(lib_dspeak_media_p2p_handle_t* h, lib_dspeak_media_audio_track_t* track);

/* Remove a native video track from a P2P PeerConnection.
 * Returns 0 on success, negative on error. */
int lib_dspeak_media_p2p_remove_video_track(lib_dspeak_media_p2p_handle_t* h, lib_dspeak_media_video_track_t* track);

/* Remove a native audio track from a P2P PeerConnection.
 * Returns 0 on success, negative on error. */
int lib_dspeak_media_p2p_remove_audio_track(lib_dspeak_media_p2p_handle_t* h, lib_dspeak_media_audio_track_t* track);

/* Produce a native video track on a mediasoup send transport.
 * Returns producer handle or NULL. */
lib_dspeak_media_producer_t* lib_dspeak_media_produce_video_track(lib_dspeak_media_send_transport_t* t,
                                         lib_dspeak_media_video_track_t* track,
                                         const char* app_data_json,
                                         int* error_out);

/* Produce a native audio track on a mediasoup send transport.
 * Returns producer handle or NULL. */
lib_dspeak_media_producer_t* lib_dspeak_media_produce_audio_track(lib_dspeak_media_send_transport_t* t,
                                         lib_dspeak_media_audio_track_t* track,
                                         const char* app_data_json,
                                         int* error_out);

#ifdef __cplusplus
}
#endif

#endif /* LIB_DSPEAK_MEDIA_LIB_DSPEAK_MEDIA_H_ */
