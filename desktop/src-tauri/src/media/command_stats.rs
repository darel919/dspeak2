#[cfg(native_rtc)]
use super::command_consumers::consumer_index;
use super::state::NativeMediaStore;
#[cfg(native_rtc)]
use super::{ffi, native};
use serde_json::Value;
#[cfg(native_rtc)]
use std::ffi::{CStr, CString};
#[cfg(native_rtc)]
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

#[cfg(native_rtc)]
fn parse_stats(value: String, label: &str) -> Result<Value, String> {
    serde_json::from_str(&value).map_err(|error| format!("{label}: {error}"))
}

#[cfg(native_rtc)]
fn append_video_stream_diagnostics(
    value: &Value,
    direction: &str,
    owner: &str,
    output: &mut Vec<Value>,
) {
    match value {
        Value::Array(values) => {
            for value in values {
                append_video_stream_diagnostics(value, direction, owner, output);
            }
        }
        Value::Object(values) => {
            let kind = values
                .get("kind")
                .or_else(|| values.get("mediaType"))
                .and_then(Value::as_str);
            if values.get("type").and_then(Value::as_str) == Some(direction)
                && kind == Some("video")
            {
                let field = |name: &str| values.get(name).cloned().unwrap_or(Value::Null);
                output.push(serde_json::json!({
                    "owner": owner,
                    "direction": direction,
                    "id": field("id"),
                    "codecId": field("codecId"),
                    "frameWidth": field("frameWidth"),
                    "frameHeight": field("frameHeight"),
                    "framesPerSecond": field("framesPerSecond"),
                    "framesEncoded": field("framesEncoded"),
                    "framesDecoded": field("framesDecoded"),
                    "framesDropped": field("framesDropped"),
                    "totalEncodeTime": field("totalEncodeTime"),
                    "totalDecodeTime": field("totalDecodeTime"),
                    "encoderImplementation": field("encoderImplementation"),
                    "decoderImplementation": field("decoderImplementation"),
                    "qualityLimitationReason": field("qualityLimitationReason"),
                    "powerEfficientEncoder": field("powerEfficientEncoder"),
                    "powerEfficientDecoder": field("powerEfficientDecoder"),
                }));
            }
            for value in values.values() {
                append_video_stream_diagnostics(value, direction, owner, output);
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {}
    }
}

#[cfg(native_rtc)]
pub(crate) fn collect_media_stats(store: &NativeMediaStore) -> Result<Value, String> {
    let video_codec_diagnostics = store
        .state
        .lock()
        .map_err(|_| "native media state lock poisoned".to_string())?
        .capabilities
        .video_codec_diagnostics
        .clone();
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let sampled_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let mut transports = Vec::new();
    let mut video_streams = Vec::new();
    if !handles.send_transport.is_null() {
        let stats = parse_stats(
            native::send_transport_get_stats(handles.send_transport)?,
            "native send transport stats",
        )?;
        transports.push(serde_json::json!({
            "id": "send",
            "kind": "send",
            "stats": stats,
        }));
    }
    if !handles.recv_transport.is_null() {
        let stats = parse_stats(
            native::recv_transport_get_stats(handles.recv_transport)?,
            "native recv transport stats",
        )?;
        transports.push(serde_json::json!({
            "id": "recv",
            "kind": "recv",
            "stats": stats,
        }));
    }
    let mut producers = Vec::new();
    for (source, producer) in &handles.producers {
        let id = unsafe { ffi::lib_dspeak_media_producer_get_id(*producer) };
        if id.is_null() {
            continue;
        }
        let producer_id = unsafe { CStr::from_ptr(id) }.to_string_lossy().into_owned();
        unsafe { ffi::lib_dspeak_media_free_string(id) };
        let stats = parse_stats(
            native::producer_get_stats(*producer)?,
            "native producer stats",
        )?;
        append_video_stream_diagnostics(&stats, "outbound-rtp", &producer_id, &mut video_streams);
        producers.push(serde_json::json!({
            "id": producer_id,
            "source": source,
            "stats": stats,
        }));
    }
    let mut consumers = Vec::new();
    for consumer in &handles.consumers {
        let metadata = native::consumer_metadata(*consumer)?;
        let stats = parse_stats(
            native::consumer_get_stats(*consumer)?,
            "native consumer stats",
        )?;
        append_video_stream_diagnostics(&stats, "inbound-rtp", &metadata.0, &mut video_streams);
        consumers.push(serde_json::json!({
            "id": metadata.0,
            "producerId": metadata.1,
            "kind": metadata.2,
            "stats": stats,
        }));
    }
    Ok(serde_json::json!({
        "engine": "native",
        "topology": "sfu",
        "sampledAt": sampled_at,
        "transports": transports,
        "producers": producers,
        "consumers": consumers,
        "videoStreams": video_streams,
        "videoCodecDiagnostics": video_codec_diagnostics,
    }))
}

#[cfg(all(test, native_rtc))]
mod tests {
    use super::append_video_stream_diagnostics;
    use serde_json::json;

    #[test]
    fn extracts_live_video_fields_from_nested_rtp_stats() {
        let value = json!({
            "stats": [
                {
                    "id": "outbound-video",
                    "type": "outbound-rtp",
                    "kind": "video",
                    "frameWidth": 1920,
                    "frameHeight": 1080,
                    "framesPerSecond": 30,
                    "totalEncodeTime": 12.5,
                    "encoderImplementation": "libvpx",
                    "qualityLimitationReason": "cpu"
                },
                {
                    "id": "outbound-audio",
                    "type": "outbound-rtp",
                    "kind": "audio"
                }
            ]
        });
        let mut streams = Vec::new();

        append_video_stream_diagnostics(&value, "outbound-rtp", "producer-1", &mut streams);

        assert_eq!(streams.len(), 1);
        assert_eq!(streams[0]["owner"], "producer-1");
        assert_eq!(streams[0]["frameWidth"], 1920);
        assert_eq!(streams[0]["framesPerSecond"], 30);
        assert_eq!(streams[0]["encoderImplementation"], "libvpx");
        assert_eq!(streams[0]["qualityLimitationReason"], "cpu");
    }
}

#[cfg(native_rtc)]
fn producer_by_id(
    handles: &super::state::NativeHandleRegistry,
    producer_id: &str,
) -> Option<*mut ffi::lib_dspeak_media_producer_t> {
    handles
        .producers
        .values()
        .find(|producer| {
            let pointer = unsafe { ffi::lib_dspeak_media_producer_get_id(**producer) };
            if pointer.is_null() {
                return false;
            }
            let matches = unsafe { CStr::from_ptr(pointer) }
                .to_str()
                .map(|value| value == producer_id)
                .unwrap_or(false);
            unsafe { ffi::lib_dspeak_media_free_string(pointer) };
            matches
        })
        .copied()
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_restart_send_transport_ice(
    store: State<'_, NativeMediaStore>,
    ice_parameters: Value,
) -> Result<Value, String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    if handles.send_transport.is_null() {
        return Err("native send transport is not ready".to_string());
    }
    native::send_transport_restart_ice(handles.send_transport, &ice_parameters)?;
    Ok(serde_json::json!({ "restarted": true }))
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_restart_recv_transport_ice(
    store: State<'_, NativeMediaStore>,
    ice_parameters: Value,
) -> Result<Value, String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    if handles.recv_transport.is_null() {
        return Err("native recv transport is not ready".to_string());
    }
    native::recv_transport_restart_ice(handles.recv_transport, &ice_parameters)?;
    Ok(serde_json::json!({ "restarted": true }))
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_get_transport_stats(
    store: State<'_, NativeMediaStore>,
    direction: String,
) -> Result<Value, String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    match direction.as_str() {
        "send" => {
            if handles.send_transport.is_null() {
                return Err("native send transport is not ready".to_string());
            }
            let json_str = native::send_transport_get_stats(handles.send_transport)?;
            serde_json::from_str(&json_str).map_err(|error| error.to_string())
        }
        "recv" => {
            if handles.recv_transport.is_null() {
                return Err("native recv transport is not ready".to_string());
            }
            let json_str = native::recv_transport_get_stats(handles.recv_transport)?;
            serde_json::from_str(&json_str).map_err(|error| error.to_string())
        }
        _ => Err(format!("unknown transport direction: {direction}")),
    }
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_get_producer_stats(
    store: State<'_, NativeMediaStore>,
    producer_id: String,
) -> Result<Value, String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let producer = producer_by_id(&handles, &producer_id)
        .ok_or_else(|| "native producer is not owned by this session".to_string())?;
    let json_str = native::producer_get_stats(producer)?;
    serde_json::from_str(&json_str).map_err(|error| error.to_string())
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_get_consumer_stats(
    store: State<'_, NativeMediaStore>,
    consumer_id: String,
) -> Result<Value, String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let index = consumer_index(&handles, &consumer_id)
        .ok_or_else(|| "native consumer is not owned by this session".to_string())?;
    let json_str = native::consumer_get_stats(handles.consumers[index])?;
    serde_json::from_str(&json_str).map_err(|error| error.to_string())
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_replace_producer_track(
    store: State<'_, NativeMediaStore>,
    producer_id: String,
    source: String,
    kind: String,
) -> Result<(), String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let producer = producer_by_id(&handles, &producer_id)
        .ok_or_else(|| "native producer is not owned by this session".to_string())?;
    let c_source = CString::new(source.as_str()).map_err(|error| error.to_string())?;
    if kind == "video" {
        let track = unsafe { ffi::lib_dspeak_media_get_video_track(c_source.as_ptr()) };
        if track.is_null() {
            return Err("native video capture track is unavailable".to_string());
        }
        native::producer_replace_video_track(producer, track)?;
    } else if kind == "audio" {
        let track = unsafe { ffi::lib_dspeak_media_get_audio_track(c_source.as_ptr()) };
        if track.is_null() {
            return Err("native audio capture track is unavailable".to_string());
        }
        native::producer_replace_audio_track(producer, track)?;
    } else {
        return Err("native producer track kind is invalid".to_string());
    }
    Ok(())
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_set_consumer_jitter_buffer(
    store: State<'_, NativeMediaStore>,
    consumer_id: String,
    min_delay_ms: i32,
    target_delay_ms: i32,
) -> Result<(), String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let index = consumer_index(&handles, &consumer_id)
        .ok_or_else(|| "native consumer is not owned by this session".to_string())?;
    native::consumer_set_jitter_buffer(handles.consumers[index], min_delay_ms, target_delay_ms)
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_restart_send_transport_ice(
    _store: State<'_, NativeMediaStore>,
    _ice_parameters: Value,
) -> Result<Value, String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_restart_recv_transport_ice(
    _store: State<'_, NativeMediaStore>,
    _ice_parameters: Value,
) -> Result<Value, String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_get_transport_stats(
    _store: State<'_, NativeMediaStore>,
    _direction: String,
) -> Result<Value, String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_get_producer_stats(
    _store: State<'_, NativeMediaStore>,
    _producer_id: String,
) -> Result<Value, String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_get_consumer_stats(
    _store: State<'_, NativeMediaStore>,
    _consumer_id: String,
) -> Result<Value, String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_replace_producer_track(
    _store: State<'_, NativeMediaStore>,
    _producer_id: String,
    _source: String,
    _kind: String,
) -> Result<(), String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_set_consumer_jitter_buffer(
    _store: State<'_, NativeMediaStore>,
    _consumer_id: String,
    _min_delay_ms: i32,
    _target_delay_ms: i32,
) -> Result<(), String> {
    Err("native media backend not available".to_string())
}
