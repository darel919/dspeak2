use super::protocol::{
    native_json_string, payload_bool, payload_i32, payload_number, payload_string,
};
use super::sfu::capabilities;
use super::state::WorkerState;
use super::WorkerResult;
use crate::ffi;
use serde_json::{json, Value};
use std::ffi::{CStr, CString};

pub(super) fn list_capture_sources(state: &mut WorkerState) -> WorkerResult {
    state.ensure_initialized()?;
    capture_sources()
}

pub(super) fn capture_sources() -> WorkerResult {
    let pointer = unsafe { ffi::lib_dspeak_media_list_capture_sources() };
    native_json_string(pointer, "native capture sources")
}

pub(super) fn capture_devices() -> WorkerResult {
    let pointer = unsafe { ffi::lib_dspeak_media_list_capture_devices() };
    native_json_string(pointer, "native capture devices")
}

pub(super) fn assert_capture_source_available(request: &Value, operation: &str) -> WorkerResult {
    let selection = request
        .get("captureSelection")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            capture_error(
                "DESKTOP_CAPTURE_INVALID_REQUEST",
                operation,
                "A validated desktop capture selection is required",
            )
        })?;
    let source_id = selection
        .get("sourceId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let source_type = selection
        .get("sourceType")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let sources = capture_sources()?;
    let available = sources.as_array().is_some_and(|values| {
        values.iter().any(|source| {
            source.get("sourceId").and_then(Value::as_str) == Some(source_id)
                && source.get("sourceType").and_then(Value::as_str) == Some(source_type)
                && source.get("available") == Some(&Value::Bool(true))
        })
    });
    if available {
        return Ok(Value::Null);
    }
    Err(capture_error(
        "DESKTOP_CAPTURE_SOURCE_UNAVAILABLE",
        operation,
        "The selected native capture source is no longer available",
    ))
}

pub(super) fn required_capture_track_kinds(mode: &str) -> Vec<&'static str> {
    match mode {
        "video" => vec!["video"],
        "audio" => vec!["audio"],
        "both" => vec!["video", "audio"],
        _ => Vec::new(),
    }
}

pub(super) fn capture_track_source(kind: &str) -> &'static str {
    match kind {
        "video" => "screen",
        "audio" => "screen-audio",
        _ => "unknown",
    }
}

pub(super) fn missing_required_capture_track(
    mode: &str,
    video_available: bool,
    audio_available: bool,
) -> Option<&'static str> {
    required_capture_track_kinds(mode)
        .into_iter()
        .find(|kind| match *kind {
            "video" => !video_available,
            "audio" => !audio_available,
            _ => true,
        })
}

pub(super) fn validate_started_capture_tracks(
    request: &Value,
    operation: &str,
    system_audio: bool,
) -> WorkerResult {
    let selection = request
        .get("captureSelection")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            capture_error(
                "DESKTOP_CAPTURE_INVALID_REQUEST",
                operation,
                "A validated desktop capture selection is required",
            )
        })?;
    let mode = selection
        .get("mode")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let video_source = CString::new("screen").expect("static source has no NUL byte");
    let audio_source = CString::new("screen-audio").expect("static source has no NUL byte");
    let video_available =
        unsafe { !ffi::lib_dspeak_media_get_video_track(video_source.as_ptr()).is_null() };
    let audio_available =
        unsafe { !ffi::lib_dspeak_media_get_audio_track(audio_source.as_ptr()).is_null() };
    let Some(missing_track) =
        missing_required_capture_track(mode, video_available, audio_available)
    else {
        return Ok(Value::Null);
    };
    let missing_track_source = capture_track_source(missing_track);
    let mut stop_error = 0;
    unsafe {
        if system_audio {
            ffi::lib_dspeak_media_stop_system_audio_capture();
        } else {
            let _ = ffi::lib_dspeak_media_stop_capture(&mut stop_error);
        }
    }
    Err(json!({
        "code": "DESKTOP_CAPTURE_TRACK_UNAVAILABLE",
        "operation": operation,
        "message": format!(
            "Native desktop capture started without the required {missing_track} track"
        ),
        "details": {
            "mode": mode,
            "sourceType": selection.get("sourceType").cloned().unwrap_or(Value::Null),
            "sourceId": selection.get("sourceId").cloned().unwrap_or(Value::Null),
            "missingTrack": missing_track_source,
            "stopError": stop_error,
        },
        "fallback": true,
    }))
}

