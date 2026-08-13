#[cfg(native_rtc)]
use super::native;
use super::state::NativeMediaStore;
use serde_json::Value;
use tauri::State;

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
