use super::protocol::{
    c_payload_string, native_json_string, native_text, payload_bool, payload_i32, payload_number,
    payload_string,
};
use super::state::WorkerState;
use super::WorkerResult;
use crate::ffi;
use serde_json::{json, Value};
use std::ffi::{c_void, CStr, CString};
use std::ptr;
use std::time::{SystemTime, UNIX_EPOCH};

pub(super) fn capabilities() -> WorkerResult {
    let pointer = unsafe { ffi::lib_dspeak_media_get_capabilities() };
    native_json_string(pointer, "native media capabilities")
}
pub(super) fn create_device(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    state.clear_p2p();
    state.clear_transports();
    if !state.device.is_null() {
        unsafe { ffi::lib_dspeak_media_destroy_device(state.device) };
        state.device = ptr::null_mut();
    }
    let capabilities = payload
        .get("routerRtpCapabilities")
        .and_then(Value::as_str)
        .ok_or_else(|| json!("router RTP capabilities are required"))?;
    let capabilities = CString::new(capabilities)
        .map_err(|_| json!("router RTP capabilities contain a NUL byte"))?;
    let mut error = 0;
    let device = unsafe { ffi::lib_dspeak_media_create_device(capabilities.as_ptr(), &mut error) };
    if device.is_null() {
        return Err(json!(format!(
            "native device creation failed (error {error})"
        )));
    }
    state.device = device;
    let rtp = unsafe { ffi::lib_dspeak_media_device_get_rtp_capabilities(device) };
    let rtp = native_json_string(rtp, "native RTP capabilities")?;
    Ok(json!({
        "handle": 1,
        "rtpCapabilities": rtp,
    }))
}

pub(super) fn create_send_transport(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    if state.device.is_null() {
        return Err(json!("native device is not ready"));
    }
    if !state.send_transport.is_null() {
        unsafe { ffi::lib_dspeak_media_destroy_send_transport(state.send_transport) };
        state.send_transport = ptr::null_mut();
    }
    let transport = unsafe {
        create_transport(
            state.device,
            payload,
            ffi::lib_dspeak_media_create_send_transport,
        )?
    };
    state.send_transport = transport;
    Ok(json!({ "handle": 2 }))
}

pub(super) fn create_recv_transport(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    if state.device.is_null() {
        return Err(json!("native device is not ready"));
    }
    if !state.recv_transport.is_null() {
        unsafe { ffi::lib_dspeak_media_destroy_recv_transport(state.recv_transport) };
        state.recv_transport = ptr::null_mut();
    }
    let transport = unsafe {
        create_transport(
            state.device,
            payload,
            ffi::lib_dspeak_media_create_recv_transport,
        )?
    };
    state.recv_transport = transport;
    Ok(json!({ "handle": 3 }))
}

pub(super) unsafe fn create_transport<T>(
    device: *mut ffi::lib_dspeak_media_device_t,
    payload: Value,
    create: unsafe extern "C" fn(
        *mut ffi::lib_dspeak_media_device_t,
        *const std::ffi::c_char,
        *const std::ffi::c_char,
        *const std::ffi::c_char,
        *const std::ffi::c_char,
        *const std::ffi::c_char,
        *mut i32,
    ) -> *mut T,
) -> Result<*mut T, Value> {
    let id = c_payload_string(&payload, "id")?;
    let ice_parameters = payload
        .get("iceParameters")
        .cloned()
        .unwrap_or(Value::Null)
        .to_string();
    let ice_candidates = payload
        .get("iceCandidates")
        .cloned()
        .unwrap_or(Value::Array(Vec::new()))
        .to_string();
    let dtls_parameters = payload
        .get("dtlsParameters")
        .cloned()
        .unwrap_or(Value::Null)
        .to_string();
    let app_data = payload
        .get("appData")
        .map(Value::to_string)
        .unwrap_or_default();
    let id = CString::new(id).map_err(|_| json!("transport id contains a NUL byte"))?;
    let ice_parameters =
        CString::new(ice_parameters).map_err(|_| json!("ICE parameters contain a NUL byte"))?;
    let ice_candidates =
        CString::new(ice_candidates).map_err(|_| json!("ICE candidates contain a NUL byte"))?;
    let dtls_parameters =
        CString::new(dtls_parameters).map_err(|_| json!("DTLS parameters contain a NUL byte"))?;
    let app_data =
        CString::new(app_data).map_err(|_| json!("transport app data contains a NUL byte"))?;
    let mut error = 0;
    let transport = create(
        device,
        id.as_ptr(),
        ice_parameters.as_ptr(),
        ice_candidates.as_ptr(),
        dtls_parameters.as_ptr(),
        app_data.as_ptr(),
        &mut error,
    );
    if transport.is_null() {
        Err(json!(format!(
            "native transport creation failed (error {error})"
        )))
    } else {
        Ok(transport)
    }
}

