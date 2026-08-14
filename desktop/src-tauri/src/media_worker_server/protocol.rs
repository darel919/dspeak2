use super::WorkerResult;
use crate::ffi;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde_json::{json, Value};
use std::ffi::CStr;
use std::io::{self, BufWriter, Write};
use std::slice;
use std::sync::{Arc, Mutex};

const NATIVE_EVENT_PREFIX: &[u8] = b"DSPEAK_NATIVE_EVENT ";

pub(super) fn c_payload_string(payload: &Value, name: &str) -> Result<String, Value> {
    payload_string(payload, name)
}

pub(super) fn payload_string(payload: &Value, name: &str) -> Result<String, Value> {
    payload
        .get(name)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            json!(format!(
                "native media worker payload field '{name}' is required"
            ))
        })
}

pub(super) fn payload_u64(payload: &Value, name: &str) -> Result<u64, Value> {
    payload.get(name).and_then(Value::as_u64).ok_or_else(|| {
        json!(format!(
            "native media worker payload field '{name}' is required"
        ))
    })
}

pub(super) fn payload_i32(payload: &Value, name: &str) -> Result<i32, Value> {
    payload
        .get(name)
        .and_then(Value::as_i64)
        .and_then(|value| i32::try_from(value).ok())
        .ok_or_else(|| {
            json!(format!(
                "native media worker payload field '{name}' is required"
            ))
        })
}

pub(super) fn payload_number(payload: &Value, name: &str) -> Result<f64, Value> {
    payload.get(name).and_then(Value::as_f64).ok_or_else(|| {
        json!(format!(
            "native media worker payload field '{name}' is required"
        ))
    })
}

pub(super) fn payload_bool(payload: &Value, name: &str) -> Result<bool, Value> {
    payload.get(name).and_then(Value::as_bool).ok_or_else(|| {
        json!(format!(
            "native media worker payload field '{name}' is required"
        ))
    })
}

pub(super) fn native_text(pointer: *mut std::ffi::c_char, label: &str) -> Result<String, Value> {
    if pointer.is_null() {
        return Err(json!(format!("native {label} is unavailable")));
    }
    let value = unsafe { CStr::from_ptr(pointer) }
        .to_str()
        .map(str::to_owned)
        .map_err(|_| json!(format!("native {label} is not UTF-8")));
    unsafe { ffi::lib_dspeak_media_free_string(pointer) };
    value
}

pub(super) fn native_json_string(pointer: *mut std::ffi::c_char, label: &str) -> WorkerResult {
    let value = native_text(pointer, label)?;
    serde_json::from_str(&value)
        .map_err(|error| json!(format!("native {label} JSON was invalid: {error}")))
}

pub(super) fn write_message(
    output: &Arc<Mutex<BufWriter<io::Stdout>>>,
    message: &Value,
) -> Result<(), String> {
    let mut output = output
        .lock()
        .map_err(|_| "native media worker output lock poisoned".to_string())?;
    serde_json::to_writer(&mut *output, message)
        .map_err(|error| format!("native media worker response encoding failed: {error}"))?;
    output
        .write_all(b"\n")
        .map_err(|error| format!("native media worker response write failed: {error}"))?;
    output
        .flush()
        .map_err(|error| format!("native media worker response flush failed: {error}"))
}

pub(super) fn write_event_message(
    output: &Arc<Mutex<BufWriter<io::Stderr>>>,
    message: &Value,
) -> Result<(), String> {
    let mut output = output
        .lock()
        .map_err(|_| "native media worker event output lock poisoned".to_string())?;
    output
        .write_all(NATIVE_EVENT_PREFIX)
        .map_err(|error| format!("native media worker event prefix write failed: {error}"))?;
    serde_json::to_writer(&mut *output, message)
        .map_err(|error| format!("native media worker event encoding failed: {error}"))?;
    output
        .write_all(b"\n")
        .map_err(|error| format!("native media worker event write failed: {error}"))?;
    output
        .flush()
        .map_err(|error| format!("native media worker event flush failed: {error}"))
}

const MAX_NATIVE_VIDEO_FRAME_BYTES: usize = 600_000;
const NATIVE_VIDEO_FRAME_EVENT_KIND: i32 = 2;
const NATIVE_LOCAL_VIDEO_FRAME_EVENT_KIND: i32 = 5;

pub(super) fn is_video_frame_event(kind: i32) -> bool {
    matches!(
        kind,
        NATIVE_VIDEO_FRAME_EVENT_KIND | NATIVE_LOCAL_VIDEO_FRAME_EVENT_KIND
    )
}

pub(super) fn drain_events(output: &Arc<Mutex<BufWriter<io::Stderr>>>) {
    loop {
        let action = unsafe { ffi::lib_dspeak_media_drain_action() };
        let params_json = optional_native_text(action.params_json);
        let state = optional_native_text(action.state);
        if action.kind == 0 && params_json.is_none() && state.is_none() {
            break;
        }
        let _ = write_event_message(
            output,
            &json!({
                "type": "event",
                "event": "native-action",
                "payload": {
                    "kind": action.kind,
                    "transportPtr": action.transport_ptr as u64,
                    "actionId": action.action_id,
                    "paramsJson": params_json,
                    "state": state,
                },
            }),
        );
    }
    loop {
        let mut event = unsafe { ffi::lib_dspeak_media_drain_receive_event() };
        if event.kind == 0 {
            break;
        }
        let id = borrowed_native_text(event.id);
        let payload = borrowed_native_json(event.payload_json);
        let data_bytes = event.data_len as usize;
        let data_dropped =
            is_video_frame_event(event.kind) && data_bytes > MAX_NATIVE_VIDEO_FRAME_BYTES;
        let data = if data_dropped {
            None
        } else {
            borrowed_native_bytes(event.data, event.data_len)
        };
        let _ = write_event_message(
            output,
            &json!({
                "type": "event",
                "event": "native-receive-event",
                "payload": {
                    "kind": event.kind,
                    "eventId": event.event_id,
                    "id": id,
                    "payload": payload,
                    "data": data,
                    "dataBytes": data_bytes,
                    "dataDropped": data_dropped,
                },
            }),
        );
        unsafe { ffi::lib_dspeak_media_free_receive_event(&mut event) };
    }
}

pub(super) fn optional_native_text(pointer: *mut std::ffi::c_char) -> Option<String> {
    if pointer.is_null() {
        return None;
    }
    let value = unsafe { CStr::from_ptr(pointer) }
        .to_string_lossy()
        .into_owned();
    unsafe { ffi::lib_dspeak_media_free_string(pointer) };
    Some(value)
}

pub(super) fn borrowed_native_text(pointer: *mut std::ffi::c_char) -> Option<String> {
    if pointer.is_null() {
        return None;
    }
    Some(
        unsafe { CStr::from_ptr(pointer) }
            .to_string_lossy()
            .into_owned(),
    )
}

pub(super) fn borrowed_native_json(pointer: *mut std::ffi::c_char) -> Value {
    borrowed_native_text(pointer)
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_else(|| json!({}))
}

pub(super) fn borrowed_native_bytes(pointer: *mut u8, length: u32) -> Option<String> {
    if pointer.is_null() || length == 0 {
        return None;
    }
    let bytes = unsafe { slice::from_raw_parts(pointer, length as usize) };
    Some(STANDARD.encode(bytes))
}
