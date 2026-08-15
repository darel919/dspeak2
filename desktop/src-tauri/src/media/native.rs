use super::ffi;

use std::ffi::{CStr, CString};
use std::ptr;

pub fn create_device(
    router_rtp_capabilities: &str,
) -> Result<*mut ffi::lib_dspeak_media_device_t, String> {
    let caps = CString::new(router_rtp_capabilities).map_err(|e| e.to_string())?;
    let mut error: i32 = 0;
    let device = unsafe { ffi::lib_dspeak_media_create_device(caps.as_ptr(), &mut error) };
    if device.is_null() {
        Err(format!(
            "lib_dspeak_media_create_device failed (error {})",
            error
        ))
    } else {
        Ok(device)
    }
}

pub fn device_rtp_capabilities(
    device: *mut ffi::lib_dspeak_media_device_t,
) -> Result<String, String> {
    let pointer = unsafe { ffi::lib_dspeak_media_device_get_rtp_capabilities(device) };
    if pointer.is_null() {
        return Err("native device RTP capabilities are unavailable".to_string());
    }
    let value = unsafe { CStr::from_ptr(pointer) }
        .to_str()
        .map(str::to_owned)
        .map_err(|_| "native device RTP capabilities are not UTF-8".to_string());
    unsafe { ffi::lib_dspeak_media_free_string(pointer) };
    value
}

pub fn produce_capture(
    transport: *mut ffi::lib_dspeak_media_send_transport_t,
    kind: &str,
    source: &str,
    app_data: &str,
) -> Result<*mut ffi::lib_dspeak_media_producer_t, String> {
    let app_data = CString::new(app_data).map_err(|error| error.to_string())?;
    let source = CString::new(source).map_err(|error| error.to_string())?;
    let mut error = 0;
    let producer = unsafe {
        if kind == "video" {
            ffi::lib_dspeak_media_produce_video_track(
                transport,
                ffi::lib_dspeak_media_get_video_track(source.as_ptr()),
                app_data.as_ptr(),
                &mut error,
            )
        } else if kind == "audio" {
            ffi::lib_dspeak_media_produce_audio_track(
                transport,
                ffi::lib_dspeak_media_get_audio_track(source.as_ptr()),
                app_data.as_ptr(),
                &mut error,
            )
        } else {
            return Err("native capture producer kind is invalid".to_string());
        }
    };
    if producer.is_null() {
        Err(format!(
            "native {} producer creation failed (error {})",
            kind, error
        ))
    } else {
        Ok(producer)
    }
}

pub fn producer_set_paused(
    producer: *mut ffi::lib_dspeak_media_producer_t,
    paused: bool,
) -> Result<(), String> {
    let result = unsafe { ffi::lib_dspeak_media_producer_set_paused(producer, paused) };
    if result == 0 {
        Ok(())
    } else {
        Err("native producer pause state update failed".to_string())
    }
}

pub fn producer_set_parameters(
    producer: *mut ffi::lib_dspeak_media_producer_t,
    parameters: &str,
) -> Result<(), String> {
    let parameters = CString::new(parameters).map_err(|error| error.to_string())?;
    let result =
        unsafe { ffi::lib_dspeak_media_producer_set_parameters(producer, parameters.as_ptr()) };
    if result == 0 {
        Ok(())
    } else {
        Err("native producer RTP parameters update failed".to_string())
    }
}

pub fn consume(
    transport: *mut ffi::lib_dspeak_media_recv_transport_t,
    id: &str,
    producer_id: &str,
    kind: &str,
    rtp_parameters_json: &str,
    app_data_json: &str,
) -> Result<*mut ffi::lib_dspeak_media_consumer_t, String> {
    let c_id = CString::new(id).map_err(|error| error.to_string())?;
    let c_producer_id = CString::new(producer_id).map_err(|error| error.to_string())?;
    let c_kind = CString::new(kind).map_err(|error| error.to_string())?;
    let c_rtp = CString::new(rtp_parameters_json).map_err(|error| error.to_string())?;
    let c_app_data = CString::new(app_data_json).map_err(|error| error.to_string())?;
    let mut error = 0;
    let consumer = unsafe {
        ffi::lib_dspeak_media_consume(
            transport,
            c_id.as_ptr(),
            c_producer_id.as_ptr(),
            c_kind.as_ptr(),
            c_rtp.as_ptr(),
            c_app_data.as_ptr(),
            &mut error,
        )
    };
    if consumer.is_null() {
        Err(format!("lib_dspeak_media_consume failed (error {})", error))
    } else {
        Ok(consumer)
    }
}

