use super::protocol::{
    native_json_string, native_text, payload_bool, payload_i32, payload_number, payload_string,
    payload_u64,
};
use super::state::WorkerState;
use super::WorkerResult;
use crate::ffi;
use serde_json::{json, Value};
use std::ffi::{c_void, CStr, CString};
use std::ptr;

pub(super) fn p2p_pointer(
    state: &WorkerState,
    handle: u64,
) -> Result<*mut ffi::lib_dspeak_media_p2p_handle_t, Value> {
    state
        .p2p_handles
        .get(&handle)
        .cloned()
        .filter(|value| !value.is_null())
        .ok_or_else(|| json!("native P2P handle is not owned by this session"))
}

pub(super) fn p2p_create(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let ice_servers = serde_json::to_string(&state.ice_servers).map_err(|error| {
        json!(format!(
            "native ICE servers could not be serialized: {error}"
        ))
    })?;
    let ice_servers =
        CString::new(ice_servers).map_err(|_| json!("native ICE servers contain a NUL byte"))?;
    let offerer = payload_bool(&payload, "offerer")?;
    let key = state.next_handle();
    let handle = unsafe { ffi::lib_dspeak_media_p2p_create(ice_servers.as_ptr(), offerer, key) };
    if handle.is_null() {
        return Err(json!("native P2P PeerConnection creation failed"));
    }
    state.p2p_handles.insert(key, handle);
    Ok(json!({ "handle": key }))
}

pub(super) fn p2p_destroy(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let key = payload_u64(&payload, "p2pHandle")?;
    let handle = state
        .p2p_handles
        .remove(&key)
        .ok_or_else(|| json!("native P2P handle is not owned by this session"))?;
    state.p2p_tracks.retain(|(owner, _), _| *owner != key);
    unsafe { ffi::lib_dspeak_media_p2p_destroy(handle) };
    Ok(Value::Null)
}

pub(super) fn p2p_create_offer(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let handle = p2p_pointer(state, payload_u64(&payload, "p2pHandle")?)?;
    let mut output = ptr::null_mut();
    let result = unsafe { ffi::lib_dspeak_media_p2p_create_offer(handle, &mut output) };
    p2p_sdp_result(handle, result, output, "offer")
}

pub(super) fn p2p_create_answer(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let handle = p2p_pointer(state, payload_u64(&payload, "p2pHandle")?)?;
    let remote_sdp = CString::new(payload_string(&payload, "remoteSdp")?)
        .map_err(|_| json!("remote SDP contains a NUL byte"))?;
    let mut output = ptr::null_mut();
    let result = unsafe {
        ffi::lib_dspeak_media_p2p_create_answer(handle, remote_sdp.as_ptr(), &mut output)
    };
    p2p_sdp_result(handle, result, output, "answer")
}

pub(super) fn p2p_set_remote_description(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let handle = p2p_pointer(state, payload_u64(&payload, "p2pHandle")?)?;
    let sdp = CString::new(payload_string(&payload, "sdp")?)
        .map_err(|_| json!("SDP contains a NUL byte"))?;
    let sdp_type = CString::new(payload_string(&payload, "sdpType")?)
        .map_err(|_| json!("SDP type contains a NUL byte"))?;
    let result = unsafe {
        ffi::lib_dspeak_media_p2p_set_remote_description(handle, sdp_type.as_ptr(), sdp.as_ptr())
    };
    if result == 0 {
        Ok(Value::Null)
    } else {
        let native_error = unsafe { ffi::lib_dspeak_media_p2p_last_error(handle) };
        let native_error = if native_error.is_null() {
            "native remote description failed".to_string()
        } else {
            unsafe { CStr::from_ptr(native_error) }
                .to_string_lossy()
                .into_owned()
        };
        Err(json!({
            "code": "NATIVE_P2P_REMOTE_DESCRIPTION_FAILED",
            "message": "native P2P remote description failed",
            "details": {
                "sdpType": sdp_type.to_string_lossy().into_owned(),
                "nativeError": native_error,
            },
        }))
    }
}

pub(super) fn p2p_rollback_local_description(
    state: &mut WorkerState,
    payload: Value,
) -> WorkerResult {
    state.ensure_initialized()?;
    let handle = p2p_pointer(state, payload_u64(&payload, "p2pHandle")?)?;
    let result = unsafe { ffi::lib_dspeak_media_p2p_rollback_local_description(handle) };
    if result == 0 {
        Ok(Value::Null)
    } else {
        let native_error = unsafe { ffi::lib_dspeak_media_p2p_last_error(handle) };
        let native_error = if native_error.is_null() {
            "native local rollback failed".to_string()
        } else {
            unsafe { CStr::from_ptr(native_error) }
                .to_string_lossy()
                .into_owned()
        };
        Err(json!({
            "code": "NATIVE_P2P_LOCAL_ROLLBACK_FAILED",
            "message": "native P2P local description rollback failed",
            "details": { "nativeError": native_error }
        }))
    }
}

