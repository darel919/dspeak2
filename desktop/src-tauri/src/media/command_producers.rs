use super::state::NativeMediaStore;
#[cfg(native_rtc)]
use super::{ffi, native};
use serde_json::Value;
#[cfg(native_rtc)]
use std::ffi::CStr;
use tauri::State;

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
        handles.producers.remove(source);
        unsafe { ffi::lib_dspeak_media_destroy_producer(producer) };
        return Err("native producer did not return an identifier".to_string());
    }
    let producer_id = unsafe { CStr::from_ptr(id) }
        .to_str()
        .map(str::to_owned)
        .map_err(|_| "native producer identifier is not UTF-8".to_string());
    unsafe { ffi::lib_dspeak_media_free_string(id) };
    match producer_id {
        Ok(producer_id) => Ok(serde_json::json!({ "id": producer_id })),
        Err(error) => {
            handles.producers.remove(source);
            unsafe { ffi::lib_dspeak_media_destroy_producer(producer) };
            Err(error)
        }
    }
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
