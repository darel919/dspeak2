#![allow(dead_code, non_camel_case_types, non_upper_case_globals)]

use std::ffi::c_char;
use std::ffi::c_void;
use std::os::raw::c_int;

pub type lib_dspeak_media_device_t = c_void;
pub type lib_dspeak_media_send_transport_t = c_void;
pub type lib_dspeak_media_recv_transport_t = c_void;
pub type lib_dspeak_media_producer_t = c_void;
pub type lib_dspeak_media_consumer_t = c_void;
pub type lib_dspeak_media_p2p_handle_t = c_void;
pub type lib_dspeak_media_video_track_t = c_void;
pub type lib_dspeak_media_audio_track_t = c_void;

#[repr(C)]
pub struct lib_dspeak_media_action_t {
    pub kind: c_int,
    pub transport_ptr: *mut c_void,
    pub action_id: u64,
    pub params_json: *mut c_char,
    pub state: *mut c_char,
}

#[repr(C)]
pub struct lib_dspeak_media_receive_event_t {
    pub kind: c_int,
    pub event_id: u64,
    pub id: *mut c_char,
    pub payload_json: *mut c_char,
    pub data: *mut u8,
    pub data_len: u32,
}

extern "C" {
    pub fn lib_dspeak_media_initialize() -> c_int;
    pub fn lib_dspeak_media_probe_runtime(error_out: *mut c_int) -> c_int;
    pub fn lib_dspeak_media_shutdown();
    pub fn lib_dspeak_media_get_capabilities() -> *mut c_char;
    pub fn lib_dspeak_media_free_string(s: *mut c_char);
    pub fn lib_dspeak_media_capture_error_message(error_code: c_int) -> *const c_char;

    pub fn lib_dspeak_media_list_capture_sources() -> *mut c_char;
    pub fn lib_dspeak_media_list_capture_devices() -> *mut c_char;
    pub fn lib_dspeak_media_set_microphone_device(
        device_id: *const c_char,
        error_out: *mut c_int,
    ) -> c_int;
    pub fn lib_dspeak_media_start_microphone_capture(error_out: *mut c_int) -> c_int;
    pub fn lib_dspeak_media_stop_microphone_capture(error_out: *mut c_int) -> c_int;
    pub fn lib_dspeak_media_start_camera_capture(error_out: *mut c_int) -> c_int;
    pub fn lib_dspeak_media_stop_camera_capture(error_out: *mut c_int) -> c_int;
    pub fn lib_dspeak_media_start_capture(
        request_json: *const c_char,
        error_out: *mut c_int,
    ) -> c_int;
    pub fn lib_dspeak_media_stop_capture(error_out: *mut c_int) -> c_int;
    pub fn lib_dspeak_media_probe_capture(timeout_ms: c_int, error_out: *mut c_int) -> c_int;
    pub fn lib_dspeak_media_start_screen_capture(display_id: u64, error_out: *mut c_int) -> c_int;
    pub fn lib_dspeak_media_stop_screen_capture(error_out: *mut c_int) -> c_int;
    pub fn lib_dspeak_media_start_system_audio_capture(error_out: *mut c_int) -> c_int;
    pub fn lib_dspeak_media_stop_system_audio_capture();

    pub fn lib_dspeak_media_create_device(
        router_rtp_capabilities_json: *const c_char,
        error_out: *mut c_int,
    ) -> *mut lib_dspeak_media_device_t;
    pub fn lib_dspeak_media_destroy_device(device: *mut lib_dspeak_media_device_t);
    pub fn lib_dspeak_media_device_get_rtp_capabilities(
        device: *mut lib_dspeak_media_device_t,
    ) -> *mut c_char;

    pub fn lib_dspeak_media_create_send_transport(
        device: *mut lib_dspeak_media_device_t,
        id: *const c_char,
        ice_parameters_json: *const c_char,
        ice_candidates_json: *const c_char,
        dtls_parameters_json: *const c_char,
        app_data_json: *const c_char,
        error_out: *mut c_int,
    ) -> *mut lib_dspeak_media_send_transport_t;
    pub fn lib_dspeak_media_destroy_send_transport(
        transport: *mut lib_dspeak_media_send_transport_t,
    );

    pub fn lib_dspeak_media_create_recv_transport(
        device: *mut lib_dspeak_media_device_t,
        id: *const c_char,
        ice_parameters_json: *const c_char,
        ice_candidates_json: *const c_char,
        dtls_parameters_json: *const c_char,
        app_data_json: *const c_char,
        error_out: *mut c_int,
    ) -> *mut lib_dspeak_media_recv_transport_t;
    pub fn lib_dspeak_media_destroy_recv_transport(
        transport: *mut lib_dspeak_media_recv_transport_t,
    );

    pub fn lib_dspeak_media_poll_action() -> lib_dspeak_media_action_t;
    pub fn lib_dspeak_media_poll_receive_event() -> lib_dspeak_media_receive_event_t;
    pub fn lib_dspeak_media_free_receive_event(event: *mut lib_dspeak_media_receive_event_t);
    pub fn lib_dspeak_media_complete_connect(transport_ptr: *mut c_void);
    pub fn lib_dspeak_media_fail_connect(transport_ptr: *mut c_void, error_message: *const c_char);
    pub fn lib_dspeak_media_complete_produce(action_id: u64, producer_id: *const c_char);
    pub fn lib_dspeak_media_fail_produce(action_id: u64, error_message: *const c_char);

    pub fn lib_dspeak_media_consume(
        transport: *mut lib_dspeak_media_recv_transport_t,
        id: *const c_char,
        producer_id: *const c_char,
        kind: *const c_char,
        rtp_parameters_json: *const c_char,
        app_data_json: *const c_char,
        error_out: *mut c_int,
    ) -> *mut lib_dspeak_media_consumer_t;
    pub fn lib_dspeak_media_destroy_producer(producer: *mut lib_dspeak_media_producer_t);
    pub fn lib_dspeak_media_destroy_consumer(consumer: *mut lib_dspeak_media_consumer_t);
    pub fn lib_dspeak_media_consumer_set_enabled(
        consumer: *mut lib_dspeak_media_consumer_t,
        enabled: bool,
    ) -> c_int;
    pub fn lib_dspeak_media_consumer_set_volume(
        consumer: *mut lib_dspeak_media_consumer_t,
        volume: f64,
    ) -> c_int;
    pub fn lib_dspeak_media_producer_get_id(
        producer: *mut lib_dspeak_media_producer_t,
    ) -> *mut c_char;
    pub fn lib_dspeak_media_consumer_get_id(
        consumer: *mut lib_dspeak_media_consumer_t,
    ) -> *mut c_char;
    pub fn lib_dspeak_media_consumer_get_producer_id(
        consumer: *mut lib_dspeak_media_consumer_t,
    ) -> *mut c_char;
    pub fn lib_dspeak_media_consumer_get_kind(
        consumer: *mut lib_dspeak_media_consumer_t,
    ) -> *mut c_char;

    pub fn lib_dspeak_media_create_video_track(
        track_id: *const c_char,
        error_out: *mut c_int,
    ) -> *mut c_void;
    pub fn lib_dspeak_media_create_audio_track(
        track_id: *const c_char,
        error_out: *mut c_int,
    ) -> *mut c_void;
    pub fn lib_dspeak_media_get_active_video_track() -> *mut lib_dspeak_media_video_track_t;
    pub fn lib_dspeak_media_get_active_audio_track() -> *mut lib_dspeak_media_audio_track_t;
    pub fn lib_dspeak_media_get_video_track(
        source: *const c_char,
    ) -> *mut lib_dspeak_media_video_track_t;
    pub fn lib_dspeak_media_get_audio_track(
        source: *const c_char,
    ) -> *mut lib_dspeak_media_audio_track_t;
    pub fn lib_dspeak_media_destroy_video_track(track: *mut c_void);
    pub fn lib_dspeak_media_destroy_audio_track(track: *mut c_void);
    pub fn lib_dspeak_media_video_track_get_id(track: *mut c_void) -> *mut c_char;
    pub fn lib_dspeak_media_audio_track_get_id(track: *mut c_void) -> *mut c_char;

    pub fn lib_dspeak_media_produce_video_track(
        transport: *mut lib_dspeak_media_send_transport_t,
        track: *mut c_void,
        app_data_json: *const c_char,
        error_out: *mut c_int,
    ) -> *mut lib_dspeak_media_producer_t;
    pub fn lib_dspeak_media_produce_audio_track(
        transport: *mut lib_dspeak_media_send_transport_t,
        track: *mut c_void,
        app_data_json: *const c_char,
        error_out: *mut c_int,
    ) -> *mut lib_dspeak_media_producer_t;

    pub fn lib_dspeak_media_p2p_add_video_track(handle: *mut c_void, track: *mut c_void) -> c_int;
    pub fn lib_dspeak_media_p2p_add_audio_track(handle: *mut c_void, track: *mut c_void) -> c_int;
    pub fn lib_dspeak_media_p2p_remove_video_track(
        handle: *mut c_void,
        track: *mut c_void,
    ) -> c_int;
    pub fn lib_dspeak_media_p2p_remove_audio_track(
        handle: *mut c_void,
        track: *mut c_void,
    ) -> c_int;

    pub fn lib_dspeak_media_p2p_create() -> *mut lib_dspeak_media_p2p_handle_t;
    pub fn lib_dspeak_media_p2p_destroy(handle: *mut lib_dspeak_media_p2p_handle_t);
    pub fn lib_dspeak_media_p2p_create_offer(
        handle: *mut lib_dspeak_media_p2p_handle_t,
        sdp_out: *mut *mut c_char,
    ) -> c_int;
    pub fn lib_dspeak_media_p2p_create_answer(
        handle: *mut lib_dspeak_media_p2p_handle_t,
        remote_sdp: *const c_char,
        sdp_out: *mut *mut c_char,
    ) -> c_int;
    pub fn lib_dspeak_media_p2p_set_remote_description(
        handle: *mut lib_dspeak_media_p2p_handle_t,
        sdp: *const c_char,
    ) -> c_int;
    pub fn lib_dspeak_media_p2p_add_ice_candidate(
        handle: *mut lib_dspeak_media_p2p_handle_t,
        candidate: *const c_char,
    ) -> c_int;
    pub fn lib_dspeak_media_p2p_poll_ice_candidate(
        handle: *mut lib_dspeak_media_p2p_handle_t,
    ) -> *mut c_char;
    pub fn lib_dspeak_media_p2p_ice_connection_state(
        handle: *mut lib_dspeak_media_p2p_handle_t,
    ) -> c_int;
    pub fn lib_dspeak_media_p2p_restart_ice(
        handle: *mut lib_dspeak_media_p2p_handle_t,
        sdp_out: *mut *mut c_char,
    ) -> c_int;
}