pub(super) fn p2p_add_ice_candidate(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let handle = p2p_pointer(state, payload_u64(&payload, "p2pHandle")?)?;
    let candidate = CString::new(payload_string(&payload, "candidate")?)
        .map_err(|_| json!("ICE candidate contains a NUL byte"))?;
    let result = unsafe { ffi::lib_dspeak_media_p2p_add_ice_candidate(handle, candidate.as_ptr()) };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!("native P2P ICE candidate failed"))
    }
}

pub(super) fn p2p_ice_state(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let handle = p2p_pointer(state, payload_u64(&payload, "p2pHandle")?)?;
    Ok(json!(unsafe {
        ffi::lib_dspeak_media_p2p_ice_connection_state(handle)
    }))
}

pub(super) fn p2p_restart_ice(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let handle = p2p_pointer(state, payload_u64(&payload, "p2pHandle")?)?;
    let mut output = ptr::null_mut();
    let result = unsafe { ffi::lib_dspeak_media_p2p_restart_ice(handle, &mut output) };
    p2p_sdp_result(handle, result, output, "ICE restart")
}

pub(super) fn p2p_add_track(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let key = payload_u64(&payload, "p2pHandle")?;
    let handle = p2p_pointer(state, key)?;
    let source = payload_string(&payload, "source")?;
    let track_key = payload
        .get("trackKey")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| source.clone());
    let kind = payload_string(&payload, "kind")?;
    let preferred_codec = payload
        .get("preferredCodec")
        .and_then(Value::as_str)
        .map(str::to_owned);
    if kind != "audio" && kind != "video" {
        return Err(json!("native P2P track kind is invalid"));
    }
    if state.p2p_tracks.contains_key(&(key, track_key.clone())) {
        return Err(json!("native P2P source is already attached"));
    }
    let source_c =
        CString::new(source.clone()).map_err(|_| json!("native P2P source contains a NUL byte"))?;
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
    let result = unsafe {
        if kind == "video" {
            let preferred = preferred_codec
                .as_deref()
                .map(|value| CString::new(value.to_owned()))
                .transpose()
                .map_err(|error| json!(error.to_string()))?;
            let track_key =
                CString::new(track_key.clone()).map_err(|error| json!(error.to_string()))?;
            ffi::lib_dspeak_media_p2p_add_video_track_with_key(
                handle,
                track,
                preferred
                    .as_ref()
                    .map_or(ptr::null(), |value| value.as_ptr()),
                track_key.as_ptr(),
            )
        } else {
            let track_key =
                CString::new(track_key.clone()).map_err(|error| json!(error.to_string()))?;
            ffi::lib_dspeak_media_p2p_add_audio_track_with_key(handle, track, track_key.as_ptr())
        }
    };
    if result != 0 {
        return Err(json!(format!("native P2P {kind} track attachment failed")));
    }
    let track_id = track_id(track, &kind)?;
    state.p2p_tracks.insert((key, track_key), (kind, track));
    Ok(json!({ "trackId": track_id }))
}

pub(super) fn p2p_remove_track(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let key = payload_u64(&payload, "p2pHandle")?;
    let handle = p2p_pointer(state, key)?;
    let source = payload_string(&payload, "source")?;
    let track_key = payload
        .get("trackKey")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| source.clone());
    let (kind, track) = state
        .p2p_tracks
        .get(&(key, track_key.clone()))
        .cloned()
        .ok_or_else(|| json!("native P2P source is not attached"))?;
    let result = unsafe {
        if kind == "video" {
            let track_key =
                CString::new(track_key.clone()).map_err(|error| json!(error.to_string()))?;
            ffi::lib_dspeak_media_p2p_remove_video_track_with_key(handle, track, track_key.as_ptr())
        } else {
            let track_key =
                CString::new(track_key.clone()).map_err(|error| json!(error.to_string()))?;
            ffi::lib_dspeak_media_p2p_remove_audio_track_with_key(handle, track, track_key.as_ptr())
        }
    };
    if result != 0 {
        return Err(json!(format!("native P2P {kind} track removal failed")));
    }
    state.p2p_tracks.remove(&(key, track_key));
    Ok(Value::Null)
}

