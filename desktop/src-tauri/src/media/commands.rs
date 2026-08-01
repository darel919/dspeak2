use super::startup::{call_native_shutdown, native_capabilities_value, try_native_initialize};
#[cfg(native_rtc)]
use super::state::NativeHandleRegistry;
use super::state::{emit_state, lock_state, NativeMediaStore};
use super::types::{
    capture_error, validate_capture_request, NativeMediaCapabilities, NativeMediaError,
    NativeMediaState,
};
#[cfg(native_rtc)]
use super::{ffi, native};
#[cfg(native_rtc)]
use base64::Engine;
use serde_json::Value;
use std::ffi::{CStr, CString};
use tauri::{AppHandle, State};

#[cfg(native_rtc)]
fn consumer_index(handles: &NativeHandleRegistry, consumer_id: &str) -> Option<usize> {
    handles.consumers.iter().position(|consumer| {
        let pointer = unsafe { ffi::lib_dspeak_media_consumer_get_id(*consumer) };
        if pointer.is_null() {
            return false;
        }
        let matches = unsafe { CStr::from_ptr(pointer) }
            .to_str()
            .map(|value| value == consumer_id)
            .unwrap_or(false);
        unsafe { ffi::lib_dspeak_media_free_string(pointer) };
        matches
    })
}

#[cfg(native_rtc)]
fn validate_capture_producer_source(kind: &str, source: &str) -> Result<(), String> {
    let valid = match kind {
        "audio" => matches!(source, "audio" | "screen-audio"),
        "video" => matches!(source, "camera" | "screen"),
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(format!(
            "native capture source '{source}' is invalid for {kind} producer"
        ))
    }
}

#[cfg(native_rtc)]
fn stop_native_captures() {
    let mut error = 0;
    unsafe {
        let _ = ffi::lib_dspeak_media_stop_capture(&mut error);
        ffi::lib_dspeak_media_stop_system_audio_capture();
        let _ = ffi::lib_dspeak_media_stop_microphone_capture(&mut error);
        let _ = ffi::lib_dspeak_media_stop_camera_capture(&mut error);
    }
}

pub(crate) fn shutdown_for_exit(store: &NativeMediaStore) {
    #[cfg(native_rtc)]
    {
        if let Ok(mut handles) = store.handles.lock() {
            handles.clear_all();
        }
        stop_native_captures();
        call_native_shutdown();
    }
}

