use super::startup::{call_native_shutdown, native_capabilities_value, try_native_initialize};
use super::state::{emit_state, lock_state, NativeMediaStore};
use super::types::{NativeMediaCapabilities, NativeMediaState};
use serde_json::Value;
use tauri::{AppHandle, State};

pub(crate) fn stop_native_captures() {
    #[cfg(native_rtc)]
    {
        let mut error = 0;
        unsafe {
            let _ = super::ffi::lib_dspeak_media_stop_capture(&mut error);
            super::ffi::lib_dspeak_media_stop_system_audio_capture();
            let _ = super::ffi::lib_dspeak_media_stop_microphone_capture(&mut error);
            let _ = super::ffi::lib_dspeak_media_stop_camera_capture(&mut error);
        }
    }
}

pub(crate) fn shutdown_for_exit(store: &NativeMediaStore) {
    #[cfg(native_rtc)]
    {
        if let Ok(mut handles) = store.handles.lock() {
            handles.clear_all();
        }
    }
    stop_native_captures();
    call_native_shutdown();
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
    #[cfg(native_rtc)]
    {
        return super::command_stats::collect_media_stats(&store);
    }
    #[cfg(not(native_rtc))]
    {
        let _state = lock_state(&store)?;
        Ok(serde_json::json!({
            "engine": "native",
            "topology": "sfu",
            "sampledAt": 0,
            "transports": [],
            "producers": [],
            "consumers": [],
        }))
    }
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
