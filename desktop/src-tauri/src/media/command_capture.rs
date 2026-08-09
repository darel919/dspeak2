#[cfg(native_rtc)]
use super::ffi;
use super::state::{lock_state, NativeMediaStore};
use super::types::{capture_error, validate_capture_request, NativeMediaError};
use serde_json::Value;
use std::ffi::{CStr, CString};
use tauri::{AppHandle, State};

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
    super::state::emit_state(&app, &guard);
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
