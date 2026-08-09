#[cfg(native_rtc)]
use super::ffi;
use super::state::NativeMediaStore;
use std::ffi::CStr;
use tauri::State;

#[cfg(native_rtc)]
pub(crate) fn consumer_index(
    handles: &super::state::NativeHandleRegistry,
    consumer_id: &str,
) -> Option<usize> {
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
