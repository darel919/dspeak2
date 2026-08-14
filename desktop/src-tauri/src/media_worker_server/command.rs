use super::state::WorkerState;
use super::{capture, core, p2p, sfu, DispatchResult, WorkerResult};
use serde_json::{json, Value};
use std::io::{self, BufWriter};
use std::sync::{Arc, Mutex};

pub(super) fn dispatch(
    state: &mut WorkerState,
    command: &str,
    payload: Value,
    event_output: Arc<Mutex<BufWriter<io::Stderr>>>,
) -> DispatchResult {
    if command == "media_initialize" {
        return core::initialize(state, event_output);
    }
    if command == "media_shutdown" {
        let result = state
            .ensure_initialized()
            .and_then(|_| core::state_value(state));
        return DispatchResult {
            result,
            shutdown_after: true,
        };
    }
    if command == "media_join" {
        return core::join(state, payload, event_output);
    }
    if command == "media_leave" {
        return DispatchResult {
            result: core::leave(state),
            shutdown_after: false,
        };
    }
    if command == "media_get_devices" {
        return DispatchResult {
            result: state
                .ensure_initialized()
                .and_then(|_| capture::capture_devices()),
            shutdown_after: false,
        };
    }
    if command == "media_prepare_devices" {
        return core::prepare_devices(state);
    }
    if command == "media_prepare_capture" {
        return core::prepare_capture(state);
    }
    let result: WorkerResult = match command {
        "media_get_capabilities" => state.ensure_initialized().and_then(|_| sfu::capabilities()),
        "media_list_capture_sources" => capture::list_capture_sources(state),
        "media_select_capture_source" => capture::select_capture_source(state, payload),
        "media_get_permissions" => capture::get_permissions(state, payload),
        "media_set_topology" => core::set_topology(state, payload),
        "media_set_ice_servers" => core::set_ice_servers(state, payload),
        "media_handle_signal" => core::ready(state),
        "media_close_sfu" => core::close_sfu(state),
        "media_create_device" => sfu::create_device(state, payload),
        "media_create_send_transport" => sfu::create_send_transport(state, payload),
        "media_create_recv_transport" => sfu::create_recv_transport(state, payload),
        "media_consume" => sfu::consume(state, payload),
        "media_set_consumer_enabled" => sfu::set_consumer_enabled(state, payload),
        "media_set_consumer_volume" => sfu::set_consumer_volume(state, payload),
        "media_close_consumer" => sfu::close_consumer(state, payload),
        "media_create_capture_producer" => sfu::create_capture_producer(state, payload),
        "media_set_producer_paused" => sfu::set_producer_paused(state, payload),
        "media_set_producer_parameters" => sfu::set_producer_parameters(state, payload),
        "media_remove_capture_producer" => sfu::remove_capture_producer(state, payload),
        "media_p2p_create" => p2p::p2p_create(state, payload),
        "media_p2p_destroy" => p2p::p2p_destroy(state, payload),
        "media_p2p_create_offer" => p2p::p2p_create_offer(state, payload),
        "media_p2p_create_answer" => p2p::p2p_create_answer(state, payload),
        "media_p2p_set_remote_description" => p2p::p2p_set_remote_description(state, payload),
        "media_p2p_rollback_local_description" => {
            p2p::p2p_rollback_local_description(state, payload)
        }
        "media_p2p_add_ice_candidate" => p2p::p2p_add_ice_candidate(state, payload),
        "media_p2p_ice_state" => p2p::p2p_ice_state(state, payload),
        "media_p2p_restart_ice" => p2p::p2p_restart_ice(state, payload),
        "media_p2p_add_track" => p2p::p2p_add_track(state, payload),
        "media_p2p_remove_track" => p2p::p2p_remove_track(state, payload),
        "media_p2p_replace_track" => p2p::p2p_replace_track(state, payload),
        "media_p2p_set_track_parameters" => p2p::p2p_set_track_parameters(state, payload),
        "media_p2p_set_audio_stereo" => p2p::p2p_set_audio_stereo(state, payload),
        "media_p2p_set_receive_enabled" => p2p::p2p_set_receive_enabled(state, payload),
        "media_p2p_set_receive_volume" => p2p::p2p_set_receive_volume(state, payload),
        "media_p2p_set_jitter_buffer" => p2p::p2p_set_jitter_buffer(state, payload),
        "media_p2p_send_health" => p2p::p2p_send_health(state, payload),
        "media_p2p_get_stats" => p2p::p2p_get_stats(state, payload),
        "media_complete_connect" => p2p::complete_connect(state, payload),
        "media_fail_connect" => p2p::fail_connect(state, payload),
        "media_complete_produce" => p2p::complete_produce(state, payload),
        "media_fail_produce" => p2p::fail_produce(state, payload),
        "media_set_microphone" => capture::set_microphone(state, payload),
        "media_set_microphone_device" => capture::set_microphone_device(state, payload),
        "media_set_camera_device" => capture::set_camera_device(state, payload),
        "media_set_output_device" => capture::set_output_device(state, payload),
        "media_set_local_video_preview" => capture::set_local_video_preview(state, payload),
        "media_set_shared_audio_volume" => capture::set_shared_audio_volume(state, payload),
        "media_set_shared_audio_attenuation" => {
            capture::set_shared_audio_attenuation(state, payload)
        }
        "media_get_audio_levels" => capture::get_audio_levels(state),
        "media_start_microphone_check" => capture::start_microphone_check(state),
        "media_stop_microphone_check" => capture::stop_microphone_check(state),
        "media_set_camera" => capture::set_camera(state, payload),
        "media_start_screen_share" => capture::start_screen_share(state, payload),
        "media_replace_screen_share" => capture::replace_screen_share(state, payload),
        "media_stop_screen_share" => capture::stop_screen_share(state),
        "media_start_system_audio" => capture::start_system_audio(state, payload),
        "media_replace_system_audio" => capture::replace_system_audio(state, payload),
        "media_stop_system_audio" => capture::stop_system_audio(state),
        "media_restart_send_transport_ice" => sfu::restart_send_transport_ice(state, payload),
        "media_restart_recv_transport_ice" => sfu::restart_recv_transport_ice(state, payload),
        "media_get_transport_stats" => sfu::get_transport_stats(state, payload),
        "media_get_producer_stats" => sfu::get_producer_stats(state, payload),
        "media_get_consumer_stats" => sfu::get_consumer_stats(state, payload),
        "media_replace_producer_track" => sfu::replace_producer_track(state, payload),
        "media_set_consumer_jitter_buffer" => sfu::set_consumer_jitter_buffer(state, payload),
        "media_get_stats" => sfu::get_stats(state),
        _ => Err(json!(format!(
            "native media worker command is unsupported: {command}"
        ))),
    };
    DispatchResult {
        result,
        shutdown_after: false,
    }
}