pub(super) fn consume(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    if state.recv_transport.is_null() {
        return Err(json!("native receive transport is not ready"));
    }
    let id = c_payload_string(&payload, "id")?;
    let producer_id = c_payload_string(&payload, "producerId")?;
    let kind = c_payload_string(&payload, "kind")?;
    let rtp_parameters = payload
        .get("rtpParameters")
        .cloned()
        .unwrap_or(Value::Null)
        .to_string();
    let app_data = payload
        .get("appData")
        .cloned()
        .unwrap_or_else(|| json!({}))
        .to_string();
    let id = CString::new(id).map_err(|_| json!("consumer id contains a NUL byte"))?;
    let producer_id =
        CString::new(producer_id).map_err(|_| json!("consumer producer id contains a NUL byte"))?;
    let kind = CString::new(kind).map_err(|_| json!("consumer kind contains a NUL byte"))?;
    let rtp_parameters =
        CString::new(rtp_parameters).map_err(|_| json!("RTP parameters contain a NUL byte"))?;
    let app_data =
        CString::new(app_data).map_err(|_| json!("consumer app data contains a NUL byte"))?;
    let mut error = 0;
    let consumer = unsafe {
        ffi::lib_dspeak_media_consume(
            state.recv_transport,
            id.as_ptr(),
            producer_id.as_ptr(),
            kind.as_ptr(),
            rtp_parameters.as_ptr(),
            app_data.as_ptr(),
            &mut error,
        )
    };
    if consumer.is_null() {
        return Err(json!(format!(
            "native consumer creation failed (error {error})"
        )));
    }
    if unsafe { ffi::lib_dspeak_media_consumer_set_enabled(consumer, false) } != 0 {
        unsafe { ffi::lib_dspeak_media_destroy_consumer(consumer) };
        return Err(json!("native consumer could not be paused before resume"));
    }
    let metadata = consumer_metadata(consumer)?;
    state.consumers.push(consumer);
    Ok(json!({
        "id": metadata.0,
        "producerId": metadata.1,
        "kind": metadata.2,
    }))
}

pub(super) fn set_consumer_enabled(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let consumer = consumer_pointer(state, payload_string(&payload, "consumerId")?)?;
    let enabled = payload_bool(&payload, "enabled")?;
    let result = unsafe { ffi::lib_dspeak_media_consumer_set_enabled(consumer, enabled) };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!("native consumer enable state could not be changed"))
    }
}

pub(super) fn set_consumer_volume(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let consumer = consumer_pointer(state, payload_string(&payload, "consumerId")?)?;
    let volume = payload_number(&payload, "volume")?;
    let result = unsafe { ffi::lib_dspeak_media_consumer_set_volume(consumer, volume) };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!("native consumer volume could not be changed"))
    }
}

pub(super) fn close_consumer(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let consumer_id = payload_string(&payload, "consumerId")?;
    let Some(index) = consumer_index(state, &consumer_id) else {
        return Ok(Value::Null);
    };
    let consumer = state.consumers.remove(index);
    unsafe { ffi::lib_dspeak_media_destroy_consumer(consumer) };
    Ok(Value::Null)
}

pub(super) fn consumer_index(state: &WorkerState, consumer_id: &str) -> Option<usize> {
    state.consumers.iter().position(|consumer| {
        let pointer = unsafe { ffi::lib_dspeak_media_consumer_get_id(*consumer) };
        let matches = if pointer.is_null() {
            false
        } else {
            unsafe { CStr::from_ptr(pointer) }.to_str().ok() == Some(consumer_id)
        };
        if !pointer.is_null() {
            unsafe { ffi::lib_dspeak_media_free_string(pointer) };
        }
        matches
    })
}