pub(super) fn select_capture_source(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let source_id = payload
        .get("sourceId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let sources = capture_sources()?;
    let available = sources.as_array().is_some_and(|values| {
        values.iter().any(|source| {
            source.get("sourceId").and_then(Value::as_str) == Some(source_id)
                && source.get("available") == Some(&Value::Bool(true))
        })
    });
    if available {
        Ok(Value::Null)
    } else {
        Err(capture_error(
            "DESKTOP_CAPTURE_SOURCE_UNAVAILABLE",
            "select",
            "The selected native capture source is no longer available",
        ))
    }
}

pub(super) fn get_permissions(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let kind = payload
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let capabilities = capabilities()?;
    let granted = match kind {
        "microphone" => capability_bool(&capabilities, &["microphone", "nativeMicrophone"]),
        "camera" => capability_bool(&capabilities, &["camera", "nativeCamera"]),
        "screen" | "screenVideo" => capability_bool(
            &capabilities,
            &["nativeScreenShare", "screenVideo", "screenCaptureKit"],
        ),
        "screenAudio" | "systemAudio" => capability_bool(
            &capabilities,
            &["nativeScreenAudio", "screenAudio", "systemAudio"],
        ),
        _ => false,
    };
    Ok(json!(if granted { "granted" } else { "prompt" }))
}

pub(super) fn capability_bool(value: &Value, names: &[&str]) -> bool {
    names
        .iter()
        .any(|name| value.get(*name).and_then(Value::as_bool).unwrap_or(false))
}

pub(super) fn set_microphone(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let enabled = payload_bool(&payload, "enabled")?;
    let mut error = 0;
    let result = unsafe {
        if enabled {
            ffi::lib_dspeak_media_start_microphone_capture(&mut error)
        } else {
            ffi::lib_dspeak_media_stop_microphone_capture(&mut error)
        }
    };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!(format!(
            "native microphone capture failed (error {error})"
        )))
    }
}

pub(super) fn set_microphone_device(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let device_id = CString::new(payload_string(&payload, "deviceId")?)
        .map_err(|_| json!("microphone device id contains a NUL byte"))?;
    let mut error = 0;
    let result =
        unsafe { ffi::lib_dspeak_media_set_microphone_device(device_id.as_ptr(), &mut error) };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!(format!(
            "native microphone device selection failed (error {error})"
        )))
    }
}

pub(super) fn set_camera_device(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let device_id = CString::new(payload_string(&payload, "deviceId")?)
        .map_err(|_| json!("camera device id contains a NUL byte"))?;
    let mut error = 0;
    let result = unsafe { ffi::lib_dspeak_media_set_camera_device(device_id.as_ptr(), &mut error) };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!(format!(
            "native camera device selection failed (error {error})"
        )))
    }
}

pub(super) fn set_output_device(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let device_id = CString::new(payload_string(&payload, "deviceId")?)
        .map_err(|_| json!("output device id contains a NUL byte"))?;
    let result = unsafe { ffi::lib_dspeak_media_set_output_device(device_id.as_ptr()) };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!("native audio output selection failed"))
    }
}

pub(super) fn set_local_video_preview(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let source = CString::new(payload_string(&payload, "source")?)
        .map_err(|_| json!("native preview source contains a NUL byte"))?;
    let enabled = payload_bool(&payload, "enabled")?;
    let result = unsafe { ffi::lib_dspeak_media_set_local_video_preview(source.as_ptr(), enabled) };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!("native local video preview could not be changed"))
    }
}

pub(super) fn set_shared_audio_volume(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let volume = payload_number(&payload, "volume")?;
    let result = unsafe { ffi::lib_dspeak_media_set_shared_audio_volume(volume) };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!("native shared audio volume could not be changed"))
    }
}

pub(super) fn set_shared_audio_attenuation(
    state: &mut WorkerState,
    payload: Value,
) -> WorkerResult {
    state.ensure_initialized()?;
    let enabled = payload_bool(&payload, "enabled")?;
    let reduction = payload_number(&payload, "reductionPercent")?;
    let attack = payload_i32(&payload, "attackMs")?;
    let release = payload_i32(&payload, "releaseMs")?;
    let result = unsafe {
        ffi::lib_dspeak_media_set_shared_audio_attenuation(
            i32::from(enabled),
            reduction,
            attack,
            release,
        )
    };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!(
            "native shared audio attenuation could not be changed"
        ))
    }
}

pub(super) fn get_audio_levels(state: &mut WorkerState) -> WorkerResult {
    state.ensure_initialized()?;
    let pointer = unsafe { ffi::lib_dspeak_media_get_audio_levels() };
    native_json_string(pointer, "native audio telemetry")
}

