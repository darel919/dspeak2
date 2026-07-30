use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCaptureCapability {
    pub available: bool,
    pub reason: String,
    pub sources: Vec<Value>,
}

impl Default for NativeCaptureCapability {
    fn default() -> Self {
        Self {
            available: false,
            reason: "Native capture support was not reported by the platform backend.".to_string(),
            sources: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NativeCaptureMatrix {
    #[serde(default)]
    pub pipewire_portal: NativeCaptureCapability,
    #[serde(default)]
    pub x11: NativeCaptureCapability,
    #[serde(default)]
    pub system_audio: NativeCaptureCapability,
    #[serde(default)]
    pub windows_graphics_capture: NativeCaptureCapability,
    #[serde(default)]
    pub wasapi_process_loopback: NativeCaptureCapability,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NativeMediaCapabilities {
    pub native_rtc: bool,
    pub native_backend_ready: bool,
    #[serde(alias = "nativeScreenShare")]
    pub screen_video: bool,
    #[serde(alias = "nativeScreenAudio")]
    pub screen_audio: bool,
    #[serde(alias = "nativeMicrophone")]
    pub microphone: bool,
    #[serde(alias = "nativeCamera")]
    pub camera: bool,
    #[serde(alias = "nativeAudioReceive")]
    pub audio_receive: bool,
    #[serde(alias = "nativeVideoReceive")]
    pub video_receive: bool,
    #[serde(alias = "nativeP2P")]
    pub p2p: bool,
    #[serde(alias = "nativeSfu")]
    pub sfu: bool,
    #[serde(default)]
    pub capture: NativeCaptureMatrix,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NativeMediaState {
    pub initialized: bool,
    pub connected: bool,
    pub session: Option<Value>,
    pub topology: Option<Value>,
    pub ice_servers: Vec<Value>,
    pub capabilities: NativeMediaCapabilities,
    pub tracks: BTreeMap<String, Value>,
    pub native_backend_ready: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMediaError {
    pub code: String,
    pub operation: String,
    pub message: String,
    pub fallback: bool,
}

pub(crate) fn capture_error(code: &str, operation: &str, message: &str) -> NativeMediaError {
    NativeMediaError {
        code: code.to_string(),
        operation: operation.to_string(),
        message: message.to_string(),
        fallback: true,
    }
}

pub(crate) fn validate_capture_request(
    request: &Option<Value>,
    operation: &str,
    required_mode: &str,
) -> Result<(), NativeMediaError> {
    let selection = request
        .as_ref()
        .and_then(|value| value.get("captureSelection"))
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
    let source_key = selection
        .get("sourceKey")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let mode = selection
        .get("mode")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if source_id.is_empty()
        || source_type.is_empty()
        || source_key != format!("{}:{}", source_type, source_id)
        || mode != required_mode && !(required_mode == "video" && mode == "both")
        || selection.get("excludeSelf") != Some(&Value::Bool(true))
        || selection.get("excludeSelfAudio") != Some(&Value::Bool(true))
    {
        return Err(capture_error(
            "DESKTOP_CAPTURE_INVALID_REQUEST",
            operation,
            "The desktop capture source identity, mode, and exclusion policy are invalid",
        ));
    }
    let audio = selection.get("audio").ok_or_else(|| {
        capture_error(
            "DESKTOP_CAPTURE_INVALID_REQUEST",
            operation,
            "Stereo 48 kHz audio policy is required",
        )
    })?;
    if audio.get("channels") != Some(&Value::Number(2.into()))
        || audio.get("sampleRate") != Some(&Value::Number(48000.into()))
        || audio.get("stereo") != Some(&Value::Bool(true))
    {
        return Err(capture_error(
            "DESKTOP_CAPTURE_INVALID_REQUEST",
            operation,
            "Desktop audio must be stereo at 48 kHz",
        ));
    }
    if let Some(room_bitrate) = request
        .as_ref()
        .and_then(|value| value.get("roomBitrateBps"))
        .and_then(Value::as_u64)
    {
        if room_bitrate == 0 {
            return Err(capture_error(
                "DESKTOP_CAPTURE_INVALID_REQUEST",
                operation,
                "Room bitrate must be positive",
            ));
        }
    }
    Ok(())
}