pub(super) fn p2p_replace_track(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let key = payload_u64(&payload, "p2pHandle")?;
    let handle = p2p_pointer(state, key)?;
    let source = payload_string(&payload, "source")?;
    let kind = payload_string(&payload, "kind")?;
    let track_key = payload
        .get("trackKey")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| source.clone());
    let (attached_kind, old_track) = state
        .p2p_tracks
        .get(&(key, track_key.clone()))
        .cloned()
        .ok_or_else(|| json!("native P2P source is not attached"))?;
    if attached_kind != kind {
        return Err(json!("native P2P replacement track kind does not match"));
    }
    let source_c =
        CString::new(source).map_err(|_| json!("native P2P source contains a NUL byte"))?;
    let new_track = unsafe {
        if kind == "video" {
            ffi::lib_dspeak_media_get_video_track(source_c.as_ptr())
        } else if kind == "audio" {
            ffi::lib_dspeak_media_get_audio_track(source_c.as_ptr())
        } else {
            ptr::null_mut()
        }
    };
    if new_track.is_null() {
        return Err(json!(format!(
            "native P2P {kind} capture track is unavailable"
        )));
    }
    if new_track != old_track {
        let result = unsafe {
            if kind == "video" {
                let track_key =
                    CString::new(track_key.clone()).map_err(|error| json!(error.to_string()))?;
                ffi::lib_dspeak_media_p2p_replace_video_track_with_key(
                    handle,
                    old_track,
                    new_track,
                    track_key.as_ptr(),
                )
            } else {
                let track_key =
                    CString::new(track_key.clone()).map_err(|error| json!(error.to_string()))?;
                ffi::lib_dspeak_media_p2p_replace_audio_track_with_key(
                    handle,
                    old_track,
                    new_track,
                    track_key.as_ptr(),
                )
            }
        };
        if result != 0 {
            return Err(json!(format!("native P2P {kind} track replacement failed")));
        }
    }
    let track_id = track_id(new_track, &kind)?;
    state.p2p_tracks.insert((key, track_key), (kind, new_track));
    Ok(json!({ "trackId": track_id }))
}

pub(super) fn p2p_set_track_parameters(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let key = payload_u64(&payload, "p2pHandle")?;
    let handle = p2p_pointer(state, key)?;
    let source = payload_string(&payload, "source")?;
    let track_key = payload
        .get("trackKey")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| source.clone());
    let (kind, track) = state
        .p2p_tracks
        .get(&(key, track_key.clone()))
        .cloned()
        .ok_or_else(|| json!("native P2P source is not attached"))?;
    if track.is_null() {
        return Err(json!(format!("native P2P {kind} track is invalid")));
    }
    let parameters = CString::new(
        payload
            .get("parameters")
            .cloned()
            .unwrap_or(Value::Null)
            .to_string(),
    )
    .map_err(|_| json!("native P2P parameters contain a NUL byte"))?;
    let track_key =
        CString::new(track_key).map_err(|_| json!("native P2P track key contains a NUL byte"))?;
    let result = unsafe {
        ffi::lib_dspeak_media_p2p_set_track_parameters_with_key(
            handle,
            track_key.as_ptr(),
            parameters.as_ptr(),
        )
    };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!("native P2P sender RTP parameters update failed"))
    }
}

pub(super) fn p2p_set_audio_stereo(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let handle = p2p_pointer(state, payload_u64(&payload, "p2pHandle")?)?;
    let stereo = payload_bool(&payload, "stereo")?;
    let result = unsafe { ffi::lib_dspeak_media_p2p_set_audio_stereo(handle, stereo) };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!("native P2P audio profile update failed"))
    }
}

pub(super) fn p2p_set_receive_enabled(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let handle = p2p_pointer(state, payload_u64(&payload, "p2pHandle")?)?;
    let track_id = CString::new(payload_string(&payload, "trackId")?)
        .map_err(|_| json!("native P2P track id contains a NUL byte"))?;
    let enabled = payload_bool(&payload, "enabled")?;
    let result = unsafe {
        ffi::lib_dspeak_media_p2p_set_receive_enabled(handle, track_id.as_ptr(), enabled)
    };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!("native P2P receive state update failed"))
    }
}