pub(super) fn start_microphone_check(state: &mut WorkerState) -> WorkerResult {
    state.ensure_initialized()?;
    let result = unsafe { ffi::lib_dspeak_media_start_microphone_check() };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!(format!(
            "native microphone check could not start (error {result})"
        )))
    }
}

pub(super) fn stop_microphone_check(state: &mut WorkerState) -> WorkerResult {
    state.ensure_initialized()?;
    let mut length = 0usize;
    let pointer = unsafe { ffi::lib_dspeak_media_stop_microphone_check(&mut length) };
    if pointer.is_null() {
        return Err(json!("native microphone check returned no recording"));
    }
    let bytes = unsafe { std::slice::from_raw_parts(pointer, length).to_vec() };
    unsafe { ffi::lib_dspeak_media_free_buffer(pointer) };
    Ok(Value::Array(
        bytes
            .into_iter()
            .map(|value| Value::Number(value.into()))
            .collect(),
    ))
}

pub(super) fn set_camera(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let enabled = payload_bool(&payload, "enabled")?;
    let settings = payload
        .get("videoSettings")
        .cloned()
        .unwrap_or_else(|| json!({}))
        .to_string();
    let settings =
        CString::new(settings).map_err(|_| json!("native camera settings contain a NUL byte"))?;
    let mut error = 0;
    let result = unsafe {
        if enabled {
            ffi::lib_dspeak_media_start_camera_capture(settings.as_ptr(), &mut error)
        } else {
            ffi::lib_dspeak_media_stop_camera_capture(&mut error)
        }
    };
    if result == 0 {
        Ok(Value::Null)
    } else {
        let detail = unsafe { ffi::lib_dspeak_media_capture_error_message(error) };
        let detail = if detail.is_null() {
            "native capture failed".to_string()
        } else {
            unsafe { CStr::from_ptr(detail) }
                .to_string_lossy()
                .into_owned()
        };
        Err(json!(format!(
            "native camera capture failed (error {error}): {detail}"
        )))
    }
}

pub(super) fn start_screen_share(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let request = payload.get("request").cloned().unwrap_or(Value::Null);
    validate_capture_request(&request, "screen-video", "video")?;
    assert_capture_source_available(&request, "screen-video")?;
    let request_json = CString::new(request.to_string())
        .map_err(|_| json!("capture request contains a NUL byte"))?;
    let mut error = 0;
    let result = unsafe { ffi::lib_dspeak_media_start_capture(request_json.as_ptr(), &mut error) };
    if result == 0 {
        validate_started_capture_tracks(&request, "screen-video", false)
    } else {
        Err(capture_native_error(
            "DESKTOP_CAPTURE_START_FAILED",
            "screen-video",
            error,
        ))
    }
}

pub(super) fn replace_screen_share(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let request = payload.get("request").cloned().unwrap_or(Value::Null);
    validate_capture_request(&request, "screen-video-replace", "video")?;
    assert_capture_source_available(&request, "screen-video-replace")?;
    let mut error = 0;
    let result = unsafe { ffi::lib_dspeak_media_stop_capture(&mut error) };
    if result != 0 {
        return Err(capture_native_error(
            "DESKTOP_CAPTURE_STOP_FAILED",
            "screen-video-replace",
            error,
        ));
    }
    start_screen_share(state, payload)
}

pub(super) fn stop_screen_share(state: &mut WorkerState) -> WorkerResult {
    state.ensure_initialized()?;
    let mut error = 0;
    let result = unsafe { ffi::lib_dspeak_media_stop_capture(&mut error) };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(capture_native_error(
            "DESKTOP_CAPTURE_STOP_FAILED",
            "screen-video",
            error,
        ))
    }
}

pub(super) fn start_system_audio(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let request = payload.get("request").cloned().unwrap_or(Value::Null);
    validate_capture_request(&request, "system-audio", "audio")?;
    assert_capture_source_available(&request, "system-audio")?;
    let request_json = CString::new(request.to_string())
        .map_err(|_| json!("capture request contains a NUL byte"))?;
    let mut error = 0;
    let result = unsafe { ffi::lib_dspeak_media_start_capture(request_json.as_ptr(), &mut error) };
    if result == 0 {
        validate_started_capture_tracks(&request, "system-audio", true)
    } else {
        Err(capture_native_error(
            "DESKTOP_CAPTURE_START_FAILED",
            "system-audio",
            error,
        ))
    }
}

pub(super) fn replace_system_audio(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let request = payload.get("request").cloned().unwrap_or(Value::Null);
    validate_capture_request(&request, "system-audio-replace", "audio")?;
    assert_capture_source_available(&request, "system-audio-replace")?;
    unsafe { ffi::lib_dspeak_media_stop_system_audio_capture() };
    start_system_audio(state, payload)
}

