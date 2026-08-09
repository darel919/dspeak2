#[cfg(native_rtc)]
use super::ffi;
#[cfg(native_rtc)]
use super::native;
use super::state::NativeMediaStore;
#[cfg(native_rtc)]
use base64::Engine;
use serde_json::Value;
#[cfg(native_rtc)]
use std::ffi::CStr;
use tauri::State;

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_poll_action(_store: State<'_, NativeMediaStore>) -> Result<Value, String> {
    let action = native::poll_action();
    let params_ptr = action.params_json;
    let params = if params_ptr.is_null() {
        None
    } else {
        let s = unsafe { CStr::from_ptr(params_ptr) };
        let value = Some(s.to_str().unwrap_or("").to_string());
        unsafe { ffi::lib_dspeak_media_free_string(params_ptr) };
        value
    };
    let state_ptr = action.state;
    let state = if state_ptr.is_null() {
        None
    } else {
        let s = unsafe { CStr::from_ptr(state_ptr) };
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
