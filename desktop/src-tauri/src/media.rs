//! Native media control-plane state and Tauri commands.
//!
//! This module provides the stable, typed control/event boundary required by the
//! frontend while the platform media core is integrated behind the same commands.
//!
//! When the `native_rtc` cfg is active (set by build.rs when
//! NATIVE_MEDIA_ARTIFACT_DIR is defined), the C++ libdspeak_media backend is
//! linked and called via FFI.  Otherwise all capabilities default to false and
//! the frontend uses browser WebRTC exclusively.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
#[cfg(native_rtc)]
use std::ffi::CStr;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

pub const MEDIA_EVENT_STATE: &str = "media:state";
pub const MEDIA_EVENT_SIGNAL: &str = "media:signal";
pub const MEDIA_EVENT_STATS: &str = "media:stats";
pub const MEDIA_EVENT_DEVICE_CHANGE: &str = "media:device-change";
pub const MEDIA_EVENT_PERMISSION: &str = "media:permission";
pub const MEDIA_EVENT_ERROR: &str = "media:error";


#[cfg(native_rtc)]
mod ffi {
    #![allow(non_upper_case_globals, dead_code)]

    use std::ffi::c_char;
    use std::ffi::c_void;
    use std::os::raw::c_int;

    pub type dsm_device_t = c_void;
    pub type dsm_send_transport_t = c_void;
    pub type dsm_recv_transport_t = c_void;
    pub type dsm_producer_t = c_void;
    pub type dsm_consumer_t = c_void;

    #[repr(C)]
    pub struct dsm_action_t {
        pub kind: c_int,
        pub transport_ptr: *mut c_void,
        pub action_id: u64,
        pub params_json: *mut c_char,
        pub state: *mut c_char,
    }

    extern "C" {
        pub fn dsm_initialize() -> c_int;
        pub fn dsm_shutdown();
        pub fn dsm_get_capabilities() -> *mut c_char;
        pub fn dsm_free_string(s: *mut c_char);

        pub fn dsm_start_screen_capture(display_id: u64, error_out: *mut c_int) -> c_int;
        pub fn dsm_stop_screen_capture(error_out: *mut c_int) -> c_int;
        pub fn dsm_start_system_audio_capture(error_out: *mut c_int) -> c_int;
        pub fn dsm_stop_system_audio_capture();

        pub fn dsm_create_device(
            router_rtp_capabilities_json: *const c_char,
            error_out: *mut c_int,
        ) -> *mut dsm_device_t;
        pub fn dsm_destroy_device(device: *mut dsm_device_t);

        pub fn dsm_create_send_transport(
            device: *mut dsm_device_t,
            id: *const c_char,
            ice_parameters_json: *const c_char,
            ice_candidates_json: *const c_char,
            dtls_parameters_json: *const c_char,
            app_data_json: *const c_char,
            error_out: *mut c_int,
        ) -> *mut dsm_send_transport_t;
        pub fn dsm_destroy_send_transport(transport: *mut dsm_send_transport_t);

        pub fn dsm_create_recv_transport(
            device: *mut dsm_device_t,
            id: *const c_char,
            ice_parameters_json: *const c_char,
            ice_candidates_json: *const c_char,
            dtls_parameters_json: *const c_char,
            app_data_json: *const c_char,
            error_out: *mut c_int,
        ) -> *mut dsm_recv_transport_t;
        pub fn dsm_destroy_recv_transport(transport: *mut dsm_recv_transport_t);

        pub fn dsm_poll_action() -> dsm_action_t;
        pub fn dsm_complete_connect(transport_ptr: *mut c_void);
        pub fn dsm_fail_connect(transport_ptr: *mut c_void, error_message: *const c_char);
        pub fn dsm_complete_produce(action_id: c_uint64, producer_id: *const c_char);
        pub fn dsm_fail_produce(action_id: c_uint64, error_message: *const c_char);

        pub fn dsm_produce(
            transport: *mut dsm_send_transport_t,
            kind: *const c_char,
            app_data_json: *const c_char,
            error_out: *mut c_int,
        ) -> *mut dsm_producer_t;
        pub fn dsm_consume(
            transport: *mut dsm_recv_transport_t,
            id: *const c_char,
            producer_id: *const c_char,
            kind: *const c_char,
            rtp_parameters_json: *const c_char,
            app_data_json: *const c_char,
            error_out: *mut c_int,
        ) -> *mut dsm_consumer_t;
        pub fn dsm_destroy_producer(producer: *mut dsm_producer_t);
        pub fn dsm_destroy_consumer(consumer: *mut dsm_consumer_t);
        pub fn dsm_producer_get_id(producer: *mut dsm_producer_t) -> *mut c_char;
        pub fn dsm_consumer_get_id(consumer: *mut dsm_consumer_t) -> *mut c_char;

            pub fn dsm_create_video_track(track_id: *const c_char, error_out: *mut c_int) -> *mut c_void;
            pub fn dsm_create_audio_track(track_id: *const c_char, error_out: *mut c_int) -> *mut c_void;
            pub fn dsm_destroy_video_track(track: *mut c_void);
            pub fn dsm_destroy_audio_track(track: *mut c_void);
            pub fn dsm_video_track_get_id(track: *mut c_void) -> *mut c_char;
            pub fn dsm_audio_track_get_id(track: *mut c_void) -> *mut c_char;

            pub fn dsm_produce_video_track(
                transport: *mut dsm_send_transport_t,
                track: *mut c_void,
                app_data_json: *const c_char,
                error_out: *mut c_int,
            ) -> *mut dsm_producer_t;
            pub fn dsm_produce_audio_track(
                transport: *mut dsm_send_transport_t,
                track: *mut c_void,
                app_data_json: *const c_char,
                error_out: *mut c_int,
            ) -> *mut dsm_producer_t;

            pub fn dsm_p2p_add_video_track(handle: *mut c_void, track: *mut c_void) -> c_int;
            pub fn dsm_p2p_add_audio_track(handle: *mut c_void, track: *mut c_void) -> c_int;
            pub fn dsm_p2p_remove_video_track(handle: *mut c_void, track: *mut c_void) -> c_int;
            pub fn dsm_p2p_remove_audio_track(handle: *mut c_void, track: *mut c_void) -> c_int;
        }
        }