#[tauri::command]
pub async fn media_initialize(
    app: AppHandle,
    store: State<'_, NativeMediaStore>,
    config: Value,
) -> Result<NativeMediaState, String> {
    let snapshot = {
        let mut state = lock_state(&store)?;

        if state.initialized {
            state.clone()
        } else {
            let native_backend_ok = try_native_initialize();

            if native_backend_ok {
                state.initialized = true;
                if let Some(caps) = native_capabilities_value().as_object() {
                    if let Ok(parsed) = serde_json::from_value::<NativeMediaCapabilities>(
                        Value::Object(caps.clone()),
                    ) {
                        state.capabilities = parsed;
                    }
                }
                state.native_backend_ready = state.capabilities.native_backend_ready;
            } else {
                state.initialized = true;
                if let Some(capabilities) = config.get("capabilities") {
                    if let Ok(value) = serde_json::from_value(capabilities.clone()) {
                        state.capabilities = value;
                    }
                }
            }

            state.clone()
        }
    };
    emit_state(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub async fn media_join(
    app: AppHandle,
    store: State<'_, NativeMediaStore>,
    input: Value,
) -> Result<(), String> {
    let snapshot = {
        let mut state = lock_state(&store)?;
        if !state.initialized {
            return Err("native media is not initialized".to_string());
        }
        if !state.capabilities.native_rtc {
            return Err("native media backend is unavailable".to_string());
        }
        state.connected = true;
        state.session = Some(input);
        state.clone()
    };
    emit_state(&app, &snapshot);
    Ok(())
}

#[tauri::command]
pub async fn media_leave(app: AppHandle, store: State<'_, NativeMediaStore>) -> Result<(), String> {
    #[cfg(native_rtc)]
    {
        // Destroy transports/producers/consumers FIRST, then stop capture.
        // If we stop capture first, destroy_capture_tracks() frees the audio
        // track while the send-transport producer still holds a pointer to it
        // — the WebRTC encoder thread segfaults on the next frame callback.
        // Closing the producer first ensures no more frames are requested
        // before the track is destroyed.
        let mut handles = store
            .handles
            .lock()
            .map_err(|_| "native media handle lock poisoned".to_string())?;
        handles.clear_p2p();
        handles.clear_transports();
        stop_native_captures();
    }
    let snapshot = {
        let mut state = lock_state(&store)?;
        if !state.initialized {
            return Err("native media is not initialized".to_string());
        }
        state.connected = false;
        state.session = None;
        state.tracks.clear();
        state.clone()
    };
    emit_state(&app, &snapshot);
    Ok(())
}

#[tauri::command]
pub async fn media_shutdown(
    app: AppHandle,
    store: State<'_, NativeMediaStore>,
) -> Result<(), String> {
    #[cfg(native_rtc)]
    store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?
        .clear_all();
    stop_native_captures();
    let snapshot = {
        let mut state = lock_state(&store)?;
        call_native_shutdown();
        state.initialized = false;
        state.connected = false;
        state.native_backend_ready = false;
        state.capabilities = NativeMediaCapabilities::default();
        state.session = None;
        state.topology = None;
        state.ice_servers.clear();
        state.tracks.clear();
        state.clone()
    };
    emit_state(&app, &snapshot);
    Ok(())
}

#[tauri::command]
pub async fn media_get_capabilities(
    store: State<'_, NativeMediaStore>,
) -> Result<NativeMediaCapabilities, String> {
    let state = lock_state(&store)?;
    Ok(state.capabilities.clone())
}

#[tauri::command]
pub async fn media_set_topology(
    app: AppHandle,
    store: State<'_, NativeMediaStore>,
    topology: Value,
) -> Result<(), String> {
    let snapshot = {
        let mut state = lock_state(&store)?;
        if !state.capabilities.native_rtc {
            return Err("native media backend is unavailable".to_string());
        }
        state.topology = Some(topology);
        state.clone()
    };
    emit_state(&app, &snapshot);
    Ok(())
}

#[tauri::command]
pub async fn media_set_ice_servers(
    app: AppHandle,
    store: State<'_, NativeMediaStore>,
    ice_servers: Vec<Value>,
) -> Result<(), String> {
    let snapshot = {
        let mut state = lock_state(&store)?;
        if !state.capabilities.native_rtc {
            return Err("native media backend is unavailable".to_string());
        }
        state.ice_servers = ice_servers;
        state.clone()
    };
    emit_state(&app, &snapshot);
    Ok(())
}

#[tauri::command]
pub async fn media_get_stats(store: State<'_, NativeMediaStore>) -> Result<Value, String> {
    let _state = lock_state(&store)?;
    Ok(serde_json::json!({}))
}

#[tauri::command]
pub async fn media_get_permissions(
    _store: State<'_, NativeMediaStore>,
    kind: String,
) -> Result<String, String> {
    #[cfg(native_rtc)]
    {
        let capabilities = native_capabilities_value();
        let granted = match kind.as_str() {
            "microphone" => capabilities
                .get("microphone")
                .or_else(|| capabilities.get("nativeMicrophone"))
                .and_then(Value::as_bool)
                .unwrap_or(false),
            "camera" => capabilities
                .get("camera")
                .or_else(|| capabilities.get("nativeCamera"))
                .and_then(Value::as_bool)
                .unwrap_or(false),
            "screen" | "screenVideo" => capabilities
                .get("nativeScreenShare")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            "screenAudio" | "systemAudio" => capabilities
                .get("nativeScreenAudio")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            _ => false,
        };
        return Ok(if granted { "granted" } else { "prompt" }.to_string());
    }
    #[cfg(not(native_rtc))]
    {
        let _ = kind;
        Ok("prompt".to_string())
    }
}

#[tauri::command]
pub async fn media_list_capture_sources(
    store: State<'_, NativeMediaStore>,
) -> Result<Vec<Value>, NativeMediaError> {
    let state = store.state.lock().map_err(|_| {
        capture_error(
            "DESKTOP_CAPTURE_NATIVE_UNAVAILABLE",
            "enumerate",
            "native media state lock poisoned",
        )
    })?;
    if !state.capabilities.native_rtc || !state.native_backend_ready {
        return Err(capture_error(
            "DESKTOP_CAPTURE_NATIVE_UNAVAILABLE",
            "enumerate",
            "native media backend is unavailable",
        ));
    }
    drop(state);
    #[cfg(native_rtc)]
    {
        let pointer = unsafe { ffi::lib_dspeak_media_list_capture_sources() };
        if pointer.is_null() {
            return Err(capture_error(
                "DESKTOP_CAPTURE_ENUMERATION_FAILED",
                "enumerate",
                "native capture source enumeration failed",
            ));
        }
        let text = unsafe { CStr::from_ptr(pointer) }.to_str().map_err(|_| {
            unsafe { ffi::lib_dspeak_media_free_string(pointer) };
            capture_error(
                "DESKTOP_CAPTURE_ENUMERATION_FAILED",
                "enumerate",
                "native source JSON was not UTF-8",
            )
        })?;
        let result = serde_json::from_str::<Vec<Value>>(text).map_err(|_| {
            capture_error(
                "DESKTOP_CAPTURE_ENUMERATION_FAILED",
                "enumerate",
                "native source JSON was invalid",
            )
        });
        unsafe { ffi::lib_dspeak_media_free_string(pointer) };
        return result;
    }
    #[cfg(not(native_rtc))]
    Err(capture_error(
        "DESKTOP_CAPTURE_NATIVE_UNAVAILABLE",
        "enumerate",
        "native media backend is unavailable",
    ))
}

#[tauri::command]
pub async fn media_select_capture_source(
    _store: State<'_, NativeMediaStore>,
    _source_id: String,
) -> Result<(), String> {
    Err("native capture source selection is unavailable".to_string())
}

#[tauri::command]
pub async fn media_start_screen_share(
    _app: AppHandle,
    store: State<'_, NativeMediaStore>,
    request: Option<Value>,
) -> Result<(), NativeMediaError> {
    {
        let state = store.state.lock().map_err(|_| {
            capture_error(
                "DESKTOP_CAPTURE_NATIVE_UNAVAILABLE",
                "screen-video",
                "native media state lock poisoned",
            )
        })?;
        if !state.native_backend_ready || !state.capabilities.native_rtc {
            return Err(capture_error(
                "DESKTOP_CAPTURE_NATIVE_UNAVAILABLE",
                "screen-video",
                "native media backend is unavailable",
            ));
        }
    }
    validate_capture_request(&request, "screen-video", "video")?;
    eprintln!(
        "[dspeak:media] screen-share request source={} mode={}",
        request
            .as_ref()
            .and_then(|value| value.get("sourceId"))
            .and_then(Value::as_str)
            .unwrap_or("unknown"),
        request
            .as_ref()
            .and_then(|value| value.get("mode"))
            .and_then(Value::as_str)
            .unwrap_or("unknown")
    );
    #[cfg(native_rtc)]
    {
        let serialized = serde_json::to_string(&request).map_err(|_| {
            capture_error(
                "DESKTOP_CAPTURE_INVALID_REQUEST",
                "screen-video",
                "capture request could not be serialized",
            )
        })?;
        let request_json = CString::new(serialized).map_err(|_| {
            capture_error(
                "DESKTOP_CAPTURE_INVALID_REQUEST",
                "screen-video",
                "capture request contained an invalid string",
            )
        })?;
        let mut error = 0;
        let result =
            unsafe { ffi::lib_dspeak_media_start_capture(request_json.as_ptr(), &mut error) };
        if result != 0 {
            let detail = unsafe { ffi::lib_dspeak_media_capture_error_message(error) };
            let message = if detail.is_null() {
                "native screen capture failed".to_string()
            } else {
                unsafe { CStr::from_ptr(detail) }
                    .to_string_lossy()
                    .into_owned()
            };
            return Err(capture_error(
                "DESKTOP_CAPTURE_START_FAILED",
                "screen-video",
                &message,
            ));
        }
        return Ok(());
    }
    #[cfg(not(native_rtc))]
    Err(capture_error(
        "DESKTOP_CAPTURE_NATIVE_UNAVAILABLE",
        "screen-video",
        "native media backend is unavailable",
    ))
}

#[tauri::command]
pub async fn media_replace_screen_share(
    app: AppHandle,
    store: State<'_, NativeMediaStore>,
    request: Option<Value>,
) -> Result<(), NativeMediaError> {
    media_start_screen_share(app, store, request).await
}

#[tauri::command]
pub async fn media_stop_screen_share(
    app: AppHandle,
    store: State<'_, NativeMediaStore>,
    _source: Option<Value>,
) -> Result<(), String> {
    let snapshot = {
        let state = lock_state(&store)?;
        if !state.capabilities.native_rtc {
            return Err("native media backend is unavailable".to_string());
        }
        #[cfg(native_rtc)]
        {
            let mut error = 0;
            let result = unsafe { ffi::lib_dspeak_media_stop_capture(&mut error) };
            if result != 0 {
                return Err(format!(
                    "native stop screen capture failed (error {})",
                    error
                ));
            }
        }
        state.clone()
    };
    let guard = lock_state(&store)?;
    emit_state(&app, &guard);
    drop(guard);
    let _ = snapshot;
    Ok(())
}

#[tauri::command]
pub async fn media_set_microphone_device(
    store: State<'_, NativeMediaStore>,
    device_id: String,
) -> Result<(), String> {
    #[cfg(native_rtc)]
    {
        let state = store
            .state
            .lock()
            .map_err(|_| "native media state lock poisoned".to_string())?;
        if !state.native_backend_ready || !state.capabilities.native_rtc {
            return Err("native media backend is unavailable".to_string());
        }
        drop(state);
        let device_id =
            CString::new(device_id).map_err(|_| "microphone device id is invalid".to_string())?;
        let mut error = 0;
        let result =
            unsafe { ffi::lib_dspeak_media_set_microphone_device(device_id.as_ptr(), &mut error) };
        if result != 0 {
            return Err(format!(
                "native microphone device selection failed (error {})",
                error
            ));
        }
        return Ok(());
    }
    #[cfg(not(native_rtc))]
    {
        let _ = store;
        let _ = device_id;
        Err("native media backend not available".to_string())
    }
}

#[tauri::command]
pub async fn media_set_output_device(
    _store: State<'_, NativeMediaStore>,
    _device_id: String,
) -> Result<(), String> {
    Ok(())
}

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
    let app_data_json = app_data.as_ref().map(|v| v.to_string());
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
    let app_data_json = app_data.as_ref().map(|v| v.to_string());
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

#[cfg(native_rtc)]
fn owned_p2p_handle(
    handles: &super::state::NativeHandleRegistry,
    handle: u64,
) -> Result<*mut ffi::lib_dspeak_media_p2p_handle_t, String> {
    handles
        .p2p_handles
        .get(&handle)
        .copied()
        .filter(|value| !value.is_null())
        .ok_or_else(|| "native P2P handle is not owned by this session".to_string())
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_create(
    store: State<'_, NativeMediaStore>,
    offerer: bool,
) -> Result<Value, String> {
    let ice_servers = {
        let state = store
            .state
            .lock()
            .map_err(|_| "native media state lock poisoned".to_string())?;
        serde_json::to_string(&state.ice_servers).map_err(|error| error.to_string())?
    };
    let mut handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let handle = native::p2p_create(&ice_servers, offerer)?;
    let key = handle as u64;
    handles.p2p_handles.insert(key, handle);
    Ok(serde_json::json!({ "handle": key }))
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_destroy(
    store: State<'_, NativeMediaStore>,
    p2p_handle: u64,
) -> Result<(), String> {
    let mut handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let handle = handles
        .p2p_handles
        .remove(&p2p_handle)
        .ok_or_else(|| "native P2P handle is not owned by this session".to_string())?;
    handles.p2p_tracks.retain(|(key, _), _| *key != p2p_handle);
    native::p2p_destroy(handle);
    Ok(())
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_create_offer(
    store: State<'_, NativeMediaStore>,
    p2p_handle: u64,
) -> Result<String, String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    native::p2p_create_offer(owned_p2p_handle(&handles, p2p_handle)?)
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_create_answer(
    store: State<'_, NativeMediaStore>,
    p2p_handle: u64,
    remote_sdp: String,
) -> Result<String, String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    native::p2p_create_answer(owned_p2p_handle(&handles, p2p_handle)?, &remote_sdp)
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_set_remote_description(
    store: State<'_, NativeMediaStore>,
    p2p_handle: u64,
    sdp: String,
) -> Result<(), String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    native::p2p_set_remote_description(owned_p2p_handle(&handles, p2p_handle)?, &sdp)
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_add_ice_candidate(
    store: State<'_, NativeMediaStore>,
    p2p_handle: u64,
    candidate: String,
) -> Result<(), String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    native::p2p_add_ice_candidate(owned_p2p_handle(&handles, p2p_handle)?, &candidate)
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_poll_ice_candidate(
    store: State<'_, NativeMediaStore>,
    p2p_handle: u64,
) -> Result<Option<String>, String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let handle = owned_p2p_handle(&handles, p2p_handle)?;
    Ok(native::p2p_poll_ice_candidate(handle))
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_ice_state(
    store: State<'_, NativeMediaStore>,
    p2p_handle: u64,
) -> Result<i32, String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    Ok(native::p2p_ice_state(owned_p2p_handle(
        &handles, p2p_handle,
    )?))
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_restart_ice(
    store: State<'_, NativeMediaStore>,
    p2p_handle: u64,
) -> Result<String, String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    native::p2p_restart_ice(owned_p2p_handle(&handles, p2p_handle)?)
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_add_track(
    store: State<'_, NativeMediaStore>,
    p2p_handle: u64,
    source: String,
    kind: String,
) -> Result<Value, String> {
    let mut handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let handle = owned_p2p_handle(&handles, p2p_handle)?;
    let c_source = CString::new(source.as_str()).map_err(|error| error.to_string())?;
    let track = if kind == "video" {
        unsafe { ffi::lib_dspeak_media_get_video_track(c_source.as_ptr()) }
    } else if kind == "audio" {
        unsafe { ffi::lib_dspeak_media_get_audio_track(c_source.as_ptr()) }
    } else {
        return Err("native P2P track kind is invalid".to_string());
    };
    if track.is_null() {
        return Err(format!("native {kind} capture track is unavailable"));
    }
    let result = unsafe {
        if kind == "video" {
            ffi::lib_dspeak_media_p2p_add_video_track(handle, track)
        } else {
            ffi::lib_dspeak_media_p2p_add_audio_track(handle, track)
        }
    };
    if result != 0 {
        return Err(format!("native P2P {kind} track attachment failed"));
    }
    let pointer = unsafe {
        if kind == "video" {
            ffi::lib_dspeak_media_video_track_get_id(track)
        } else {
            ffi::lib_dspeak_media_audio_track_get_id(track)
        }
    };
    if pointer.is_null() {
        return Err("native P2P track did not return an identifier".to_string());
    }
    let track_id = unsafe { CStr::from_ptr(pointer) }
        .to_string_lossy()
        .into_owned();
    unsafe { ffi::lib_dspeak_media_free_string(pointer) };
    eprintln!("[dspeak:media] p2p track added source={source} kind={kind} id={track_id}");
    handles
        .p2p_tracks
        .insert((p2p_handle, source), (kind, track));
    Ok(serde_json::json!({ "trackId": track_id }))
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_remove_track(
    store: State<'_, NativeMediaStore>,
    p2p_handle: u64,
    source: String,
) -> Result<(), String> {
    let mut handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let handle = owned_p2p_handle(&handles, p2p_handle)?;
    let (kind, track) = handles
        .p2p_tracks
        .remove(&(p2p_handle, source))
        .ok_or_else(|| "native P2P source is not attached".to_string())?;
    let result = unsafe {
        if kind == "video" {
            ffi::lib_dspeak_media_p2p_remove_video_track(handle, track)
        } else {
            ffi::lib_dspeak_media_p2p_remove_audio_track(handle, track)
        }
    };
    if result != 0 {
        return Err(format!("native P2P {kind} track removal failed"));
    }
    Ok(())
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_poll_event(store: State<'_, NativeMediaStore>) -> Result<Value, String> {
    media_poll_receive_event(store).await
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_set_consumer_enabled(
    store: State<'_, NativeMediaStore>,
    consumer_id: String,
    enabled: bool,
) -> Result<(), String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let index = consumer_index(&handles, &consumer_id)
        .ok_or_else(|| "native consumer is not owned by this session".to_string())?;
    let result =
        unsafe { ffi::lib_dspeak_media_consumer_set_enabled(handles.consumers[index], enabled) };
    if result != 0 {
        return Err("native consumer enable state could not be changed".to_string());
    }
    eprintln!(
        "[dspeak:media] consumer {} {}",
        consumer_id,
        if enabled { "resumed" } else { "paused" }
    );
    Ok(())
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_set_consumer_volume(
    store: State<'_, NativeMediaStore>,
    consumer_id: String,
    volume: f64,
) -> Result<(), String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let index = consumer_index(&handles, &consumer_id)
        .ok_or_else(|| "native consumer is not owned by this session".to_string())?;
    let result =
        unsafe { ffi::lib_dspeak_media_consumer_set_volume(handles.consumers[index], volume) };
    if result != 0 {
        return Err("native consumer volume could not be changed".to_string());
    }
    Ok(())
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_close_consumer(
    store: State<'_, NativeMediaStore>,
    consumer_id: String,
) -> Result<(), String> {
    let mut handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let Some(index) = consumer_index(&handles, &consumer_id) else {
        return Ok(());
    };
    let consumer = handles.consumers.remove(index);
    unsafe { ffi::lib_dspeak_media_destroy_consumer(consumer) };
    Ok(())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_set_consumer_enabled(
    _store: State<'_, NativeMediaStore>,
    _consumer_id: String,
    _enabled: bool,
) -> Result<(), String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_set_track_parameters(
    _store: State<'_, NativeMediaStore>,
    _p2p_handle: u64,
    _source: String,
    _parameters: Value,
) -> Result<(), String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_set_audio_stereo(
    _store: State<'_, NativeMediaStore>,
    _p2p_handle: u64,
    _stereo: bool,
) -> Result<(), String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_set_receive_enabled(
    _store: State<'_, NativeMediaStore>,
    _p2p_handle: u64,
    _track_id: String,
    _enabled: bool,
) -> Result<(), String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_send_health(
    _store: State<'_, NativeMediaStore>,
    _p2p_handle: u64,
    _message: String,
) -> Result<(), String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_set_consumer_volume(
    _store: State<'_, NativeMediaStore>,
    _consumer_id: String,
    _volume: f64,
) -> Result<(), String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_close_consumer(
    _store: State<'_, NativeMediaStore>,
    _consumer_id: String,
) -> Result<(), String> {
    Ok(())
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_poll_action(_store: State<'_, NativeMediaStore>) -> Result<Value, String> {
    let action = native::poll_action();
    let params_ptr = action.params_json;
    let params = if params_ptr.is_null() {
        None
    } else {
        let s = unsafe { std::ffi::CStr::from_ptr(params_ptr) };
        let value = Some(s.to_str().unwrap_or("").to_string());
        unsafe { ffi::lib_dspeak_media_free_string(params_ptr) };
        value
    };
    let state_ptr = action.state;
    let state = if state_ptr.is_null() {
        None
    } else {
        let s = unsafe { std::ffi::CStr::from_ptr(state_ptr) };
        let value = Some(s.to_str().unwrap_or("").to_string());
        unsafe { ffi::lib_dspeak_media_free_string(state_ptr) };
        value
    };
    Ok(serde_json::json!({
        "kind": action.kind,
        "transportPtr": action.transport_ptr as u64,
        "actionId": action.action_id,
        "paramsJson": params,
        "state": state,
    }))
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_poll_receive_event(
    _store: State<'_, NativeMediaStore>,
) -> Result<Value, String> {
    let mut event = unsafe { ffi::lib_dspeak_media_poll_receive_event() };
    if event.kind == 0 {
        return Ok(serde_json::json!({ "kind": 0 }));
    }
    let id = if event.id.is_null() {
        None
    } else {
        Some(
            unsafe { CStr::from_ptr(event.id) }
                .to_string_lossy()
                .into_owned(),
        )
    };
    let payload = if event.payload_json.is_null() {
        serde_json::json!({})
    } else {
        serde_json::from_str::<Value>(
            unsafe { CStr::from_ptr(event.payload_json) }
                .to_str()
                .unwrap_or("{}"),
        )
        .unwrap_or_else(|_| serde_json::json!({}))
    };
    let data = if event.data.is_null() || event.data_len == 0 {
        None
    } else {
        let bytes = unsafe { std::slice::from_raw_parts(event.data, event.data_len as usize) };
        Some(base64::engine::general_purpose::STANDARD.encode(bytes))
    };
    let result = serde_json::json!({
        "kind": event.kind,
        "eventId": event.event_id,
        "id": id,
        "payload": payload,
        "data": data,
    });
    unsafe { ffi::lib_dspeak_media_free_receive_event(&mut event) };
    Ok(result)
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_complete_connect(
    _store: State<'_, NativeMediaStore>,
    transport_ptr: u64,
) -> Result<(), String> {
    native::complete_connect(transport_ptr as *mut std::ffi::c_void);
    Ok(())
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_fail_connect(
    _store: State<'_, NativeMediaStore>,
    transport_ptr: u64,
    error: String,
) -> Result<(), String> {
    native::fail_connect(transport_ptr as *mut std::ffi::c_void, &error);
    Ok(())
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_complete_produce(
    _store: State<'_, NativeMediaStore>,
    action_id: u64,
    producer_id: String,
) -> Result<(), String> {
    native::complete_produce(action_id, &producer_id);
    Ok(())
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_fail_produce(
    _store: State<'_, NativeMediaStore>,
    action_id: u64,
    error: String,
) -> Result<(), String> {
    native::fail_produce(action_id, &error);
    Ok(())
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_create_capture_producer(
    store: State<'_, NativeMediaStore>,
    kind: String,
    app_data: Value,
) -> Result<Value, String> {
    let mut handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    if handles.send_transport.is_null() {
        return Err("native send transport is not ready".to_string());
    }
    if kind != "audio" && kind != "video" {
        return Err("native capture producer kind is invalid".to_string());
    }
    let source = app_data
        .get("source")
        .and_then(Value::as_str)
        .unwrap_or(if kind == "audio" { "audio" } else { "screen" });
    validate_capture_producer_source(&kind, source)?;
    if handles.producers.contains_key(source) {
        return Err(format!(
            "native {kind} producer already exists for source '{source}'"
        ));
    }
    let producer =
        native::produce_capture(handles.send_transport, &kind, source, &app_data.to_string())?;
    eprintln!("[dspeak:media] capture producer created source={source} kind={kind}");
    handles.producers.insert(source.to_string(), producer);
    let id = unsafe { ffi::lib_dspeak_media_producer_get_id(producer) };
    if id.is_null() {
        return Err("native producer did not return an identifier".to_string());
    }
    let producer_id = unsafe { CStr::from_ptr(id) }
        .to_str()
        .map(str::to_owned)
        .map_err(|_| "native producer identifier is not UTF-8".to_string());
    unsafe { ffi::lib_dspeak_media_free_string(id) };
    Ok(serde_json::json!({ "id": producer_id? }))
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_set_producer_paused(
    store: State<'_, NativeMediaStore>,
    source: String,
    paused: bool,
) -> Result<(), String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let producer = handles
        .producers
        .get(&source)
        .copied()
        .ok_or_else(|| format!("native producer is not available for source '{source}'"))?;
    native::producer_set_paused(producer, paused)
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_set_producer_parameters(
    store: State<'_, NativeMediaStore>,
    source: String,
    parameters: Value,
) -> Result<(), String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let producer = handles
        .producers
        .get(&source)
        .copied()
        .ok_or_else(|| format!("native producer is not available for source '{source}'"))?;
    native::producer_set_parameters(producer, &parameters.to_string())
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_remove_capture_producer(
    store: State<'_, NativeMediaStore>,
    source: String,
) -> Result<(), String> {
    let mut handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    if let Some(producer) = handles.producers.remove(&source) {
        unsafe { ffi::lib_dspeak_media_destroy_producer(producer) };
    }
    Ok(())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_create_capture_producer(
    _store: State<'_, NativeMediaStore>,
    _kind: String,
    _app_data: Value,
) -> Result<Value, String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_set_producer_paused(
    _store: State<'_, NativeMediaStore>,
    _source: String,
    _paused: bool,
) -> Result<(), String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_set_producer_parameters(
    _store: State<'_, NativeMediaStore>,
    _source: String,
    _parameters: Value,
) -> Result<(), String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_remove_capture_producer(
    _store: State<'_, NativeMediaStore>,
    _source: String,
) -> Result<(), String> {
    Err("native media backend not available".to_string())
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

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_create(
    _store: State<'_, NativeMediaStore>,
    _offerer: bool,
) -> Result<Value, String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_destroy(
    _store: State<'_, NativeMediaStore>,
    _p2p_handle: u64,
) -> Result<(), String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_create_offer(
    _store: State<'_, NativeMediaStore>,
    _p2p_handle: u64,
) -> Result<String, String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_create_answer(
    _store: State<'_, NativeMediaStore>,
    _p2p_handle: u64,
    _remote_sdp: String,
) -> Result<String, String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_set_remote_description(
    _store: State<'_, NativeMediaStore>,
    _p2p_handle: u64,
    _sdp: String,
) -> Result<(), String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_add_ice_candidate(
    _store: State<'_, NativeMediaStore>,
    _p2p_handle: u64,
    _candidate: String,
) -> Result<(), String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_poll_ice_candidate(
    _store: State<'_, NativeMediaStore>,
    _p2p_handle: u64,
) -> Result<Option<String>, String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_ice_state(
    _store: State<'_, NativeMediaStore>,
    _p2p_handle: u64,
) -> Result<i32, String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_restart_ice(
    _store: State<'_, NativeMediaStore>,
    _p2p_handle: u64,
) -> Result<String, String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_add_track(
    _store: State<'_, NativeMediaStore>,
    _p2p_handle: u64,
    _source: String,
    _kind: String,
) -> Result<Value, String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_remove_track(
    _store: State<'_, NativeMediaStore>,
    _p2p_handle: u64,
    _source: String,
) -> Result<(), String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_poll_event(_store: State<'_, NativeMediaStore>) -> Result<Value, String> {
    Ok(serde_json::json!({ "kind": 0 }))
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_poll_action(_store: State<'_, NativeMediaStore>) -> Result<Value, String> {
    Ok(serde_json::json!({ "kind": 0, "transportPtr": 0, "actionId": 0 }))
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_poll_receive_event(
    _store: State<'_, NativeMediaStore>,
) -> Result<Value, String> {
    Ok(serde_json::json!({ "kind": 0 }))
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_complete_connect(
    _store: State<'_, NativeMediaStore>,
    _transport_ptr: u64,
) -> Result<(), String> {
    Ok(())
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_set_track_parameters(
    store: State<'_, NativeMediaStore>,
    p2p_handle: u64,
    source: String,
    parameters: Value,
) -> Result<(), String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let handle = owned_p2p_handle(&handles, p2p_handle)?;
    let (kind, track) = handles
        .p2p_tracks
        .get(&(p2p_handle, source))
        .map(|(kind, track)| (kind.as_str(), *track))
        .ok_or_else(|| "native P2P source is not attached".to_string())?;
    let track_id = unsafe {
        if track.is_null() {
            std::ptr::null_mut()
        } else if kind == "audio" {
            ffi::lib_dspeak_media_audio_track_get_id(track)
        } else {
            ffi::lib_dspeak_media_video_track_get_id(track)
        }
    };
    let track_id = if track_id.is_null() {
        return Err("native P2P track did not return an identifier".to_string());
    } else {
        let value = unsafe { CStr::from_ptr(track_id) }
            .to_string_lossy()
            .into_owned();
        unsafe { ffi::lib_dspeak_media_free_string(track_id) };
        value
    };
    native::p2p_set_track_parameters(handle, &track_id, &parameters.to_string())
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_set_audio_stereo(
    store: State<'_, NativeMediaStore>,
    p2p_handle: u64,
    stereo: bool,
) -> Result<(), String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let handle = owned_p2p_handle(&handles, p2p_handle)?;
    let result = unsafe { ffi::lib_dspeak_media_p2p_set_audio_stereo(handle, stereo) };
    if result == 0 {
        Ok(())
    } else {
        Err("native P2P audio profile update failed".to_string())
    }
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_set_receive_enabled(
    store: State<'_, NativeMediaStore>,
    p2p_handle: u64,
    track_id: String,
    enabled: bool,
) -> Result<(), String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let handle = owned_p2p_handle(&handles, p2p_handle)?;
    native::p2p_set_receive_enabled(handle, &track_id, enabled)
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_send_health(
    store: State<'_, NativeMediaStore>,
    p2p_handle: u64,
    message: String,
) -> Result<(), String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let handle = owned_p2p_handle(&handles, p2p_handle)?;
    native::p2p_send_health(handle, &message)
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_fail_connect(
    _store: State<'_, NativeMediaStore>,
    _transport_ptr: u64,
    _error: String,
) -> Result<(), String> {
    Ok(())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_complete_produce(
    _store: State<'_, NativeMediaStore>,
    _action_id: u64,
    _producer_id: String,
) -> Result<(), String> {
    Ok(())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_fail_produce(
    _store: State<'_, NativeMediaStore>,
    _action_id: u64,
    _error: String,
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn media_handle_signal(
    _store: State<'_, NativeMediaStore>,
    _message: Value,
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn media_get_devices(store: State<'_, NativeMediaStore>) -> Result<Vec<Value>, String> {
    #[cfg(native_rtc)]
    {
        let state = store
            .state
            .lock()
            .map_err(|_| "native media state lock poisoned".to_string())?;
        if !state.native_backend_ready || !state.capabilities.native_rtc {
            return Err("native media backend is unavailable".to_string());
        }
        drop(state);
        let pointer = unsafe { ffi::lib_dspeak_media_list_capture_devices() };
        if pointer.is_null() {
            return Err("native media device enumeration failed".to_string());
        }
        let text = unsafe { CStr::from_ptr(pointer) }
            .to_str()
            .map(str::to_owned)
            .map_err(|_| "native media device list was not UTF-8".to_string());
        unsafe { ffi::lib_dspeak_media_free_string(pointer) };
        let text = text?;
        return serde_json::from_str(&text)
            .map_err(|_| "native media device list was invalid JSON".to_string());
    }
    #[cfg(not(native_rtc))]
    {
        let _ = store;
        Err("native media backend not available".to_string())
    }
}

#[tauri::command]
pub async fn media_set_microphone(
    store: State<'_, NativeMediaStore>,
    enabled: bool,
) -> Result<(), String> {
    eprintln!("[dspeak:media] set-microphone enabled={enabled}");
    #[cfg(native_rtc)]
    {
        if enabled {
            let state = store
                .state
                .lock()
                .map_err(|_| "native media state lock poisoned".to_string())?;
            if !state.native_backend_ready || !state.capabilities.native_rtc {
                return Err("native microphone capture is unavailable".to_string());
            }
        }
        let mut error = 0;
        let result = unsafe {
            if enabled {
                ffi::lib_dspeak_media_start_microphone_capture(&mut error)
            } else {
                ffi::lib_dspeak_media_stop_microphone_capture(&mut error)
            }
        };
        if result != 0 {
            let detail = unsafe { ffi::lib_dspeak_media_capture_error_message(error) };
            let detail = if detail.is_null() {
                "native capture failed".to_string()
            } else {
                unsafe { CStr::from_ptr(detail) }
                    .to_string_lossy()
                    .into_owned()
            };
            eprintln!("[dspeak:media] set-microphone failed error={error} detail={detail}");
            return Err(format!(
                "native microphone capture failed (error {error}): {detail}"
            ));
        }
        eprintln!("[dspeak:media] set-microphone success enabled={enabled}");
        return Ok(());
    }
    #[cfg(not(native_rtc))]
    {
        let _ = store;
        let _ = enabled;
        Err("native media backend not available".to_string())
    }
}

#[tauri::command]
pub async fn media_set_camera(
    store: State<'_, NativeMediaStore>,
    enabled: bool,
) -> Result<(), String> {
    #[cfg(native_rtc)]
    {
        if enabled {
            let state = store
                .state
                .lock()
                .map_err(|_| "native media state lock poisoned".to_string())?;
            if !state.native_backend_ready || !state.capabilities.native_rtc {
                return Err("native camera capture is unavailable".to_string());
            }
        }
        let mut error = 0;
        let result = unsafe {
            if enabled {
                ffi::lib_dspeak_media_start_camera_capture(&mut error)
            } else {
                ffi::lib_dspeak_media_stop_camera_capture(&mut error)
            }
        };
        if result != 0 {
            return Err(format!("native camera capture failed (error {})", error));
        }
        return Ok(());
    }
    #[cfg(not(native_rtc))]
    {
        let _ = store;
        let _ = enabled;
        Err("native media backend not available".to_string())
    }
}

#[tauri::command]
pub async fn media_start_system_audio(
    store: State<'_, NativeMediaStore>,
    request: Option<Value>,
) -> Result<(), NativeMediaError> {
    {
        let state = store.state.lock().map_err(|_| {
            capture_error(
                "DESKTOP_CAPTURE_NATIVE_UNAVAILABLE",
                "system-audio",
                "native media state lock poisoned",
            )
        })?;
        if !state.native_backend_ready || !state.capabilities.native_rtc {
            return Err(capture_error(
                "DESKTOP_CAPTURE_NATIVE_UNAVAILABLE",
                "system-audio",
                "native media backend is unavailable",
            ));
        }
    }
    validate_capture_request(&request, "system-audio", "audio")?;
    #[cfg(native_rtc)]
    {
        let serialized = serde_json::to_string(&request).map_err(|_| {
            capture_error(
                "DESKTOP_CAPTURE_INVALID_REQUEST",
                "system-audio",
                "capture request could not be serialized",
            )
        })?;
        let request_json = CString::new(serialized).map_err(|_| {
            capture_error(
                "DESKTOP_CAPTURE_INVALID_REQUEST",
                "system-audio",
                "capture request contained an invalid string",
            )
        })?;
        let mut error = 0;
        let result =
            unsafe { ffi::lib_dspeak_media_start_capture(request_json.as_ptr(), &mut error) };
        if result != 0 {
            let detail = unsafe { ffi::lib_dspeak_media_capture_error_message(error) };
            let message = if detail.is_null() {
                "native system audio capture failed".to_string()
            } else {
                unsafe { CStr::from_ptr(detail) }
                    .to_string_lossy()
                    .into_owned()
            };
            return Err(capture_error(
                "DESKTOP_CAPTURE_START_FAILED",
                "system-audio",
                &message,
            ));
        }
        return Ok(());
    }
    #[cfg(not(native_rtc))]
    Err(capture_error(
        "DESKTOP_CAPTURE_NATIVE_UNAVAILABLE",
        "system-audio",
        "native media backend is unavailable",
    ))
}

#[tauri::command]
pub async fn media_replace_system_audio(
    store: State<'_, NativeMediaStore>,
    request: Option<Value>,
) -> Result<(), NativeMediaError> {
    media_start_system_audio(store, request).await
}

#[tauri::command]
pub async fn media_stop_system_audio(
    _store: State<'_, NativeMediaStore>,
    _source: Option<Value>,
) -> Result<(), String> {
    #[cfg(native_rtc)]
    unsafe {
        ffi::lib_dspeak_media_stop_system_audio_capture();
    }
    Ok(())
}
