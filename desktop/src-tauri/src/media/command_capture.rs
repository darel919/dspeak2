#[cfg(native_rtc)]
use super::ffi;
#[cfg(native_rtc)]
use super::startup::{call_native_shutdown, native_capabilities_value, try_native_initialize};
use super::state::{lock_state, NativeMediaStore};
use super::types::{capture_error, validate_capture_request, NativeMediaError};
use serde_json::Value;
#[cfg(native_rtc)]
use std::ffi::{CStr, CString};
use tauri::{AppHandle, State};

#[cfg(native_rtc)]
fn native_capture_sources() -> Result<Vec<Value>, String> {
    let pointer = unsafe { ffi::lib_dspeak_media_list_capture_sources() };
    if pointer.is_null() {
        return Err("native capture source enumeration failed".to_string());
    }
    let text = unsafe { CStr::from_ptr(pointer) }
        .to_str()
        .map(str::to_owned)
        .map_err(|_| "native source JSON was not UTF-8".to_string());
    unsafe { ffi::lib_dspeak_media_free_string(pointer) };
    let text = text?;
    serde_json::from_str(&text).map_err(|_| "native source JSON was invalid".to_string())
}

#[cfg(native_rtc)]
fn native_capture_devices() -> Result<Vec<Value>, String> {
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
    serde_json::from_str(&text).map_err(|_| "native media device list was invalid JSON".to_string())
}

#[cfg(native_rtc)]
fn assert_native_capture_source(source_id: &str, operation: &str) -> Result<(), NativeMediaError> {
    let available = native_capture_sources()
        .map_err(|message| {
            capture_error("DESKTOP_CAPTURE_ENUMERATION_FAILED", operation, &message)
        })?
        .into_iter()
        .any(|source| {
            source.get("sourceId").and_then(Value::as_str) == Some(source_id)
                && source.get("available") == Some(&Value::Bool(true))
        });
    if available {
        return Ok(());
    }
    Err(capture_error(
        "DESKTOP_CAPTURE_SOURCE_UNAVAILABLE",
        operation,
        "The selected native capture source is no longer available",
    ))
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
        native_capture_sources().map_err(|message| {
            capture_error("DESKTOP_CAPTURE_ENUMERATION_FAILED", "enumerate", &message)
        })
    }
    #[cfg(not(native_rtc))]
    Err(capture_error(
        "DESKTOP_CAPTURE_NATIVE_UNAVAILABLE",
        "enumerate",
        "native media backend is unavailable",
    ))
}

#[tauri::command]
pub async fn media_prepare_capture(
    store: State<'_, NativeMediaStore>,
) -> Result<Value, NativeMediaError> {
    let _lifecycle = store.lifecycle.lock().map_err(|_| {
        capture_error(
            "DESKTOP_CAPTURE_NATIVE_UNAVAILABLE",
            "prepare",
            "native media lifecycle lock poisoned",
        )
    })?;
    let state = store.state.lock().map_err(|_| {
        capture_error(
            "DESKTOP_CAPTURE_NATIVE_UNAVAILABLE",
            "prepare",
            "native media state lock poisoned",
        )
    })?;
    if state.initialized {
        if !state.capabilities.native_rtc || !state.native_backend_ready {
            return Err(capture_error(
                "DESKTOP_CAPTURE_NATIVE_UNAVAILABLE",
                "prepare",
                "native media backend is unavailable",
            ));
        }
        let capabilities = serde_json::to_value(&state.capabilities).map_err(|_| {
            capture_error(
                "DESKTOP_CAPTURE_CAPABILITIES_FAILED",
                "prepare",
                "native media capabilities could not be serialized",
            )
        })?;
        drop(state);
        #[cfg(native_rtc)]
        {
            let sources = native_capture_sources().map_err(|message| {
                capture_error("DESKTOP_CAPTURE_ENUMERATION_FAILED", "prepare", &message)
            })?;
            return Ok(serde_json::json!({
                "capabilities": capabilities,
                "sources": sources,
            }));
        }
        #[cfg(not(native_rtc))]
        {
            let _ = capabilities;
            return Err(capture_error(
                "DESKTOP_CAPTURE_NATIVE_UNAVAILABLE",
                "prepare",
                "native media backend is unavailable",
            ));
        }
    }
    drop(state);

    #[cfg(native_rtc)]
    {
        if !try_native_initialize() {
            return Err(capture_error(
                "DESKTOP_CAPTURE_NATIVE_UNAVAILABLE",
                "prepare",
                "native media backend is unavailable",
            ));
        }
        let capabilities = native_capabilities_value();
        let sources = match native_capture_sources() {
            Ok(sources) => sources,
            Err(message) => {
                call_native_shutdown();
                return Err(capture_error(
                    "DESKTOP_CAPTURE_ENUMERATION_FAILED",
                    "prepare",
                    &message,
                ));
            }
        };
        call_native_shutdown();
        return Ok(serde_json::json!({
            "capabilities": capabilities,
            "sources": sources,
        }));
    }
    #[cfg(not(native_rtc))]
    Err(capture_error(
        "DESKTOP_CAPTURE_NATIVE_UNAVAILABLE",
        "prepare",
        "native media backend is unavailable",
    ))
}