pub fn p2p_set_track_parameters(
    handle: *mut ffi::lib_dspeak_media_p2p_handle_t,
    track_id: &str,
    parameters: &str,
) -> Result<(), String> {
    let track_id = CString::new(track_id).map_err(|error| error.to_string())?;
    let parameters = CString::new(parameters).map_err(|error| error.to_string())?;
    let result = unsafe {
        ffi::lib_dspeak_media_p2p_set_track_parameters(
            handle,
            track_id.as_ptr(),
            parameters.as_ptr(),
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err("native P2P sender RTP parameters update failed".to_string())
    }
}

pub fn p2p_set_track_parameters_with_key(
    handle: *mut ffi::lib_dspeak_media_p2p_handle_t,
    track_key: &str,
    parameters: &str,
) -> Result<(), String> {
    let track_key = CString::new(track_key).map_err(|error| error.to_string())?;
    let parameters = CString::new(parameters).map_err(|error| error.to_string())?;
    let result = unsafe {
        ffi::lib_dspeak_media_p2p_set_track_parameters_with_key(
            handle,
            track_key.as_ptr(),
            parameters.as_ptr(),
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err("native P2P sender RTP parameters update failed".to_string())
    }
}

pub fn p2p_replace_video_track(
    handle: *mut ffi::lib_dspeak_media_p2p_handle_t,
    old_track: *mut std::ffi::c_void,
    new_track: *mut std::ffi::c_void,
) -> Result<(), String> {
    let result =
        unsafe { ffi::lib_dspeak_media_p2p_replace_video_track(handle, old_track, new_track) };
    if result == 0 {
        Ok(())
    } else {
        Err("native P2P video track replacement failed".to_string())
    }
}

pub fn p2p_replace_video_track_with_key(
    handle: *mut ffi::lib_dspeak_media_p2p_handle_t,
    old_track: *mut std::ffi::c_void,
    new_track: *mut std::ffi::c_void,
    track_key: &str,
) -> Result<(), String> {
    let track_key = CString::new(track_key).map_err(|error| error.to_string())?;
    let result = unsafe {
        ffi::lib_dspeak_media_p2p_replace_video_track_with_key(
            handle,
            old_track,
            new_track,
            track_key.as_ptr(),
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err("native P2P video track replacement failed".to_string())
    }
}

pub fn p2p_replace_audio_track(
    handle: *mut ffi::lib_dspeak_media_p2p_handle_t,
    old_track: *mut std::ffi::c_void,
    new_track: *mut std::ffi::c_void,
) -> Result<(), String> {
    let result =
        unsafe { ffi::lib_dspeak_media_p2p_replace_audio_track(handle, old_track, new_track) };
    if result == 0 {
        Ok(())
    } else {
        Err("native P2P audio track replacement failed".to_string())
    }
}

pub fn p2p_replace_audio_track_with_key(
    handle: *mut ffi::lib_dspeak_media_p2p_handle_t,
    old_track: *mut std::ffi::c_void,
    new_track: *mut std::ffi::c_void,
    track_key: &str,
) -> Result<(), String> {
    let track_key = CString::new(track_key).map_err(|error| error.to_string())?;
    let result = unsafe {
        ffi::lib_dspeak_media_p2p_replace_audio_track_with_key(
            handle,
            old_track,
            new_track,
            track_key.as_ptr(),
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err("native P2P audio track replacement failed".to_string())
    }
}

pub fn p2p_set_receive_enabled(
    handle: *mut ffi::lib_dspeak_media_p2p_handle_t,
    track_id: &str,
    enabled: bool,
) -> Result<(), String> {
    let track_id = CString::new(track_id).map_err(|error| error.to_string())?;
    let result = unsafe {
        ffi::lib_dspeak_media_p2p_set_receive_enabled(handle, track_id.as_ptr(), enabled)
    };
    if result == 0 {
        Ok(())
    } else {
        Err("native P2P receive state update failed".to_string())
    }
}

pub fn p2p_set_receive_volume(
    handle: *mut ffi::lib_dspeak_media_p2p_handle_t,
    track_id: &str,
    volume: f64,
) -> Result<(), String> {
    let track_id = CString::new(track_id).map_err(|error| error.to_string())?;
    let result =
        unsafe { ffi::lib_dspeak_media_p2p_set_receive_volume(handle, track_id.as_ptr(), volume) };
    if result == 0 {
        Ok(())
    } else {
        Err("native P2P receive volume update failed".to_string())
    }
}

pub fn p2p_set_jitter_buffer(
    handle: *mut ffi::lib_dspeak_media_p2p_handle_t,
    track_id: &str,
    min_delay_ms: i32,
    target_delay_ms: i32,
) -> Result<(), String> {
    let track_id = CString::new(track_id).map_err(|error| error.to_string())?;
    let result = unsafe {
        ffi::lib_dspeak_media_p2p_set_jitter_buffer(
            handle,
            track_id.as_ptr(),
            min_delay_ms,
            target_delay_ms,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err("native P2P jitter buffer configuration failed".to_string())
    }
}

pub fn p2p_send_health(
    handle: *mut ffi::lib_dspeak_media_p2p_handle_t,
    message: &str,
) -> Result<(), String> {
    let message = CString::new(message).map_err(|error| error.to_string())?;
    let result = unsafe { ffi::lib_dspeak_media_p2p_send_health(handle, message.as_ptr()) };
    if result == 0 {
        Ok(())
    } else {
        Err("native P2P health message could not be sent".to_string())
    }
}

fn native_string(pointer: *mut std::ffi::c_char, label: &str) -> Result<String, String> {
    if pointer.is_null() {
        return Err(format!("native {} is unavailable", label));
    }
    let value = unsafe { CStr::from_ptr(pointer) }
        .to_str()
        .map(str::to_owned)
        .map_err(|_| format!("native {} is not UTF-8", label));
    unsafe { ffi::lib_dspeak_media_free_string(pointer) };
    value
}

pub fn consumer_metadata(
    consumer: *mut ffi::lib_dspeak_media_consumer_t,
) -> Result<(String, String, String), String> {
    let id = native_string(
        unsafe { ffi::lib_dspeak_media_consumer_get_id(consumer) },
        "consumer id",
    )?;
    let producer_id = native_string(
        unsafe { ffi::lib_dspeak_media_consumer_get_producer_id(consumer) },
        "consumer producer id",
    )?;
    let kind = native_string(
        unsafe { ffi::lib_dspeak_media_consumer_get_kind(consumer) },
        "consumer kind",
    )?;
    Ok((id, producer_id, kind))
}

pub fn create_send_transport(
    device: *mut ffi::lib_dspeak_media_device_t,
    id: &str,
    ice_parameters_json: &str,
    ice_candidates_json: &str,
    dtls_parameters_json: &str,
    app_data_json: Option<&str>,
) -> Result<*mut ffi::lib_dspeak_media_send_transport_t, String> {
    let c_id = CString::new(id).map_err(|e| e.to_string())?;
    let c_ice_params = CString::new(ice_parameters_json).map_err(|e| e.to_string())?;
    let c_ice_cands = CString::new(ice_candidates_json).map_err(|e| e.to_string())?;
    let c_dtls_params = CString::new(dtls_parameters_json).map_err(|e| e.to_string())?;
    let c_app_data = app_data_json
        .map(CString::new)
        .transpose()
        .map_err(|e| e.to_string())?;
    let mut error: i32 = 0;
    let transport = unsafe {
        ffi::lib_dspeak_media_create_send_transport(
            device,
            c_id.as_ptr(),
            c_ice_params.as_ptr(),
            c_ice_cands.as_ptr(),
            c_dtls_params.as_ptr(),
            c_app_data.as_ref().map_or(ptr::null(), |c| c.as_ptr()),
            &mut error,
        )
    };
    if transport.is_null() {
        Err(format!(
            "lib_dspeak_media_create_send_transport failed (error {})",
            error
        ))
    } else {
        Ok(transport)
    }
}

pub fn create_recv_transport(
    device: *mut ffi::lib_dspeak_media_device_t,
    id: &str,
    ice_parameters_json: &str,
    ice_candidates_json: &str,
    dtls_parameters_json: &str,
    app_data_json: Option<&str>,
) -> Result<*mut ffi::lib_dspeak_media_recv_transport_t, String> {
    let c_id = CString::new(id).map_err(|e| e.to_string())?;
    let c_ice_params = CString::new(ice_parameters_json).map_err(|e| e.to_string())?;
    let c_ice_cands = CString::new(ice_candidates_json).map_err(|e| e.to_string())?;
    let c_dtls_params = CString::new(dtls_parameters_json).map_err(|e| e.to_string())?;
    let c_app_data = app_data_json
        .map(CString::new)
        .transpose()
        .map_err(|e| e.to_string())?;
    let mut error: i32 = 0;
    let transport = unsafe {
        ffi::lib_dspeak_media_create_recv_transport(
            device,
            c_id.as_ptr(),
            c_ice_params.as_ptr(),
            c_ice_cands.as_ptr(),
            c_dtls_params.as_ptr(),
            c_app_data.as_ref().map_or(ptr::null(), |c| c.as_ptr()),
            &mut error,
        )
    };
    if transport.is_null() {
        Err(format!(
            "lib_dspeak_media_create_recv_transport failed (error {})",
            error
        ))
    } else {
        Ok(transport)
    }
}

pub fn complete_connect(transport_ptr: *mut std::ffi::c_void) {
    unsafe { ffi::lib_dspeak_media_complete_connect(transport_ptr) }
}

pub fn fail_connect(transport_ptr: *mut std::ffi::c_void, error: &str) {
    let c_err = CString::new(error).unwrap_or_default();
    unsafe { ffi::lib_dspeak_media_fail_connect(transport_ptr, c_err.as_ptr()) }
}

pub fn complete_produce(action_id: u64, producer_id: &str) {
    let c_id = CString::new(producer_id).unwrap_or_default();
    unsafe { ffi::lib_dspeak_media_complete_produce(action_id, c_id.as_ptr()) }
}

pub fn fail_produce(action_id: u64, error: &str) {
    let c_err = CString::new(error).unwrap_or_default();
    unsafe { ffi::lib_dspeak_media_fail_produce(action_id, c_err.as_ptr()) }
}

pub fn p2p_create(
    ice_servers_json: &str,
    offerer: bool,
) -> Result<*mut ffi::lib_dspeak_media_p2p_handle_t, String> {
    let ice_servers = CString::new(ice_servers_json).map_err(|error| error.to_string())?;
    let handle = unsafe { ffi::lib_dspeak_media_p2p_create(ice_servers.as_ptr(), offerer, 0) };
    if handle.is_null() {
        Err("native P2P PeerConnection creation failed".to_string())
    } else {
        Ok(handle)
    }
}

pub fn p2p_destroy(handle: *mut ffi::lib_dspeak_media_p2p_handle_t) {
    if !handle.is_null() {
        unsafe { ffi::lib_dspeak_media_p2p_destroy(handle) };
    }
}

fn p2p_sdp_result(
    handle: *mut ffi::lib_dspeak_media_p2p_handle_t,
    result: i32,
    pointer: *mut std::ffi::c_char,
    operation: &str,
) -> Result<String, String> {
    if result != 0 || pointer.is_null() {
        if !pointer.is_null() {
            unsafe { ffi::lib_dspeak_media_free_string(pointer) };
        }
        let native_error = unsafe { ffi::lib_dspeak_media_p2p_last_error(handle) };
        let native_error = if native_error.is_null() {
            "unknown native SDP error".to_string()
        } else {
            unsafe { CStr::from_ptr(native_error) }
                .to_string_lossy()
                .into_owned()
        };
        return Err(format!("native P2P {operation} failed: {native_error}"));
    }
    let value = unsafe { CStr::from_ptr(pointer) }
        .to_str()
        .map(str::to_owned)
        .map_err(|_| format!("native P2P {operation} returned invalid UTF-8"));
    unsafe { ffi::lib_dspeak_media_free_string(pointer) };
    value
}

pub fn p2p_create_offer(handle: *mut ffi::lib_dspeak_media_p2p_handle_t) -> Result<String, String> {
    let mut pointer = ptr::null_mut();
    let result = unsafe { ffi::lib_dspeak_media_p2p_create_offer(handle, &mut pointer) };
    p2p_sdp_result(handle, result, pointer, "offer")
}

pub fn p2p_create_answer(
    handle: *mut ffi::lib_dspeak_media_p2p_handle_t,
    remote_sdp: &str,
) -> Result<String, String> {
    let remote_sdp = CString::new(remote_sdp).map_err(|error| error.to_string())?;
    let mut pointer = ptr::null_mut();
    let result = unsafe {
        ffi::lib_dspeak_media_p2p_create_answer(handle, remote_sdp.as_ptr(), &mut pointer)
    };
    p2p_sdp_result(handle, result, pointer, "answer")
}

pub fn p2p_set_remote_description(
    handle: *mut ffi::lib_dspeak_media_p2p_handle_t,
    sdp: &str,
    sdp_type: &str,
) -> Result<(), String> {
    let description_type = sdp_type;
    let sdp = CString::new(sdp).map_err(|error| error.to_string())?;
    let sdp_type = CString::new(sdp_type).map_err(|error| error.to_string())?;
    let result = unsafe {
        ffi::lib_dspeak_media_p2p_set_remote_description(handle, sdp_type.as_ptr(), sdp.as_ptr())
    };
    if result == 0 {
        Ok(())
    } else {
        let native_error = unsafe { ffi::lib_dspeak_media_p2p_last_error(handle) };
        let native_error = if native_error.is_null() {
            "native remote description failed".to_string()
        } else {
            unsafe { CStr::from_ptr(native_error) }
                .to_string_lossy()
                .into_owned()
        };
        Err(format!(
            "native P2P {description_type} remote description failed: {native_error}"
        ))
    }
}

pub fn p2p_rollback_local_description(
    handle: *mut ffi::lib_dspeak_media_p2p_handle_t,
) -> Result<(), String> {
    let result = unsafe { ffi::lib_dspeak_media_p2p_rollback_local_description(handle) };
    if result == 0 {
        Ok(())
    } else {
        let native_error = unsafe { ffi::lib_dspeak_media_p2p_last_error(handle) };
        let native_error = if native_error.is_null() {
            "native local rollback failed".to_string()
        } else {
            unsafe { CStr::from_ptr(native_error) }
                .to_string_lossy()
                .into_owned()
        };
        Err(format!(
            "native P2P local description rollback failed: {native_error}"
        ))
    }
}

pub fn p2p_add_ice_candidate(
    handle: *mut ffi::lib_dspeak_media_p2p_handle_t,
    candidate: &str,
) -> Result<(), String> {
    let candidate = CString::new(candidate).map_err(|error| error.to_string())?;
    let result = unsafe { ffi::lib_dspeak_media_p2p_add_ice_candidate(handle, candidate.as_ptr()) };
    if result == 0 {
        Ok(())
    } else {
        Err("native P2P ICE candidate failed".to_string())
    }
}

pub fn p2p_ice_state(handle: *mut ffi::lib_dspeak_media_p2p_handle_t) -> i32 {
    unsafe { ffi::lib_dspeak_media_p2p_ice_connection_state(handle) }
}

pub fn p2p_restart_ice(handle: *mut ffi::lib_dspeak_media_p2p_handle_t) -> Result<String, String> {
    let mut pointer = ptr::null_mut();
    let result = unsafe { ffi::lib_dspeak_media_p2p_restart_ice(handle, &mut pointer) };
    p2p_sdp_result(handle, result, pointer, "ICE restart")
}

pub fn p2p_get_stats(handle: *mut ffi::lib_dspeak_media_p2p_handle_t) -> Result<String, String> {
    let pointer = unsafe { ffi::lib_dspeak_media_p2p_get_stats(handle) };
    native_string(pointer, "P2P stats")
}

pub fn send_transport_restart_ice(
    transport: *mut ffi::lib_dspeak_media_send_transport_t,
    ice_parameters: &serde_json::Value,
) -> Result<(), String> {
    let ice_parameters = CString::new(ice_parameters.to_string()).map_err(|e| e.to_string())?;
    let result = unsafe {
        ffi::lib_dspeak_media_send_transport_restart_ice(transport, ice_parameters.as_ptr())
    };
    if result == 0 {
        Ok(())
    } else {
        Err("native send transport ICE restart failed".to_string())
    }
}

pub fn recv_transport_restart_ice(
    transport: *mut ffi::lib_dspeak_media_recv_transport_t,
    ice_parameters: &serde_json::Value,
) -> Result<(), String> {
    let ice_parameters = CString::new(ice_parameters.to_string()).map_err(|e| e.to_string())?;
    let result = unsafe {
        ffi::lib_dspeak_media_recv_transport_restart_ice(transport, ice_parameters.as_ptr())
    };
    if result == 0 {
        Ok(())
    } else {
        Err("native recv transport ICE restart failed".to_string())
    }
}

/* ── Stats collection ────────────────────────────────── */

pub fn send_transport_get_stats(
    transport: *mut ffi::lib_dspeak_media_send_transport_t,
) -> Result<String, String> {
    let pointer = unsafe { ffi::lib_dspeak_media_send_transport_get_stats(transport) };
    native_string(pointer, "send transport stats")
}

pub fn recv_transport_get_stats(
    transport: *mut ffi::lib_dspeak_media_recv_transport_t,
) -> Result<String, String> {
    let pointer = unsafe { ffi::lib_dspeak_media_recv_transport_get_stats(transport) };
    native_string(pointer, "recv transport stats")
}

pub fn producer_get_stats(
    producer: *mut ffi::lib_dspeak_media_producer_t,
) -> Result<String, String> {
    let pointer = unsafe { ffi::lib_dspeak_media_producer_get_stats(producer) };
    native_string(pointer, "producer stats")
}

pub fn consumer_get_stats(
    consumer: *mut ffi::lib_dspeak_media_consumer_t,
) -> Result<String, String> {
    let pointer = unsafe { ffi::lib_dspeak_media_consumer_get_stats(consumer) };
    native_string(pointer, "consumer stats")
}

/* ── Producer replaceTrack ───────────────────────────── */

pub fn producer_replace_video_track(
    producer: *mut ffi::lib_dspeak_media_producer_t,
    track: *mut ffi::lib_dspeak_media_video_track_t,
) -> Result<(), String> {
    let mut error = 0;
    let result =
        unsafe { ffi::lib_dspeak_media_producer_replace_video_track(producer, track, &mut error) };
    if result == 0 {
        Ok(())
    } else {
        Err(format!(
            "native producer video track replacement failed (error {error})"
        ))
    }
}

pub fn producer_replace_audio_track(
    producer: *mut ffi::lib_dspeak_media_producer_t,
    track: *mut ffi::lib_dspeak_media_audio_track_t,
) -> Result<(), String> {
    let mut error = 0;
    let result =
        unsafe { ffi::lib_dspeak_media_producer_replace_audio_track(producer, track, &mut error) };
    if result == 0 {
        Ok(())
    } else {
        Err(format!(
            "native producer audio track replacement failed (error {error})"
        ))
    }
}

/* ── Jitter buffer configuration ─────────────────────── */

pub fn consumer_set_jitter_buffer(
    consumer: *mut ffi::lib_dspeak_media_consumer_t,
    min_delay_ms: i32,
    target_delay_ms: i32,
) -> Result<(), String> {
    let result = unsafe {
        ffi::lib_dspeak_media_consumer_set_jitter_buffer(consumer, min_delay_ms, target_delay_ms)
    };
    if result == 0 {
        Ok(())
    } else {
        Err("native consumer jitter buffer configuration failed".to_string())
    }
}