/// Call the native C++ backend initializer.  Returns true if the backend
/// is available (either because it initialised successfully, or because this
/// build does not include the native backend at all and that is the expected
/// fallback path).
fn try_native_initialize() -> bool {
    #[cfg(native_rtc)]
    {
        unsafe { ffi::dsm_initialize() == 0 }
    }
    #[cfg(not(native_rtc))]
    {
        false
    }
}

/// Query native backend capabilities.  Returned as a serde_json::Value so the
/// command layer can merge them with the current state.
fn native_capabilities_value() -> Value {
    #[cfg(native_rtc)]
    {
        let ptr = unsafe { ffi::dsm_get_capabilities() };
        if ptr.is_null() {
            return Value::Null;
        }
        let s = unsafe { CStr::from_ptr(ptr) };
        let result: Value =
            serde_json::from_str(s.to_str().unwrap_or("null")).unwrap_or(Value::Null);
        unsafe { ffi::dsm_free_string(ptr) };
        result
    }
    #[cfg(not(native_rtc))]
    {
        Value::Null
    }
}

fn call_native_shutdown() {
    #[cfg(native_rtc)]
    unsafe {
        ffi::dsm_shutdown()
    }
}


#[cfg(native_rtc)]
mod native {
    use super::ffi;
    use std::ffi::{CStr, CString};
    use std::ptr;

    pub fn create_device(router_rtp_capabilities: &str) -> Result<*mut ffi::dsm_device_t, String> {
        let caps = CString::new(router_rtp_capabilities).map_err(|e| e.to_string())?;
        let mut error: i32 = 0;
        let device = unsafe { ffi::dsm_create_device(caps.as_ptr(), &mut error) };
        if device.is_null() {
            Err(format!("dsm_create_device failed (error {})", error))
        } else {
            Ok(device)
        }
    }

    pub fn destroy_device(device: *mut ffi::dsm_device_t) {
        unsafe { ffi::dsm_destroy_device(device) }
    }

    pub fn create_send_transport(
        device: *mut ffi::dsm_device_t,
        id: &str,
        ice_parameters_json: &str,
        ice_candidates_json: &str,
        dtls_parameters_json: &str,
        app_data_json: Option<&str>,
    ) -> Result<*mut ffi::dsm_send_transport_t, String> {
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
            ffi::dsm_create_send_transport(
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
            Err(format!("dsm_create_send_transport failed (error {})", error))
        } else {
            Ok(transport)
        }
    }

