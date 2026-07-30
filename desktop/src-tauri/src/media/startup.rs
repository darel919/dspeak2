#[cfg(native_rtc)]
use super::ffi;
use super::state::NativeMediaStore;
use super::types::NativeMediaCapabilities;
use serde_json::Value;
use std::ffi::CStr;

/// Call the native C++ backend initializer.  Returns true if the backend
/// is available (either because it initialised successfully, or because this
/// build does not include the native backend at all and that is the expected
/// fallback path).
pub(crate) fn try_native_initialize() -> bool {
    #[cfg(native_rtc)]
    {
        unsafe { ffi::lib_dspeak_media_initialize() == 0 }
    }
    #[cfg(not(native_rtc))]
    {
        false
    }
}

/// Query native backend capabilities.  Returned as a serde_json::Value so the
/// command layer can merge them with the current state.
pub(crate) fn native_capabilities_value() -> Value {
    #[cfg(native_rtc)]
    {
        let ptr = unsafe { ffi::lib_dspeak_media_get_capabilities() };
        if ptr.is_null() {
            return Value::Null;
        }
        let s = unsafe { CStr::from_ptr(ptr) };
        let result: Value =
            serde_json::from_str(s.to_str().unwrap_or("null")).unwrap_or(Value::Null);
        unsafe { ffi::lib_dspeak_media_free_string(ptr) };
        result
    }
    #[cfg(not(native_rtc))]
    {
        Value::Null
    }
}

pub(crate) fn call_native_shutdown() {
    #[cfg(native_rtc)]
    unsafe {
        ffi::lib_dspeak_media_shutdown()
    }
}

#[cfg(native_rtc)]
pub(crate) fn native_capture_sources_for_startup() -> Result<Vec<Value>, String> {
    let pointer = unsafe { ffi::lib_dspeak_media_list_capture_sources() };
    if pointer.is_null() {
        return Err("native capture source enumeration returned no response".to_string());
    }
    let text = unsafe { CStr::from_ptr(pointer) }
        .to_str()
        .map(str::to_owned)
        .map_err(|_| "native capture source enumeration returned invalid UTF-8".to_string());
    unsafe { ffi::lib_dspeak_media_free_string(pointer) };
    let text = text?;
    serde_json::from_str(&text)
        .map_err(|_| "native capture source enumeration returned invalid JSON".to_string())
}

#[cfg(native_rtc)]
pub(crate) fn missing_required_native_components(
    capabilities: &NativeMediaCapabilities,
) -> Vec<&'static str> {
    [
        ("nativeRtc", capabilities.native_rtc),
        ("nativeBackendReady", capabilities.native_backend_ready),
        ("microphone", capabilities.microphone),
        ("camera", capabilities.camera),
        ("screenVideo", capabilities.screen_video),
        ("screenAudio", capabilities.screen_audio),
        ("audioReceive", capabilities.audio_receive),
        ("videoReceive", capabilities.video_receive),
        ("p2p", capabilities.p2p),
        ("sfu", capabilities.sfu),
    ]
    .into_iter()
    .filter_map(|(name, available)| (!available).then_some(name))
    .collect()
}

pub fn strict_startup_check(store: &NativeMediaStore) -> Result<(), String> {
    #[cfg(not(native_rtc))]
    {
        let _ = store;
        return Err("native media backend was not compiled into this desktop build".to_string());
    }

    #[cfg(native_rtc)]
    {
        if !try_native_initialize() {
            return Err("native media backend failed to initialize".to_string());
        }

        let capabilities =
            serde_json::from_value::<NativeMediaCapabilities>(native_capabilities_value())
                .map_err(|error| format!("native media capability report is invalid: {error}"))?;
        let missing = missing_required_native_components(&capabilities);
        if !missing.is_empty() {
            return Err(format!(
                "required native media components are unavailable: {}",
                missing.join(", ")
            ));
        }

        let sources = native_capture_sources_for_startup()?;
        if sources.is_empty() {
            return Err("native capture source enumeration returned no usable sources".to_string());
        }

        let mut probe_error = 0;
        let probe_result = unsafe { ffi::lib_dspeak_media_probe_capture(1500, &mut probe_error) };
        if probe_result != 0 {
            let detail = unsafe { ffi::lib_dspeak_media_capture_error_message(probe_error) };
            let message = if detail.is_null() {
                format!("native capture health probe failed (error {probe_error})")
            } else {
                unsafe { CStr::from_ptr(detail) }
                    .to_string_lossy()
                    .into_owned()
            };
            return Err(message);
        }

        let mut state = store
            .state
            .lock()
            .map_err(|_| "native media state lock poisoned during startup".to_string())?;
        state.initialized = true;
        state.native_backend_ready = capabilities.native_backend_ready;
        state.capabilities = capabilities;
        Ok(())
    }
}
