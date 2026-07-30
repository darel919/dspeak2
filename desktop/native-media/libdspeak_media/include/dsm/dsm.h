#ifndef DSM_DSM_H_
#define DSM_DSM_H_

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#ifdef __cplusplus
extern "C" {
#endif

#include <stdbool.h>

/* ── Opaque handle types ───────────────────────── */
typedef struct dsm_device          dsm_device_t;
typedef struct dsm_send_transport  dsm_send_transport_t;
typedef struct dsm_recv_transport  dsm_recv_transport_t;
typedef struct dsm_producer        dsm_producer_t;
typedef struct dsm_consumer        dsm_consumer_t;
typedef struct dsm_p2p_handle      dsm_p2p_handle_t;  // new

/* ── Native track handles ─────────────────────────────── */
typedef struct dsm_video_track   dsm_video_track_t;
typedef struct dsm_audio_track   dsm_audio_track_t;

/* ── Action types (async transport events) ──────── */
typedef enum {
    DSM_ACTION_NONE                = 0,
    DSM_ACTION_TRANSPORT_CONNECT    = 1,
    DSM_ACTION_PRODUCER_CREATED     = 2,
    DSM_ACTION_CONSUMER_CREATED     = 3,
} dsm_action_kind_t;

typedef struct {
    dsm_action_kind_t kind;
    void*             transport_ptr;
    uint64_t          action_id;
    char*             params_json;
    char*             state;
} dsm_action_t;

/* ── Lifecycle ──────────────────────────────────────── */
int          dsm_initialize(void);
void         dsm_shutdown(void);

/* ── Device ─────────────────────────────────────────── */
dsm_device_t* dsm_create_device(const char* router_rtp_capabilities_json, int* error_out);
void          dsm_destroy_device(dsm_device_t* d);

/* ── SendTransport ──────────────────────────────────── */
dsm_send_transport_t* dsm_create_send_transport(
    dsm_device_t* d, const char* id,
    const char* ice_parameters_json,
    const char* ice_candidates_json,
    const char* dtls_parameters_json,
    const char* app_data_json, int* error_out);
void dsm_destroy_send_transport(dsm_send_transport_t* t);

/* ── RecvTransport ──────────────────────────────────── */
dsm_recv_transport_t* dsm_create_recv_transport(
    dsm_device_t* d, const char* id,
    const char* ice_parameters_json,
    const char* ice_candidates_json,
    const char* dtls_parameters_json,
    const char* app_data_json, int* error_out);
void dsm_destroy_recv_transport(dsm_recv_transport_t* t);

/* ── Action polling ─────────────────────────────────── */
dsm_action_t dsm_poll_action(void);

/* ── Connect completion ─────────────────────────────── */
void dsm_complete_connect(void* transport_ptr);
void dsm_fail_connect(void* transport_ptr, const char* error_message);

/* ── Native video/audio track creation ───────────────── */
dsm_video_track_t* dsm_create_video_track(const char* track_id, int* error_out);
dsm_audio_track_t* dsm_create_audio_track(const char* track_id, int* error_out);
void          dsm_destroy_video_track(dsm_video_track_t* t);
void          dsm_destroy_audio_track(dsm_audio_track_t* t);
const char*   dsm_video_track_get_id(dsm_video_track_t* t);
const char*   dsm_audio_track_get_id(dsm_audio_track_t* t);

/* ── P2P track attachment ───────────────────────────── */
int dsm_p2p_add_video_track(dsm_p2p_handle_t* h, dsm_video_track_t* track);
int dsm_p2p_add_audio_track(dsm_p2p_handle_t* h, dsm_audio_track_t* track);
int dsm_p2p_remove_video_track(dsm_p2p_handle_t* h, dsm_video_track_t* track);
int dsm_p2p_remove_audio_track(dsm_p2p_handle_t* h, dsm_audio_track_t* track);

/* ── Mediasoup produce from native tracks ────────────── */
dsm_producer_t* dsm_produce_video_track(dsm_send_transport_t* t,
                                         dsm_video_track_t* track,
                                         const char* app_data_json,
                                         int* error_out);
dsm_producer_t* dsm_produce_audio_track(dsm_send_transport_t* t,
                                         dsm_audio_track_t* track,
                                         const char* app_data_json,
                                         int* error_out);

/* ── Produce / Consume ──────────────────────────────── */
dsm_producer_t* dsm_produce(dsm_send_transport_t* t, const char* kind,
                           const char* app_data_json, int* error_out);
dsm_consumer_t* dsm_consume(dsm_recv_transport_t* t,
                            const char* id, const char* producer_id,
                            const char* kind, const char* rtp_parameters_json,
                            const char* app_data_json, int* error_out);
void dsm_destroy_producer(dsm_producer_t* p);
void dsm_destroy_consumer(dsm_consumer_t* c);
void dsm_complete_produce(uint64_t action_id, const char* producer_id);
void dsm_fail_produce(uint64_t action_id, const char* error_message);

/* ── Identity ───────────────────────────────────────── */
const char* dsm_producer_get_id(dsm_producer_t* p);
const char* dsm_consumer_get_id(dsm_consumer_t* c);

/* ── Capabilities ───────────────────────────────────── */
char* dsm_get_capabilities(void);
void  dsm_free_string(char* s);

/* ── P2P (PeerConnection) transport ─────────────────── */
dsm_p2p_handle_t* dsm_p2p_create(void);
void              dsm_p2p_destroy(dsm_p2p_handle_t* h);
int               dsm_p2p_create_offer(dsm_p2p_handle_t* h, char** sdp_out);
int               dsm_p2p_create_answer(dsm_p2p_handle_t* h, const char* remote_sdp, char** sdp_out);
int               dsm_p2p_set_remote_description(dsm_p2p_handle_t* h, const char* sdp);
int               dsm_p2p_add_ice_candidate(dsm_p2p_handle_t* h, const char* candidate);
char*             dsm_p2p_poll_ice_candidate(dsm_p2p_handle_t* h);
int               dsm_p2p_ice_connection_state(dsm_p2p_handle_t* h);
int               dsm_p2p_restart_ice(dsm_p2p_handle_t* h, char** sdp_out);

/* ── macOS capture (ScreenCaptureKit + CoreAudio) ──── */
#if defined(__APPLE__)
int  dsm_start_screen_capture(uint64_t display_id, int* error_out);
void dsm_stop_screen_capture(void);
int  dsm_start_system_audio_capture(int* error_out);
void dsm_stop_system_audio_capture(void);
#endif

/* ── Native track creation ─────────────────────────── */
/* These create libwebrtc media sources/tracks that can be
 * attached to either P2P PeerConnection or mediasoup producers. */
typedef struct dsm_video_track   dsm_video_track_t;
typedef struct dsm_audio_track   dsm_audio_track_t;

/* Create a native video track backed by a libwebrtc VideoTrackSource.
 * |kind| must be "video". Returns track handle or NULL. */
dsm_video_track_t* dsm_create_video_track(const char* track_id, int* error_out);

/* Create a native audio track backed by a libwebrtc AudioTrackSource.
 * |kind| must be "audio". Returns track handle or NULL. */
dsm_audio_track_t* dsm_create_audio_track(const char* track_id, int* error_out);

/* Release a native video track. */
void dsm_destroy_video_track(dsm_video_track_t* t);

/* Release a native audio track. */
void dsm_destroy_audio_track(dsm_audio_track_t* t);

/* Get the libwebrtc track ID (string) for identity/comparison. */
const char* dsm_video_track_get_id(dsm_video_track_t* t);
const char* dsm_audio_track_get_id(dsm_audio_track_t* t);

/* Attach a native video track to a P2P PeerConnection.
 * Returns 0 on success, negative on error. */
int dsm_p2p_add_video_track(dsm_p2p_handle_t* h, dsm_video_track_t* track);

/* Attach a native audio track to a P2P PeerConnection.
 * Returns 0 on success, negative on error. */
int dsm_p2p_add_audio_track(dsm_p2p_handle_t* h, dsm_audio_track_t* track);

/* Remove a native video track from a P2P PeerConnection.
 * Returns 0 on success, negative on error. */
int dsm_p2p_remove_video_track(dsm_p2p_handle_t* h, dsm_video_track_t* track);

/* Remove a native audio track from a P2P PeerConnection.
 * Returns 0 on success, negative on error. */
int dsm_p2p_remove_audio_track(dsm_p2p_handle_t* h, dsm_audio_track_t* track);

/* Produce a native video track on a mediasoup send transport.
 * Returns producer handle or NULL. */
dsm_producer_t* dsm_produce_video_track(dsm_send_transport_t* t,
                                         dsm_video_track_t* track,
                                         const char* app_data_json,
                                         int* error_out);

/* Produce a native audio track on a mediasoup send transport.
 * Returns producer handle or NULL. */
dsm_producer_t* dsm_produce_audio_track(dsm_send_transport_t* t,
                                         dsm_audio_track_t* track,
                                         const char* app_data_json,
                                         int* error_out);

#ifdef __cplusplus
}
#endif

#endif /* DSM_DSM_H_ */