#[tauri::command]
pub async fn media_prepare_devices(
    store: State<'_, NativeMediaStore>,
) -> Result<Vec<Value>, String> {
    let _lifecycle = store
        .lifecycle
        .lock()
        .map_err(|_| "native media lifecycle lock poisoned".to_string())?;
    let state = store
        .state
        .lock()
        .map_err(|_| "native media state lock poisoned".to_string())?;
    if state.initialized {
        if !state.capabilities.native_rtc || !state.native_backend_ready {
            return Err("native media backend is unavailable".to_string());
        }
        drop(state);
        #[cfg(native_rtc)]
        return native_capture_devices();
        #[cfg(not(native_rtc))]
        return Err("native media backend is unavailable".to_string());
    }
    drop(state);

    #[cfg(native_rtc)]
    {
        if !try_native_initialize() {
            return Err("native media backend is unavailable".to_string());
        }
        let devices = native_capture_devices();
        call_native_shutdown();
        return devices;
    }
    #[cfg(not(native_rtc))]
    Err("native media backend is unavailable".to_string())
}

#[tauri::command]
pub async fn media_select_capture_source(
    store: State<'_, NativeMediaStore>,
    source_id: String,
) -> Result<(), String> {
    let state = store
        .state
        .lock()
        .map_err(|_| "native media state lock poisoned".to_string())?;
    if !state.native_backend_ready || !state.capabilities.native_rtc {
        return Err("native media backend is unavailable".to_string());
    }
    drop(state);
    #[cfg(native_rtc)]
    {
        assert_native_capture_source(&source_id, "select").map_err(|error| error.message)?;
        Ok(())
    }
    #[cfg(not(native_rtc))]
    {
        let _ = source_id;
        Err("native media backend not available".to_string())
    }
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
    assert_native_capture_source(
        request
            .as_ref()
            .and_then(|value| value.get("captureSelection"))
            .and_then(|value| value.get("sourceId"))
            .and_then(Value::as_str)
            .unwrap_or_default(),
        "screen-video",
    )?;
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
        Ok(())
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
    #[cfg(native_rtc)]
    {
        let state = store.state.lock().map_err(|_| {
            capture_error(
                "DESKTOP_CAPTURE_NATIVE_UNAVAILABLE",
                "screen-video-replace",
                "native media state lock poisoned",
            )
        })?;
        if !state.native_backend_ready || !state.capabilities.native_rtc {
            return Err(capture_error(
                "DESKTOP_CAPTURE_NATIVE_UNAVAILABLE",
                "screen-video-replace",
                "native media backend is unavailable",
            ));
        }
        drop(state);
        let mut error = 0;
        let result = unsafe { ffi::lib_dspeak_media_stop_capture(&mut error) };
        if result != 0 {
            return Err(capture_error(
                "DESKTOP_CAPTURE_STOP_FAILED",
                "screen-video-replace",
                &format!("native screen capture could not be replaced (error {error})"),
            ));
        }
    }
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
        Ok(())
    }
    #[cfg(not(native_rtc))]
    {
        let _ = store;
        let _ = device_id;
        Err("native media backend not available".to_string())
    }
}