pub(super) fn consumer_pointer(
    state: &WorkerState,
    consumer_id: String,
) -> Result<*mut c_void, Value> {
    consumer_index(state, &consumer_id)
        .map(|index| state.consumers[index] as *mut c_void)
        .ok_or_else(|| json!("native consumer is not owned by this session"))
}

pub(super) fn consumer_metadata(
    consumer: *mut ffi::lib_dspeak_media_consumer_t,
) -> Result<(String, String, String), Value> {
    Ok((
        native_text(
            unsafe { ffi::lib_dspeak_media_consumer_get_id(consumer) },
            "consumer id",
        )?,
        native_text(
            unsafe { ffi::lib_dspeak_media_consumer_get_producer_id(consumer) },
            "consumer producer id",
        )?,
        native_text(
            unsafe { ffi::lib_dspeak_media_consumer_get_kind(consumer) },
            "consumer kind",
        )?,
    ))
}

pub(super) fn create_capture_producer(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    if state.send_transport.is_null() {
        return Err(json!("native send transport is not ready"));
    }
    let kind = payload_string(&payload, "kind")?;
    if kind != "audio" && kind != "video" {
        return Err(json!("native capture producer kind is invalid"));
    }
    let app_data = payload.get("appData").cloned().unwrap_or_else(|| json!({}));
    let source = app_data
        .get("source")
        .and_then(Value::as_str)
        .unwrap_or(if kind == "audio" { "audio" } else { "screen" })
        .to_string();
    let valid = match kind.as_str() {
        "audio" => matches!(source.as_str(), "audio" | "screen-audio"),
        "video" => matches!(source.as_str(), "camera" | "screen"),
        _ => false,
    };
    if !valid {
        return Err(json!(format!(
            "native capture source '{source}' is invalid for {kind} producer"
        )));
    }
    let producer_key = app_data
        .get("producerKey")
        .and_then(Value::as_str)
        .unwrap_or(&source)
        .to_string();
    if state.producers.contains_key(&producer_key) {
        return Err(json!(format!(
            "native {kind} producer already exists for key '{producer_key}'"
        )));
    }
    let source_c = CString::new(source.clone())
        .map_err(|_| json!("native capture source contains a NUL byte"))?;
    let track = unsafe {
        if kind == "video" {
            ffi::lib_dspeak_media_get_video_track(source_c.as_ptr())
        } else {
            ffi::lib_dspeak_media_get_audio_track(source_c.as_ptr())
        }
    };
    if track.is_null() {
        return Err(json!(format!("native {kind} capture track is unavailable")));
    }
    let app_data = CString::new(app_data.to_string())
        .map_err(|_| json!("native producer app data contains a NUL byte"))?;
    let mut error = 0;
    let producer = unsafe {
        if kind == "video" {
            ffi::lib_dspeak_media_produce_video_track(
                state.send_transport,
                track,
                app_data.as_ptr(),
                &mut error,
            )
        } else {
            ffi::lib_dspeak_media_produce_audio_track(
                state.send_transport,
                track,
                app_data.as_ptr(),
                &mut error,
            )
        }
    };
    if producer.is_null() {
        return Err(json!(format!(
            "native producer creation failed (error {error})"
        )));
    }
    let producer_id = native_text(
        unsafe { ffi::lib_dspeak_media_producer_get_id(producer) },
        "producer id",
    );
    match producer_id {
        Ok(producer_id) => {
            state.producers.insert(producer_key, producer);
            Ok(json!({ "id": producer_id }))
        }
        Err(error) => {
            unsafe { ffi::lib_dspeak_media_destroy_producer(producer) };
            Err(error)
        }
    }
}

pub(super) fn producer_pointer(
    state: &WorkerState,
    source: &str,
) -> Result<*mut ffi::lib_dspeak_media_producer_t, Value> {
    state.producers.get(source).cloned().ok_or_else(|| {
        json!(format!(
            "native producer is not available for source '{source}'"
        ))
    })
}

pub(super) fn producer_by_id(
    state: &WorkerState,
    producer_id: &str,
) -> Option<*mut ffi::lib_dspeak_media_producer_t> {
    state.producers.values().copied().find(|producer| {
        native_text(
            unsafe { ffi::lib_dspeak_media_producer_get_id(*producer) },
            "producer id",
        )
        .map(|value| value == producer_id)
        .unwrap_or(false)
    })
}