pub(super) fn p2p_set_receive_volume(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let handle = p2p_pointer(state, payload_u64(&payload, "p2pHandle")?)?;
    let track_id = CString::new(payload_string(&payload, "trackId")?)
        .map_err(|_| json!("native P2P track id contains a NUL byte"))?;
    let volume = payload_number(&payload, "volume")?;
    let result =
        unsafe { ffi::lib_dspeak_media_p2p_set_receive_volume(handle, track_id.as_ptr(), volume) };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!("native P2P receive volume update failed"))
    }
}

pub(super) fn p2p_set_jitter_buffer(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let handle = p2p_pointer(state, payload_u64(&payload, "p2pHandle")?)?;
    let track_id = CString::new(payload_string(&payload, "trackId")?)
        .map_err(|_| json!("native P2P track id contains a NUL byte"))?;
    let min_delay = payload_i32(&payload, "minDelayMs")?;
    let target_delay = payload_i32(&payload, "targetDelayMs")?;
    let result = unsafe {
        ffi::lib_dspeak_media_p2p_set_jitter_buffer(
            handle,
            track_id.as_ptr(),
            min_delay,
            target_delay,
        )
    };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!("native P2P jitter buffer configuration failed"))
    }
}

pub(super) fn p2p_send_health(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let handle = p2p_pointer(state, payload_u64(&payload, "p2pHandle")?)?;
    let message = CString::new(payload_string(&payload, "message")?)
        .map_err(|_| json!("native P2P health message contains a NUL byte"))?;
    let result = unsafe { ffi::lib_dspeak_media_p2p_send_health(handle, message.as_ptr()) };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!("native P2P health message could not be sent"))
    }
}

pub(super) fn p2p_get_stats(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let handle = p2p_pointer(state, payload_u64(&payload, "p2pHandle")?)?;
    let pointer = unsafe { ffi::lib_dspeak_media_p2p_get_stats(handle) };
    native_json_string(pointer, "native P2P stats")
}

pub(super) fn track_id(track: *mut c_void, kind: &str) -> Result<String, Value> {
    let pointer = unsafe {
        if kind == "video" {
            ffi::lib_dspeak_media_video_track_get_id(track)
        } else {
            ffi::lib_dspeak_media_audio_track_get_id(track)
        }
    };
    native_text(pointer, "native track id")
}

pub(super) fn p2p_sdp_result(
    handle: *mut ffi::lib_dspeak_media_p2p_handle_t,
    result: i32,
    pointer: *mut std::ffi::c_char,
    operation: &str,
) -> WorkerResult {
    if result != 0 || pointer.is_null() {
        if !pointer.is_null() {
            unsafe { ffi::lib_dspeak_media_free_string(pointer) };
        }
        let native_error = unsafe { ffi::lib_dspeak_media_p2p_last_error(handle) };
        let native_error = if native_error.is_null() {
            "unknown native SDP error".to_string()
        } else {
            unsafe { CStr::from_ptr(native_error) }
                .to_string_lossy()
                .into_owned()
        };
        return Err(json!({
            "code": "NATIVE_P2P_SDP_FAILED",
            "message": format!("native P2P {operation} failed: {native_error}"),
            "details": {
                "operation": operation,
                "nativeError": native_error,
            },
        }));
    }
    native_text(pointer, &format!("native P2P {operation}")).map(Value::String)
}

pub(super) fn complete_connect(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let pointer = payload_u64(&payload, "transportPtr")? as *mut c_void;
    unsafe { ffi::lib_dspeak_media_complete_connect(pointer) };
    Ok(Value::Null)
}

pub(super) fn fail_connect(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let pointer = payload_u64(&payload, "transportPtr")? as *mut c_void;
    let error = CString::new(payload_string(&payload, "error")?)
        .map_err(|_| json!("native transport error contains a NUL byte"))?;
    unsafe { ffi::lib_dspeak_media_fail_connect(pointer, error.as_ptr()) };
    Ok(Value::Null)
}

pub(super) fn complete_produce(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let action_id = payload_u64(&payload, "actionId")?;
    let producer_id = CString::new(payload_string(&payload, "producerId")?)
        .map_err(|_| json!("native producer id contains a NUL byte"))?;
    unsafe { ffi::lib_dspeak_media_complete_produce(action_id, producer_id.as_ptr()) };
    Ok(Value::Null)
}

pub(super) fn fail_produce(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let action_id = payload_u64(&payload, "actionId")?;
    let error = CString::new(payload_string(&payload, "error")?)
        .map_err(|_| json!("native producer error contains a NUL byte"))?;
    unsafe { ffi::lib_dspeak_media_fail_produce(action_id, error.as_ptr()) };
    Ok(Value::Null)
}
