use super::state::NativeMediaStore;
#[cfg(native_rtc)]
use super::{ffi, native};
use serde_json::Value;
use tauri::State;

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_create_device(
    store: State<'_, NativeMediaStore>,
    router_rtp_capabilities: String,
) -> Result<Value, String> {
    eprintln!(
        "[dspeak:media] create-device start capabilities_bytes={}",
        router_rtp_capabilities.len()
    );
    let mut handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    handles.clear_all();
    let device = native::create_device(&router_rtp_capabilities).map_err(|error| {
        eprintln!("[dspeak:media] create-device failed: {error}");
        error
    })?;
    handles.device = device;
    let rtp_capabilities = native::device_rtp_capabilities(device).map_err(|error| {
        eprintln!("[dspeak:media] device-capabilities failed: {error}");
        error
    })?;
    eprintln!("[dspeak:media] create-device success");
    Ok(serde_json::json!({
        "handle": device as u64,
        "rtpCapabilities": serde_json::from_str::<Value>(&rtp_capabilities)
            .map_err(|error| error.to_string())?,
    }))
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_create_send_transport(
    store: State<'_, NativeMediaStore>,
    device_handle: u64,
    id: String,
    ice_parameters: Value,
    ice_candidates: Value,
    dtls_parameters: Value,
    app_data: Option<Value>,
) -> Result<Value, String> {
    eprintln!("[dspeak:media] create-send-transport start id={id}");
    let mut handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let device = device_handle as *mut ffi::lib_dspeak_media_device_t;
    if device.is_null() || device != handles.device {
        return Err("native device handle is not owned by this session".to_string());
    }
    if !handles.send_transport.is_null() {
        unsafe { ffi::lib_dspeak_media_destroy_send_transport(handles.send_transport) };
        handles.send_transport = std::ptr::null_mut();
    }
    let app_data_json = app_data.as_ref().map(|value| value.to_string());
    let transport = native::create_send_transport(
        device,
        &id,
        &ice_parameters.to_string(),
        &ice_candidates.to_string(),
        &dtls_parameters.to_string(),
        app_data_json.as_deref(),
    )
    .map_err(|error| {
        eprintln!("[dspeak:media] create-send-transport failed id={id}: {error}");
        error
    })?;
    handles.send_transport = transport;
    eprintln!("[dspeak:media] create-send-transport success id={id}");
    Ok(serde_json::json!({ "handle": transport as u64 }))
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_create_recv_transport(
    store: State<'_, NativeMediaStore>,
    device_handle: u64,
    id: String,
    ice_parameters: Value,
    ice_candidates: Value,
    dtls_parameters: Value,
    app_data: Option<Value>,
) -> Result<Value, String> {
    eprintln!("[dspeak:media] create-recv-transport start id={id}");
    let mut handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let device = device_handle as *mut ffi::lib_dspeak_media_device_t;
    if device.is_null() || device != handles.device {
        return Err("native device handle is not owned by this session".to_string());
    }
    if !handles.recv_transport.is_null() {
        unsafe { ffi::lib_dspeak_media_destroy_recv_transport(handles.recv_transport) };
        handles.recv_transport = std::ptr::null_mut();
    }
    let app_data_json = app_data.as_ref().map(|value| value.to_string());
    let transport = native::create_recv_transport(
        device,
        &id,
        &ice_parameters.to_string(),
        &ice_candidates.to_string(),
        &dtls_parameters.to_string(),
        app_data_json.as_deref(),
    )
    .map_err(|error| {
        eprintln!("[dspeak:media] create-recv-transport failed id={id}: {error}");
        error
    })?;
    handles.recv_transport = transport;
    eprintln!("[dspeak:media] create-recv-transport success id={id}");
    Ok(serde_json::json!({ "handle": transport as u64 }))
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_consume(
    store: State<'_, NativeMediaStore>,
    id: String,
    producer_id: String,
    kind: String,
    rtp_parameters: Value,
    app_data: Option<Value>,
) -> Result<Value, String> {
    let mut handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    if handles.recv_transport.is_null() {
        return Err("native receive transport is not ready".to_string());
    }
    let consumer = native::consume(
        handles.recv_transport,
        &id,
        &producer_id,
        &kind,
        &rtp_parameters.to_string(),
        &app_data
            .unwrap_or_else(|| serde_json::json!({}))
            .to_string(),
    )?;
    if unsafe { ffi::lib_dspeak_media_consumer_set_enabled(consumer, false) } != 0 {
        unsafe { ffi::lib_dspeak_media_destroy_consumer(consumer) };
        return Err(
            "native consumer could not be paused before resume acknowledgement".to_string(),
        );
    }
    let metadata = native::consumer_metadata(consumer)?;
    eprintln!(
        "[dspeak:media] consumer paused until resume id={} kind={}",
        metadata.0, metadata.2
    );
    handles.consumers.push(consumer);
    Ok(serde_json::json!({
        "id": metadata.0,
        "producerId": metadata.1,
        "kind": metadata.2,
    }))
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_create_device(
    _store: State<'_, NativeMediaStore>,
    _router_rtp_capabilities: String,
) -> Result<Value, String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_create_send_transport(
    _store: State<'_, NativeMediaStore>,
    _device_handle: u64,
    _id: String,
    _ice_parameters: Value,
    _ice_candidates: Value,
    _dtls_parameters: Value,
    _app_data: Option<Value>,
) -> Result<Value, String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_create_recv_transport(
    _store: State<'_, NativeMediaStore>,
    _device_handle: u64,
    _id: String,
    _ice_parameters: Value,
    _ice_candidates: Value,
    _dtls_parameters: Value,
    _app_data: Option<Value>,
) -> Result<Value, String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_consume(
    _store: State<'_, NativeMediaStore>,
    _id: String,
    _producer_id: String,
    _kind: String,
    _rtp_parameters: Value,
    _app_data: Option<Value>,
) -> Result<Value, String> {
    Err("native media backend not available".to_string())
}