pub(super) fn stop_system_audio(state: &mut WorkerState) -> WorkerResult {
    state.ensure_initialized()?;
    unsafe { ffi::lib_dspeak_media_stop_system_audio_capture() };
    Ok(Value::Null)
}

pub(super) fn validate_capture_request(
    request: &Value,
    operation: &str,
    required_mode: &str,
) -> WorkerResult {
    let selection = request.get("captureSelection").ok_or_else(|| {
        capture_error(
            "DESKTOP_CAPTURE_INVALID_REQUEST",
            operation,
            "A validated desktop capture selection is required",
        )
    })?;
    let source_id = selection
        .get("sourceId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let source_type = selection
        .get("sourceType")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let source_key = selection
        .get("sourceKey")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let mode = selection
        .get("mode")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let mode_valid = mode == required_mode || required_mode == "video" && mode == "both";
    if source_id.is_empty()
        || source_type.is_empty()
        || source_key != format!("{source_type}:{source_id}")
        || !mode_valid
        || selection.get("excludeSelf") != Some(&Value::Bool(true))
        || selection.get("excludeSelfAudio") != Some(&Value::Bool(true))
    {
        return Err(capture_error(
            "DESKTOP_CAPTURE_INVALID_REQUEST",
            operation,
            "The native capture source identity, mode, and exclusion policy are invalid",
        ));
    }
    let audio = selection.get("audio").ok_or_else(|| {
        capture_error(
            "DESKTOP_CAPTURE_INVALID_REQUEST",
            operation,
            "Stereo 48 kHz audio policy is required",
        )
    })?;
    if audio.get("excludeSelfAudio") != Some(&Value::Bool(true))
        || audio.get("channels") != Some(&Value::Number(2.into()))
        || audio.get("sampleRate") != Some(&Value::Number(48000.into()))
        || audio.get("stereo") != Some(&Value::Bool(true))
    {
        return Err(capture_error(
            "DESKTOP_CAPTURE_INVALID_REQUEST",
            operation,
            "Desktop audio must be stereo at 48 kHz",
        ));
    }
    Ok(Value::Null)
}

pub(super) fn capture_error(code: &str, operation: &str, message: &str) -> Value {
    json!({
        "code": code,
        "operation": operation,
        "message": message,
        "fallback": true,
    })
}

pub(super) fn capture_native_error(code: &str, operation: &str, error_code: i32) -> Value {
    let detail = unsafe { ffi::lib_dspeak_media_capture_error_message(error_code) };
    let message = if detail.is_null() {
        "native capture failed".to_string()
    } else {
        unsafe { CStr::from_ptr(detail) }
            .to_string_lossy()
            .into_owned()
    };
    let mut error = capture_error(code, operation, &message);
    if let Some(object) = error.as_object_mut() {
        object.insert(
            "details".to_string(),
            json!({ "nativeErrorCode": error_code }),
        );
    }
    error
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_track_requirements_follow_requested_mode() {
        assert_eq!(required_capture_track_kinds("video"), vec!["video"]);
        assert_eq!(required_capture_track_kinds("audio"), vec!["audio"]);
        assert_eq!(required_capture_track_kinds("both"), vec!["video", "audio"]);
        assert!(required_capture_track_kinds("unknown").is_empty());
        assert_eq!(capture_track_source("video"), "screen");
        assert_eq!(capture_track_source("audio"), "screen-audio");
        assert_eq!(
            missing_required_capture_track("video", false, true),
            Some("video")
        );
        assert_eq!(
            missing_required_capture_track("audio", true, false),
            Some("audio")
        );
        assert_eq!(
            missing_required_capture_track("both", true, false),
            Some("audio")
        );
        assert_eq!(missing_required_capture_track("both", true, true), None);
    }

    #[test]
    fn combined_screen_capture_request_requires_video_mode_validation() {
        let request = json!({
            "captureSelection": {
                "sourceId": "screen-1",
                "sourceType": "screen",
                "sourceKey": "screen:screen-1",
                "mode": "both",
                "excludeSelf": true,
                "excludeSelfAudio": true,
                "audio": {
                    "excludeSelfAudio": true,
                    "channels": 2,
                    "sampleRate": 48000,
                    "stereo": true
                }
            }
        });
        assert!(validate_capture_request(&request, "screen-video", "video").is_ok());
        assert!(validate_capture_request(&request, "system-audio", "audio").is_err());
    }
}