    pub fn create_recv_transport(
        device: *mut ffi::dsm_device_t,
        id: &str,
        ice_parameters_json: &str,
        ice_candidates_json: &str,
        dtls_parameters_json: &str,
        app_data_json: Option<&str>,
    ) -> Result<*mut ffi::dsm_recv_transport_t, String> {
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
            ffi::dsm_create_recv_transport(
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
            Err(format!("dsm_create_recv_transport failed (error {})", error))
        } else {
            Ok(transport)
        }
    }

    pub fn poll_action() -> ffi::dsm_action_t {
        unsafe { ffi::dsm_poll_action() }
    }

    pub fn complete_connect(transport_ptr: *mut std::ffi::c_void) {
        unsafe { ffi::dsm_complete_connect(transport_ptr) }
    }

    pub fn fail_connect(transport_ptr: *mut std::ffi::c_void, error: &str) {
        let c_err = CString::new(error).unwrap_or_default();
        unsafe { ffi::dsm_fail_connect(transport_ptr, c_err.as_ptr()) }
    }

    pub fn complete_produce(action_id: u64, producer_id: &str) {
        let c_id = CString::new(producer_id).unwrap_or_default();
        unsafe { ffi::dsm_complete_produce(action_id, c_id.as_ptr()) }
    }

    pub fn fail_produce(action_id: u64, error: &str) {
        let c_err = CString::new(error).unwrap_or_default();
        unsafe { ffi::dsm_fail_produce(action_id, c_err.as_ptr()) }
    }
}


#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NativeMediaCapabilities {
    pub native_rtc: bool,
    pub screen_video: bool,
    pub screen_audio: bool,
    pub microphone: bool,
    pub camera: bool,
    pub audio_receive: bool,
    pub video_receive: bool,
    pub p2p: bool,
    pub sfu: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NativeMediaState {
    pub initialized: bool,
    pub connected: bool,
    pub session: Option<Value>,
    pub topology: Option<Value>,
    pub ice_servers: Vec<Value>,
    pub capabilities: NativeMediaCapabilities,
    pub tracks: BTreeMap<String, Value>,
    pub native_backend_ready: bool,
}

pub struct NativeMediaStore {
    pub state: Arc<Mutex<NativeMediaState>>,
}

impl Default for NativeMediaStore {
    fn default() -> Self {
        Self {
            state: Arc::new(Mutex::new(NativeMediaState::default())),
        }
    }
}

fn lock_state<'a>(
    store: &'a State<'_, NativeMediaStore>,
) -> Result<std::sync::MutexGuard<'a, NativeMediaState>, String> {
    store
        .state
        .lock()
        .map_err(|_| "native media state lock poisoned".to_string())
}

fn emit_state(app: &AppHandle, state: &NativeMediaState) {
    let _ = app.emit(MEDIA_EVENT_STATE, state);
}


