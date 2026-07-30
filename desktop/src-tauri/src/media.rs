//! Native media control-plane state and Tauri commands.
//!
//! This module deliberately does not pretend to be a WebRTC implementation. It
//! provides the stable, typed control/event boundary required by the frontend
//! while the platform media core is integrated behind the same commands. The
//! default state is browser-compatible: native media is unavailable unless a
//! real backend reports capabilities at runtime.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

pub const MEDIA_EVENT_STATE: &str = "media:state";
pub const MEDIA_EVENT_SIGNAL: &str = "media:signal";
pub const MEDIA_EVENT_STATS: &str = "media:stats";
pub const MEDIA_EVENT_DEVICE_CHANGE: &str = "media:device-change";
pub const MEDIA_EVENT_PERMISSION: &str = "media:permission";
pub const MEDIA_EVENT_ERROR: &str = "media:error";

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
        state.initialized = true;
        // Runtime capabilities come from a linked native backend. The current
        // control-plane build intentionally exposes no native transport.
        if let Some(capabilities) = config.get("capabilities") {
            if let Ok(value) = serde_json::from_value(capabilities.clone()) {
                state.capabilities = value;
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
        *state = NativeMediaState::default();
        state.clone()
    };
    emit_state(&app, &snapshot);
    Ok(())
}

#[tauri::command]
pub async fn media_set_topology(
    app: AppHandle,
    store: State<'_, NativeMediaStore>,
    topology: Value,
) -> Result<(), String> {
    let snapshot = {
        let mut state = lock_state(&store)?;
        state.topology = Some(topology);
        state.clone()
    };
    emit_state(&app, &snapshot);
    Ok(())
}

#[tauri::command]
pub async fn media_set_ice_servers(
    store: State<'_, NativeMediaStore>,
    ice_servers: Vec<Value>,
) -> Result<(), String> {
    lock_state(&store)?.ice_servers = ice_servers;
    Ok(())
}

#[tauri::command]
pub async fn media_handle_signal(
    app: AppHandle,
    message: Value,
) -> Result<(), String> {
    app.emit(MEDIA_EVENT_SIGNAL, message)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn media_get_devices() -> Result<Vec<Value>, String> {
    // Device enumeration is backend/platform-specific and must be supplied by
    // the native media core. Returning an empty typed list is safer than
    // reporting fake devices or asking the system WebView for native devices.
    Ok(Vec::new())
}

#[tauri::command]
pub async fn media_list_capture_sources() -> Result<Vec<Value>, String> {
    Ok(Vec::new())
}

#[tauri::command]
pub async fn media_get_permissions() -> Result<Value, String> {
    Ok(serde_json::json!({
        "microphone": "unknown",
        "camera": "unknown",
        "screen": "unknown",
        "systemAudio": "unknown",
    }))
}

#[tauri::command]
pub async fn media_select_capture_source(
    store: State<'_, NativeMediaStore>,
    source: Value,
) -> Result<(), String> {
    if !lock_state(&store)?.capabilities.screen_video {
        return Err("native screen-share backend is unavailable".to_string());
    }
    let _ = source;
    Ok(())
}

#[tauri::command]
pub async fn media_get_capabilities(
    store: State<'_, NativeMediaStore>,
) -> Result<NativeMediaCapabilities, String> {
    Ok(lock_state(&store)?.capabilities.clone())
}

#[tauri::command]
pub async fn media_get_stats(store: State<'_, NativeMediaStore>) -> Result<Value, String> {
    let state = lock_state(&store)?;
    Ok(serde_json::json!({
        "engine": "native",
        "connected": state.connected,
        "initialized": state.initialized,
        "capabilities": state.capabilities,
    }))
}

#[tauri::command]
pub async fn media_set_microphone(
    store: State<'_, NativeMediaStore>,
    enabled: bool,
) -> Result<(), String> {
    if enabled && !lock_state(&store)?.capabilities.microphone {
        return Err("native microphone backend is unavailable".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn media_set_microphone_device(
    store: State<'_, NativeMediaStore>,
    device_id: String,
) -> Result<(), String> {
    if !lock_state(&store)?.capabilities.microphone {
        return Err("native microphone backend is unavailable".to_string());
    }
    let _ = device_id;
    Ok(())
}

#[tauri::command]
pub async fn media_set_output_device(
    store: State<'_, NativeMediaStore>,
    device_id: String,
) -> Result<(), String> {
    if !lock_state(&store)?.capabilities.audio_receive {
        return Err("native audio output backend is unavailable".to_string());
    }
    let _ = device_id;
    Ok(())
}

#[tauri::command]
pub async fn media_set_camera(
    store: State<'_, NativeMediaStore>,
    enabled: bool,
) -> Result<(), String> {
    if enabled && !lock_state(&store)?.capabilities.camera {
        return Err("native camera backend is unavailable".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn media_start_screen_share(
    store: State<'_, NativeMediaStore>,
    _options: Value,
) -> Result<(), String> {
    if !lock_state(&store)?.capabilities.screen_video {
        return Err("native screen-share backend is unavailable".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn media_stop_screen_share() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn media_start_system_audio(
    store: State<'_, NativeMediaStore>,
    _options: Value,
) -> Result<(), String> {
    if !lock_state(&store)?.capabilities.screen_audio {
        return Err("native system-audio backend is unavailable".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn media_stop_system_audio() -> Result<(), String> {
    Ok(())
}

#[allow(dead_code)]
pub fn emit_stats(app: &AppHandle, stats: Value) {
    let _ = app.emit(MEDIA_EVENT_STATS, stats);
}

#[allow(dead_code)]
pub fn emit_device_change(app: &AppHandle, devices: Vec<Value>) {
    let _ = app.emit(MEDIA_EVENT_DEVICE_CHANGE, devices);
}

#[allow(dead_code)]
pub fn emit_permission(app: &AppHandle, permission: Value) {
    let _ = app.emit(MEDIA_EVENT_PERMISSION, permission);
}

#[allow(dead_code)]
pub fn emit_error(app: &AppHandle, error: Value) {
    let _ = app.emit(MEDIA_EVENT_ERROR, error);
}
