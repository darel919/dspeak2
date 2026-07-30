use super::startup::{call_native_shutdown, native_capabilities_value, try_native_initialize};
use super::state::{emit_state, lock_state, NativeMediaStore};
use super::types::{
    capture_error, validate_capture_request, NativeMediaCapabilities, NativeMediaError,
    NativeMediaState,
};
#[cfg(native_rtc)]
use super::{ffi, native};
use serde_json::Value;
use std::ffi::{CStr, CString};
use tauri::{AppHandle, State};

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
    store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?
        .clear_transports();
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
                .get("nativeMicrophone")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            "camera" => capabilities
                .get("nativeCamera")
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
    _store: State<'_, NativeMediaStore>,
    _device_id: String,
) -> Result<(), String> {
    Ok(())
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
    let mut handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    handles.clear_all();
    let device = native::create_device(&router_rtp_capabilities)?;
    handles.device = device;
    let rtp_capabilities = native::device_rtp_capabilities(device)?;
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
    )?;
    handles.send_transport = transport;
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
    )?;
    handles.recv_transport = transport;
    Ok(serde_json::json!({ "handle": transport as u64 }))
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
    let producer = native::produce_capture(handles.send_transport, &kind, &app_data.to_string())?;
    if kind == "audio" {
        if !handles.audio_producer.is_null() {
            unsafe { ffi::lib_dspeak_media_destroy_producer(handles.audio_producer) };
        }
        handles.audio_producer = producer;
    } else if kind == "video" {
        if !handles.video_producer.is_null() {
            unsafe { ffi::lib_dspeak_media_destroy_producer(handles.video_producer) };
        }
        handles.video_producer = producer;
    } else {
        return Err("native capture producer kind is invalid".to_string());
    }
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
pub async fn media_poll_action(_store: State<'_, NativeMediaStore>) -> Result<Value, String> {
    Ok(serde_json::json!({ "kind": 0, "transportPtr": 0, "actionId": 0 }))
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_complete_connect(
    _store: State<'_, NativeMediaStore>,
    _transport_ptr: u64,
) -> Result<(), String> {
    Ok(())
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
pub async fn media_get_devices(_store: State<'_, NativeMediaStore>) -> Result<Vec<Value>, String> {
    Ok(vec![])
}

#[tauri::command]
pub async fn media_set_microphone(
    _store: State<'_, NativeMediaStore>,
    _enabled: bool,
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn media_set_camera(
    _store: State<'_, NativeMediaStore>,
    _enabled: bool,
) -> Result<(), String> {
    Ok(())
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
        let mut error = 0;
        let result = ffi::lib_dspeak_media_stop_capture(&mut error);
        if result != 0 {
            return Err(format!("native system audio stop failed (error {})", error));
        }
    }
    Ok(())
}
