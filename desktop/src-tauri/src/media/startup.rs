#[cfg(native_rtc)]
use super::ffi;
use serde_json::Value;
#[cfg(native_rtc)]
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