#[tauri::command]
pub async fn media_initialize(
    app: AppHandle,
    store: State<'_, NativeMediaStore>,
    config: Value,
) -> Result<NativeMediaState, String> {
    let snapshot = {
        let mut state = lock_state(&store)?;

        let native_backend_ok = try_native_initialize();

        if native_backend_ok {
            state.initialized = true;
            if let Some(caps) = native_capabilities_value().as_object() {
                if let Ok(parsed) =
                    serde_json::from_value::<NativeMediaCapabilities>(
                        Value::Object(caps.clone()),
                    )
                {
                    state.capabilities = parsed;
                }
            }
            state.native_backend_ready = true;
        } else {
            state.initialized = true;
            if let Some(capabilities) = config.get("capabilities") {
                if let Ok(value) = serde_json::from_value(capabilities.clone()) {
                    state.capabilities = value;
                }
            }
        }

        state.clone()
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
pub async fn media_leave(
    app: AppHandle,
    store: State<'_, NativeMediaStore>,
) -> Result<(), String> {
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
pub async fn media_get_state(
    store: State<'_, NativeMediaStore>,
) -> Result<NativeMediaState, String> {
    let state = lock_state(&store)?;
    Ok(state.clone())
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
pub async fn media_get_stats(
    store: State<'_, NativeMediaStore>,
) -> Result<Value, String> {
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
    _store: State<'_, NativeMediaStore>,
) -> Result<Vec<Value>, String> {
    Ok(vec![])
}

#[tauri::command]
pub async fn media_select_capture_source(
    _store: State<'_, NativeMediaStore>,
    _source_id: String,
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn media_start_screen_share(
    app: AppHandle,
    store: State<'_, NativeMediaStore>,
) -> Result<(), String> {
    let snapshot = {
        let state = lock_state(&store)?;
        if !state.native_backend_ready || !state.capabilities.native_rtc {
            return Err("native media backend is unavailable".to_string());
        }
        #[cfg(native_rtc)]
        {
            let display_id = state
                .session
                .as_ref()
                .and_then(|value| value.get("screenDisplayId"))
                .and_then(Value::as_u64)
                .unwrap_or(0);
            let mut error = 0;
            let result = unsafe { ffi::dsm_start_screen_capture(display_id, &mut error) };
            if result != 0 {
                return Err(format!("native screen capture failed (error {})", error));
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
pub async fn media_stop_screen_share(
    app: AppHandle,
    store: State<'_, NativeMediaStore>,
) -> Result<(), String> {
    let snapshot = {
        let state = lock_state(&store)?;
        if !state.capabilities.native_rtc {
            return Err("native media backend is unavailable".to_string());
        }
        #[cfg(native_rtc)]
        {
            let mut error = 0;
            let result = unsafe { ffi::dsm_stop_screen_capture(&mut error) };
            if result != 0 {
                return Err(format!("native stop screen capture failed (error {})", error));
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
    _store: State<'_, NativeMediaStore>,
    router_rtp_capabilities: String,
) -> Result<Value, String> {
    let device = native::create_device(&router_rtp_capabilities)?;
    Ok(serde_json::json!({ "handle": device as u64 }))
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_create_send_transport(
    _store: State<'_, NativeMediaStore>,
    device_handle: u64,
    id: String,
    ice_parameters: Value,
    ice_candidates: Value,
    dtls_parameters: Value,
    app_data: Option<Value>,
) -> Result<Value, String> {
    let device = device_handle as *mut ffi::dsm_device_t;
    let app_data_json = app_data.as_ref().map(|v| v.to_string());
    let transport = native::create_send_transport(
        device,
        &id,
        &ice_parameters.to_string(),
        &ice_candidates.to_string(),
        &dtls_parameters.to_string(),
        app_data_json.as_deref(),
    )?;
    Ok(serde_json::json!({ "handle": transport as u64 }))
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_create_recv_transport(
    _store: State<'_, NativeMediaStore>,
    device_handle: u64,
    id: String,
    ice_parameters: Value,
    ice_candidates: Value,
    dtls_parameters: Value,
    app_data: Option<Value>,
) -> Result<Value, String> {
    let device = device_handle as *mut ffi::dsm_device_t;
    let app_data_json = app_data.as_ref().map(|v| v.to_string());
    let transport = native::create_recv_transport(
        device,
        &id,
        &ice_parameters.to_string(),
        &ice_candidates.to_string(),
        &dtls_parameters.to_string(),
        app_data_json.as_deref(),
    )?;
    Ok(serde_json::json!({ "handle": transport as u64 }))
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_poll_action(
    _store: State<'_, NativeMediaStore>,
) -> Result<Value, String> {
    let action = native::poll_action();
    let params = if action.params_json.is_null() {
        None
    } else {
        let s = unsafe { std::ffi::CStr::from_ptr(action.params_json) };
        Some(s.to_str().unwrap_or("").to_string())
    };
    let state = if action.state.is_null() {
        None
    } else {
        let s = unsafe { std::ffi::CStr::from_ptr(action.state) };
        Some(s.to_str().unwrap_or("").to_string())
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
pub async fn media_poll_action(
    _store: State<'_, NativeMediaStore>,
) -> Result<Value, String> {
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
pub async fn media_get_devices(
    _store: State<'_, NativeMediaStore>,
) -> Result<Vec<Value>, String> {
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
    _store: State<'_, NativeMediaStore>,
) -> Result<(), String> {
    #[cfg(native_rtc)]
    {
        let state = lock_state(&store)?;
        if !state.native_backend_ready || !state.capabilities.native_rtc {
            return Err("native media backend is unavailable".to_string());
        }
        let mut error = 0;
        let result = unsafe { ffi::dsm_start_system_audio_capture(&mut error) };
        if result != 0 {
            return Err(format!("native system audio capture failed (error {})", error));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn media_stop_system_audio(
    _store: State<'_, NativeMediaStore>,
) -> Result<(), String> {
    #[cfg(native_rtc)]
    unsafe {
        ffi::dsm_stop_system_audio_capture();
    }
    Ok(())
}