#[tauri::command]
pub async fn media_set_camera_device(
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
            CString::new(device_id).map_err(|_| "camera device id is invalid".to_string())?;
        let mut error = 0;
        let result =
            unsafe { ffi::lib_dspeak_media_set_camera_device(device_id.as_ptr(), &mut error) };
        if result != 0 {
            return Err(format!(
                "native camera device selection failed (error {})",
                error
            ));
        }
        Ok(())
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
            CString::new(device_id).map_err(|_| "output device id is invalid".to_string())?;
        let result = unsafe { ffi::lib_dspeak_media_set_output_device(device_id.as_ptr()) };
        if result != 0 {
            return Err("native audio output selection failed".to_string());
        }
        Ok(())
    }
    #[cfg(not(native_rtc))]
    {
        let _ = store;
        let _ = device_id;
        Err("native media backend not available".to_string())
    }
}

#[tauri::command]
pub async fn media_set_local_video_preview(
    store: State<'_, NativeMediaStore>,
    source: String,
    enabled: bool,
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
        let source = CString::new(source)
            .map_err(|_| "native local preview source is invalid".to_string())?;
        let result =
            unsafe { ffi::lib_dspeak_media_set_local_video_preview(source.as_ptr(), enabled) };
        if result != 0 {
            return Err("native local video preview could not be changed".to_string());
        }
        Ok(())
    }
    #[cfg(not(native_rtc))]
    {
        let _ = store;
        let _ = source;
        let _ = enabled;
        Err("native media backend not available".to_string())
    }
}

#[tauri::command]
pub async fn media_set_shared_audio_volume(
    store: State<'_, NativeMediaStore>,
    volume: f64,
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
        let result = unsafe { ffi::lib_dspeak_media_set_shared_audio_volume(volume) };
        if result != 0 {
            return Err("native shared audio volume could not be changed".to_string());
        }
        Ok(())
    }
    #[cfg(not(native_rtc))]
    {
        let _ = store;
        let _ = volume;
        Err("native media backend not available".to_string())
    }
}

#[tauri::command]
pub async fn media_set_shared_audio_attenuation(
    store: State<'_, NativeMediaStore>,
    enabled: bool,
    reduction_percent: f64,
    attack_ms: i32,
    release_ms: i32,
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
        let result = unsafe {
            ffi::lib_dspeak_media_set_shared_audio_attenuation(
                i32::from(enabled),
                reduction_percent,
                attack_ms,
                release_ms,
            )
        };
        if result != 0 {
            return Err("native shared audio attenuation could not be changed".to_string());
        }
        Ok(())
    }
    #[cfg(not(native_rtc))]
    {
        let _ = store;
        let _ = enabled;
        let _ = reduction_percent;
        let _ = attack_ms;
        let _ = release_ms;
        Err("native media backend not available".to_string())
    }
}

#[tauri::command]
pub async fn media_get_audio_levels(store: State<'_, NativeMediaStore>) -> Result<Value, String> {
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
        let pointer = unsafe { ffi::lib_dspeak_media_get_audio_levels() };
        if pointer.is_null() {
            return Err("native audio telemetry is unavailable".to_string());
        }
        let text = unsafe { CStr::from_ptr(pointer) }
            .to_str()
            .map(str::to_owned)
            .map_err(|_| "native audio telemetry was not UTF-8".to_string());
        unsafe { ffi::lib_dspeak_media_free_string(pointer) };
        let text = text?;
        serde_json::from_str(&text)
            .map_err(|_| "native audio telemetry was invalid JSON".to_string())
    }
    #[cfg(not(native_rtc))]
    {
        let _ = store;
        Err("native media backend not available".to_string())
    }
}

