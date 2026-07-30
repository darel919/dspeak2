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
