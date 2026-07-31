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
    app_data: &str,
) -> Result<*mut ffi::lib_dspeak_media_producer_t, String> {
    let app_data = CString::new(app_data).map_err(|error| error.to_string())?;
    let mut error = 0;
    let producer = unsafe {
        if kind == "video" {
            ffi::lib_dspeak_media_produce_video_track(
                transport,
                ffi::lib_dspeak_media_get_active_video_track(),
                app_data.as_ptr(),
                &mut error,
            )
        } else if kind == "audio" {
            ffi::lib_dspeak_media_produce_audio_track(
                transport,
                ffi::lib_dspeak_media_get_active_audio_track(),
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
        Err(format!(
            "lib_dspeak_media_consume failed (error {})",
            error
        ))
    } else {
        Ok(consumer)
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
        .map(|s| CString::new(s))
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
        .map(|s| CString::new(s))
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

pub fn poll_action() -> ffi::lib_dspeak_media_action_t {
    unsafe { ffi::lib_dspeak_media_poll_action() }
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

pub fn p2p_create() -> Result<*mut ffi::lib_dspeak_media_p2p_handle_t, String> {
    let handle = unsafe { ffi::lib_dspeak_media_p2p_create() };
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
    result: i32,
    pointer: *mut std::ffi::c_char,
    operation: &str,
) -> Result<String, String> {
    if result != 0 || pointer.is_null() {
        if !pointer.is_null() {
            unsafe { ffi::lib_dspeak_media_free_string(pointer) };
        }
        return Err(format!("native P2P {operation} failed"));
    }
    let value = unsafe { CStr::from_ptr(pointer) }
        .to_str()
        .map(str::to_owned)
        .map_err(|_| format!("native P2P {operation} returned invalid UTF-8"));
    unsafe { ffi::lib_dspeak_media_free_string(pointer) };
    value
}

pub fn p2p_create_offer(
    handle: *mut ffi::lib_dspeak_media_p2p_handle_t,
) -> Result<String, String> {
    let mut pointer = ptr::null_mut();
    let result = unsafe { ffi::lib_dspeak_media_p2p_create_offer(handle, &mut pointer) };
    p2p_sdp_result(result, pointer, "offer")
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
    p2p_sdp_result(result, pointer, "answer")
}

pub fn p2p_set_remote_description(
    handle: *mut ffi::lib_dspeak_media_p2p_handle_t,
    sdp: &str,
) -> Result<(), String> {
    let sdp = CString::new(sdp).map_err(|error| error.to_string())?;
    let result = unsafe { ffi::lib_dspeak_media_p2p_set_remote_description(handle, sdp.as_ptr()) };
    if result == 0 {
        Ok(())
    } else {
        Err("native P2P remote description failed".to_string())
    }
}

pub fn p2p_add_ice_candidate(
    handle: *mut ffi::lib_dspeak_media_p2p_handle_t,
    candidate: &str,
) -> Result<(), String> {
    let candidate = CString::new(candidate).map_err(|error| error.to_string())?;
    let result = unsafe {
        ffi::lib_dspeak_media_p2p_add_ice_candidate(handle, candidate.as_ptr())
    };
    if result == 0 {
        Ok(())
    } else {
        Err("native P2P ICE candidate failed".to_string())
    }
}

pub fn p2p_poll_ice_candidate(
    handle: *mut ffi::lib_dspeak_media_p2p_handle_t,
) -> Option<String> {
    let pointer = unsafe { ffi::lib_dspeak_media_p2p_poll_ice_candidate(handle) };
    if pointer.is_null() {
        return None;
    }
    let value = unsafe { CStr::from_ptr(pointer) }
        .to_string_lossy()
        .into_owned();
    unsafe { ffi::lib_dspeak_media_free_string(pointer) };
    Some(value)
}

pub fn p2p_ice_state(handle: *mut ffi::lib_dspeak_media_p2p_handle_t) -> i32 {
    unsafe { ffi::lib_dspeak_media_p2p_ice_connection_state(handle) }
}

pub fn p2p_restart_ice(
    handle: *mut ffi::lib_dspeak_media_p2p_handle_t,
) -> Result<String, String> {
    let mut pointer = ptr::null_mut();
    let result = unsafe { ffi::lib_dspeak_media_p2p_restart_ice(handle, &mut pointer) };
    p2p_sdp_result(result, pointer, "ICE restart")
}