#[tauri::command]
pub async fn media_start_microphone_check(
    store: State<'_, NativeMediaStore>,
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
        let result = unsafe { ffi::lib_dspeak_media_start_microphone_check() };
        if result != 0 {
            return Err(format!(
                "native microphone check could not start (error {result})"
            ));
        }
        Ok(())
    }
    #[cfg(not(native_rtc))]
    {
        let _ = store;
        Err("native media backend not available".to_string())
    }
}

#[tauri::command]
pub async fn media_stop_microphone_check(
    store: State<'_, NativeMediaStore>,
) -> Result<Vec<u8>, String> {
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
        let mut length = 0usize;
        let pointer = unsafe { ffi::lib_dspeak_media_stop_microphone_check(&mut length) };
        if pointer.is_null() {
            return Err("native microphone check returned no recording".to_string());
        }
        let bytes = unsafe { std::slice::from_raw_parts(pointer, length).to_vec() };
        unsafe { ffi::lib_dspeak_media_free_buffer(pointer) };
        Ok(bytes)
    }
    #[cfg(not(native_rtc))]
    {
        let _ = store;
        Err("native media backend not available".to_string())
    }
}

#[tauri::command]
pub async fn media_get_devices(store: State<'_, NativeMediaStore>) -> Result<Vec<Value>, String> {
    media_prepare_devices(store).await
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
        Ok(())
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
    video_settings: Option<Value>,
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
        let settings = serde_json::to_string(
            &video_settings.unwrap_or_else(|| Value::Object(Default::default())),
        )
        .map_err(|_| "native camera settings could not be serialized".to_string())?;
        let settings =
            CString::new(settings).map_err(|_| "native camera settings are invalid".to_string())?;
        let mut error = 0;
        let result = unsafe {
            if enabled {
                ffi::lib_dspeak_media_start_camera_capture(settings.as_ptr(), &mut error)
            } else {
                ffi::lib_dspeak_media_stop_camera_capture(&mut error)
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
            return Err(format!(
                "native camera capture failed (error {error}): {detail}"
            ));
        }
        Ok(())
    }
    #[cfg(not(native_rtc))]
    {
        let _ = store;
        let _ = enabled;
        let _ = video_settings;
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
    assert_native_capture_source(
        request
            .as_ref()
            .and_then(|value| value.get("captureSelection"))
            .and_then(|value| value.get("sourceId"))
            .and_then(Value::as_str)
            .unwrap_or_default(),
        "system-audio",
    )?;
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
        Ok(())
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
    #[cfg(native_rtc)]
    {
        let state = store.state.lock().map_err(|_| {
            capture_error(
                "DESKTOP_CAPTURE_NATIVE_UNAVAILABLE",
                "system-audio-replace",
                "native media state lock poisoned",
            )
        })?;
        if !state.native_backend_ready || !state.capabilities.native_rtc {
            return Err(capture_error(
                "DESKTOP_CAPTURE_NATIVE_UNAVAILABLE",
                "system-audio-replace",
                "native media backend is unavailable",
            ));
        }
        drop(state);
        unsafe { ffi::lib_dspeak_media_stop_system_audio_capture() };
    }
    media_start_system_audio(store, request).await
}

#[tauri::command]
pub async fn media_stop_system_audio(
    store: State<'_, NativeMediaStore>,
    _source: Option<Value>,
) -> Result<(), String> {
    let state = store
        .state
        .lock()
        .map_err(|_| "native media state lock poisoned".to_string())?;
    if !state.native_backend_ready || !state.capabilities.native_rtc {
        return Err("native media backend is unavailable".to_string());
    }
    drop(state);
    #[cfg(native_rtc)]
    unsafe {
        ffi::lib_dspeak_media_stop_system_audio_capture();
    }
    Ok(())
}
