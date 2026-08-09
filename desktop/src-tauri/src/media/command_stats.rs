#[cfg(native_rtc)]
use super::command_consumers::consumer_index;
use super::state::NativeMediaStore;
#[cfg(native_rtc)]
use super::{ffi, native};
use serde_json::Value;
#[cfg(native_rtc)]
use std::ffi::{CStr, CString};
use tauri::State;

#[cfg(native_rtc)]
fn producer_by_id(
    handles: &super::state::NativeHandleRegistry,
    producer_id: &str,
) -> Option<*mut ffi::lib_dspeak_media_producer_t> {
    handles
        .producers
        .values()
        .find(|producer| {
            let pointer = unsafe { ffi::lib_dspeak_media_producer_get_id(**producer) };
            if pointer.is_null() {
                return false;
            }
            let matches = unsafe { CStr::from_ptr(pointer) }
                .to_str()
                .map(|value| value == producer_id)
                .unwrap_or(false);
            unsafe { ffi::lib_dspeak_media_free_string(pointer) };
            matches
        })
        .copied()
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_restart_send_transport_ice(
    store: State<'_, NativeMediaStore>,
) -> Result<Value, String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    if handles.send_transport.is_null() {
        return Err("native send transport is not ready".to_string());
    }
    native::send_transport_restart_ice(handles.send_transport)
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_restart_recv_transport_ice(
    store: State<'_, NativeMediaStore>,
) -> Result<Value, String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    if handles.recv_transport.is_null() {
        return Err("native recv transport is not ready".to_string());
    }
    native::recv_transport_restart_ice(handles.recv_transport)
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_get_transport_stats(
    store: State<'_, NativeMediaStore>,
    direction: String,
) -> Result<Value, String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    match direction.as_str() {
        "send" => {
            if handles.send_transport.is_null() {
                return Err("native send transport is not ready".to_string());
            }
            let json_str = native::send_transport_get_stats(handles.send_transport)?;
            serde_json::from_str(&json_str).map_err(|error| error.to_string())
        }
        "recv" => {
            if handles.recv_transport.is_null() {
                return Err("native recv transport is not ready".to_string());
            }
            let json_str = native::recv_transport_get_stats(handles.recv_transport)?;
            serde_json::from_str(&json_str).map_err(|error| error.to_string())
        }
        _ => Err(format!("unknown transport direction: {direction}")),
    }
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_get_producer_stats(
    store: State<'_, NativeMediaStore>,
    producer_id: String,
) -> Result<Value, String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let producer = producer_by_id(&handles, &producer_id)
        .ok_or_else(|| "native producer is not owned by this session".to_string())?;
    let json_str = native::producer_get_stats(producer)?;
    serde_json::from_str(&json_str).map_err(|error| error.to_string())
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_get_consumer_stats(
    store: State<'_, NativeMediaStore>,
    consumer_id: String,
) -> Result<Value, String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let index = consumer_index(&handles, &consumer_id)
        .ok_or_else(|| "native consumer is not owned by this session".to_string())?;
    let json_str = native::consumer_get_stats(handles.consumers[index])?;
    serde_json::from_str(&json_str).map_err(|error| error.to_string())
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_replace_producer_track(
    store: State<'_, NativeMediaStore>,
    producer_id: String,
    source: String,
    kind: String,
) -> Result<(), String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let producer = producer_by_id(&handles, &producer_id)
        .ok_or_else(|| "native producer is not owned by this session".to_string())?;
    let c_source = CString::new(source.as_str()).map_err(|error| error.to_string())?;
    if kind == "video" {
        let track = unsafe { ffi::lib_dspeak_media_get_video_track(c_source.as_ptr()) };
        if track.is_null() {
            return Err("native video capture track is unavailable".to_string());
        }
        native::producer_replace_video_track(producer, track)?;
    } else if kind == "audio" {
        let track = unsafe { ffi::lib_dspeak_media_get_audio_track(c_source.as_ptr()) };
        if track.is_null() {
            return Err("native audio capture track is unavailable".to_string());
        }
        native::producer_replace_audio_track(producer, track)?;
    } else {
        return Err("native producer track kind is invalid".to_string());
    }
    Ok(())
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_set_consumer_jitter_buffer(
    store: State<'_, NativeMediaStore>,
    consumer_id: String,
    min_delay_ms: i32,
    target_delay_ms: i32,
) -> Result<(), String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let index = consumer_index(&handles, &consumer_id)
        .ok_or_else(|| "native consumer is not owned by this session".to_string())?;
    native::consumer_set_jitter_buffer(handles.consumers[index], min_delay_ms, target_delay_ms)
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_restart_send_transport_ice(
    _store: State<'_, NativeMediaStore>,
) -> Result<Value, String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_restart_recv_transport_ice(
    _store: State<'_, NativeMediaStore>,
) -> Result<Value, String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_get_transport_stats(
    _store: State<'_, NativeMediaStore>,
    _direction: String,
) -> Result<Value, String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_get_producer_stats(
    _store: State<'_, NativeMediaStore>,
    _producer_id: String,
) -> Result<Value, String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_get_consumer_stats(
    _store: State<'_, NativeMediaStore>,
    _consumer_id: String,
) -> Result<Value, String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_replace_producer_track(
    _store: State<'_, NativeMediaStore>,
    _producer_id: String,
    _source: String,
    _kind: String,
) -> Result<(), String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_set_consumer_jitter_buffer(
    _store: State<'_, NativeMediaStore>,
    _consumer_id: String,
    _min_delay_ms: i32,
    _target_delay_ms: i32,
) -> Result<(), String> {
    Err("native media backend not available".to_string())
}