pub(super) fn set_producer_paused(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let key = payload
        .get("producerKey")
        .and_then(Value::as_str)
        .or_else(|| payload.get("source").and_then(Value::as_str))
        .ok_or_else(|| json!("native producer source or key is required"))?;
    let producer = producer_pointer(state, key)?;
    let paused = payload_bool(&payload, "paused")?;
    let result = unsafe { ffi::lib_dspeak_media_producer_set_paused(producer, paused) };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!("native producer pause state update failed"))
    }
}

pub(super) fn set_producer_parameters(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let key = payload
        .get("producerKey")
        .and_then(Value::as_str)
        .or_else(|| payload.get("source").and_then(Value::as_str))
        .ok_or_else(|| json!("native producer source or key is required"))?;
    let producer = producer_pointer(state, key)?;
    let parameters = CString::new(
        payload
            .get("parameters")
            .cloned()
            .unwrap_or(Value::Null)
            .to_string(),
    )
    .map_err(|_| json!("native producer parameters contain a NUL byte"))?;
    let result =
        unsafe { ffi::lib_dspeak_media_producer_set_parameters(producer, parameters.as_ptr()) };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!("native producer RTP parameters update failed"))
    }
}

pub(super) fn remove_capture_producer(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let key = payload
        .get("producerKey")
        .and_then(Value::as_str)
        .or_else(|| payload.get("source").and_then(Value::as_str))
        .ok_or_else(|| json!("native producer source or key is required"))?;
    if let Some(producer) = state.producers.remove(key) {
        unsafe { ffi::lib_dspeak_media_destroy_producer(producer) };
    }
    Ok(Value::Null)
}

pub(super) fn restart_send_transport_ice(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    if state.send_transport.is_null() {
        return Err(json!("native send transport is not ready"));
    }
    let parameters = CString::new(
        payload
            .get("iceParameters")
            .cloned()
            .unwrap_or(Value::Null)
            .to_string(),
    )
    .map_err(|_| json!("ICE parameters contain a NUL byte"))?;
    let result = unsafe {
        ffi::lib_dspeak_media_send_transport_restart_ice(state.send_transport, parameters.as_ptr())
    };
    if result == 0 {
        Ok(json!({ "restarted": true }))
    } else {
        Err(json!("native send transport ICE restart failed"))
    }
}

pub(super) fn restart_recv_transport_ice(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    if state.recv_transport.is_null() {
        return Err(json!("native recv transport is not ready"));
    }
    let parameters = CString::new(
        payload
            .get("iceParameters")
            .cloned()
            .unwrap_or(Value::Null)
            .to_string(),
    )
    .map_err(|_| json!("ICE parameters contain a NUL byte"))?;
    let result = unsafe {
        ffi::lib_dspeak_media_recv_transport_restart_ice(state.recv_transport, parameters.as_ptr())
    };
    if result == 0 {
        Ok(json!({ "restarted": true }))
    } else {
        Err(json!("native recv transport ICE restart failed"))
    }
}

pub(super) fn get_transport_stats(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let direction = payload_string(&payload, "direction")?;
    let pointer = unsafe {
        match direction.as_str() {
            "send" if !state.send_transport.is_null() => {
                ffi::lib_dspeak_media_send_transport_get_stats(state.send_transport)
            }
            "recv" if !state.recv_transport.is_null() => {
                ffi::lib_dspeak_media_recv_transport_get_stats(state.recv_transport)
            }
            "send" | "recv" => return Err(json!("native transport is not ready")),
            _ => return Err(json!(format!("unknown transport direction: {direction}"))),
        }
    };
    native_json_string(pointer, "native transport stats")
}

pub(super) fn get_producer_stats(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let producer_id = payload_string(&payload, "producerId")?;
    let producer = producer_by_id(state, &producer_id)
        .ok_or_else(|| json!("native producer is not owned by this session"))?;
    let pointer = unsafe { ffi::lib_dspeak_media_producer_get_stats(producer) };
    native_json_string(pointer, "native producer stats")
}

pub(super) fn get_consumer_stats(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let consumer_id = payload_string(&payload, "consumerId")?;
    let consumer = consumer_pointer(state, consumer_id)?;
    let pointer = unsafe { ffi::lib_dspeak_media_consumer_get_stats(consumer) };
    native_json_string(pointer, "native consumer stats")
}

pub(super) fn replace_producer_track(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let producer_id = payload_string(&payload, "producerId")?;
    let source = payload_string(&payload, "source")?;
    let kind = payload_string(&payload, "kind")?;
    let producer = producer_by_id(state, &producer_id)
        .ok_or_else(|| json!("native producer is not owned by this session"))?;
    let source =
        CString::new(source).map_err(|_| json!("native capture source contains a NUL byte"))?;
    let track = unsafe {
        if kind == "video" {
            ffi::lib_dspeak_media_get_video_track(source.as_ptr())
        } else if kind == "audio" {
            ffi::lib_dspeak_media_get_audio_track(source.as_ptr())
        } else {
            ptr::null_mut()
        }
    };
    if track.is_null() {
        return Err(json!("native replacement capture track is unavailable"));
    }
    let mut error = 0;
    let result = unsafe {
        if kind == "video" {
            ffi::lib_dspeak_media_producer_replace_video_track(producer, track, &mut error)
        } else {
            ffi::lib_dspeak_media_producer_replace_audio_track(producer, track, &mut error)
        }
    };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!(format!(
            "native producer track replacement failed (error {error})"
        )))
    }
}

pub(super) fn set_consumer_jitter_buffer(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let consumer_id = payload_string(&payload, "consumerId")?;
    let consumer = consumer_pointer(state, consumer_id)?;
    let min_delay = payload_i32(&payload, "minDelayMs")?;
    let target_delay = payload_i32(&payload, "targetDelayMs")?;
    let result = unsafe {
        ffi::lib_dspeak_media_consumer_set_jitter_buffer(consumer, min_delay, target_delay)
    };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!("native consumer jitter buffer configuration failed"))
    }
}

pub(super) fn append_video_stream_diagnostics(
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
                output.push(json!({
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

pub(super) fn get_stats(state: &mut WorkerState) -> WorkerResult {
    state.ensure_initialized()?;
    let sampled_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| json!(error.to_string()))?
        .as_millis();
    let mut transports = Vec::new();
    if !state.send_transport.is_null() {
        let stats = unsafe { ffi::lib_dspeak_media_send_transport_get_stats(state.send_transport) };
        transports.push(json!({
            "id": "send",
            "kind": "send",
            "stats": native_json_string(stats, "native send transport stats")?,
        }));
    }
    if !state.recv_transport.is_null() {
        let stats = unsafe { ffi::lib_dspeak_media_recv_transport_get_stats(state.recv_transport) };
        transports.push(json!({
            "id": "recv",
            "kind": "recv",
            "stats": native_json_string(stats, "native recv transport stats")?,
        }));
    }
    let mut producers = Vec::new();
    let mut video_streams = Vec::new();
    for (source, producer) in &state.producers {
        let id = native_text(
            unsafe { ffi::lib_dspeak_media_producer_get_id(*producer) },
            "producer id",
        )?;
        let stats = unsafe { ffi::lib_dspeak_media_producer_get_stats(*producer) };
        let stats = native_json_string(stats, "native producer stats")?;
        append_video_stream_diagnostics(&stats, "outbound-rtp", &id, &mut video_streams);
        producers.push(json!({
            "id": id,
            "source": source,
            "stats": stats,
        }));
    }
    let mut consumers = Vec::new();
    for consumer in &state.consumers {
        let metadata = consumer_metadata(*consumer)?;
        let stats = unsafe { ffi::lib_dspeak_media_consumer_get_stats(*consumer) };
        let stats = native_json_string(stats, "native consumer stats")?;
        append_video_stream_diagnostics(&stats, "inbound-rtp", &metadata.0, &mut video_streams);
        consumers.push(json!({
            "id": metadata.0,
            "producerId": metadata.1,
            "kind": metadata.2,
            "stats": stats,
        }));
    }
    let capabilities = capabilities()?;
    Ok(json!({
        "engine": "native",
        "topology": "sfu",
        "sampledAt": sampled_at,
        "transports": transports,
        "producers": producers,
        "consumers": consumers,
        "videoStreams": video_streams,
        "videoCodecDiagnostics": capabilities.get("videoCodecDiagnostics").cloned().unwrap_or(Value::Null),
        "videoCodecCapabilities": capabilities.get("videoCodecCapabilities").cloned().unwrap_or(Value::Null),
        "concurrentEncode": capabilities.get("concurrentEncode").cloned().unwrap_or(Value::Null),
    }))
}
