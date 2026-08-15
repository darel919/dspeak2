#[cfg(native_rtc)]
use super::ffi;
#[cfg(native_rtc)]
use super::native;
#[cfg(native_rtc)]
use super::state::NativeHandleRegistry;
use super::state::NativeMediaStore;
use serde_json::Value;
#[cfg(native_rtc)]
use std::ffi::{CStr, CString};
use tauri::State;

#[cfg(native_rtc)]
fn owned_p2p_handle(
    handles: &NativeHandleRegistry,
    handle: u64,
) -> Result<*mut ffi::lib_dspeak_media_p2p_handle_t, String> {
    handles
        .p2p_handles
        .get(&handle)
        .copied()
        .filter(|value| !value.is_null())
        .ok_or_else(|| "native P2P handle is not owned by this session".to_string())
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_create(
    store: State<'_, NativeMediaStore>,
    offerer: bool,
) -> Result<Value, String> {
    let ice_servers = {
        let state = store
            .state
            .lock()
            .map_err(|_| "native media state lock poisoned".to_string())?;
        serde_json::to_string(&state.ice_servers).map_err(|error| error.to_string())?
    };
    let mut handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let handle = native::p2p_create(&ice_servers, offerer)?;
    let key = handle as u64;
    handles.p2p_handles.insert(key, handle);
    Ok(serde_json::json!({ "handle": key }))
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_destroy(
    store: State<'_, NativeMediaStore>,
    p2p_handle: u64,
) -> Result<(), String> {
    let mut handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let handle = handles
        .p2p_handles
        .remove(&p2p_handle)
        .ok_or_else(|| "native P2P handle is not owned by this session".to_string())?;
    handles.p2p_tracks.retain(|(key, _), _| *key != p2p_handle);
    native::p2p_destroy(handle);
    Ok(())
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_create_offer(
    store: State<'_, NativeMediaStore>,
    p2p_handle: u64,
) -> Result<String, String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    native::p2p_create_offer(owned_p2p_handle(&handles, p2p_handle)?)
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_create_answer(
    store: State<'_, NativeMediaStore>,
    p2p_handle: u64,
    remote_sdp: String,
) -> Result<String, String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    native::p2p_create_answer(owned_p2p_handle(&handles, p2p_handle)?, &remote_sdp)
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_set_remote_description(
    store: State<'_, NativeMediaStore>,
    p2p_handle: u64,
    sdp: String,
    sdp_type: String,
) -> Result<(), String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    native::p2p_set_remote_description(owned_p2p_handle(&handles, p2p_handle)?, &sdp, &sdp_type)
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_rollback_local_description(
    store: State<'_, NativeMediaStore>,
    p2p_handle: u64,
) -> Result<(), String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    native::p2p_rollback_local_description(owned_p2p_handle(&handles, p2p_handle)?)
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_add_ice_candidate(
    store: State<'_, NativeMediaStore>,
    p2p_handle: u64,
    candidate: String,
) -> Result<(), String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    native::p2p_add_ice_candidate(owned_p2p_handle(&handles, p2p_handle)?, &candidate)
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_ice_state(
    store: State<'_, NativeMediaStore>,
    p2p_handle: u64,
) -> Result<i32, String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    Ok(native::p2p_ice_state(owned_p2p_handle(
        &handles, p2p_handle,
    )?))
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_restart_ice(
    store: State<'_, NativeMediaStore>,
    p2p_handle: u64,
) -> Result<String, String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    native::p2p_restart_ice(owned_p2p_handle(&handles, p2p_handle)?)
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_add_track(
    store: State<'_, NativeMediaStore>,
    p2p_handle: u64,
    source: String,
    kind: String,
    preferred_codec: Option<String>,
    track_key: Option<String>,
) -> Result<Value, String> {
    let mut handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let handle = owned_p2p_handle(&handles, p2p_handle)?;
    let track_key = track_key.unwrap_or_else(|| source.clone());
    if handles
        .p2p_tracks
        .contains_key(&(p2p_handle, track_key.clone()))
    {
        return Err("native P2P source is already attached".to_string());
    }
    let c_source = CString::new(source.as_str()).map_err(|error| error.to_string())?;
    let track = if kind == "video" {
        unsafe { ffi::lib_dspeak_media_get_video_track(c_source.as_ptr()) }
    } else if kind == "audio" {
        unsafe { ffi::lib_dspeak_media_get_audio_track(c_source.as_ptr()) }
    } else {
        return Err("native P2P track kind is invalid".to_string());
    };
    if track.is_null() {
        return Err(format!("native {kind} capture track is unavailable"));
    }
    let result = unsafe {
        if kind == "video" {
            let preferred = preferred_codec
                .as_deref()
                .map(CString::new)
                .transpose()
                .map_err(|error| error.to_string())?;
            ffi::lib_dspeak_media_p2p_add_video_track_with_key(
                handle,
                track,
                preferred
                    .as_ref()
                    .map_or(std::ptr::null(), |value| value.as_ptr()),
                CString::new(track_key.as_str())
                    .map_err(|error| error.to_string())?
                    .as_ptr(),
            )
        } else {
            ffi::lib_dspeak_media_p2p_add_audio_track_with_key(
                handle,
                track,
                CString::new(track_key.as_str())
                    .map_err(|error| error.to_string())?
                    .as_ptr(),
            )
        }
    };
    if result != 0 {
        return Err(format!("native P2P {kind} track attachment failed"));
    }
    let pointer = unsafe {
        if kind == "video" {
            ffi::lib_dspeak_media_video_track_get_id(track)
        } else {
            ffi::lib_dspeak_media_audio_track_get_id(track)
        }
    };
    if pointer.is_null() {
        unsafe {
            if kind == "video" {
                ffi::lib_dspeak_media_p2p_remove_video_track_with_key(
                    handle,
                    track,
                    CString::new(track_key.as_str())
                        .map_err(|error| error.to_string())?
                        .as_ptr(),
                );
            } else {
                ffi::lib_dspeak_media_p2p_remove_audio_track_with_key(
                    handle,
                    track,
                    CString::new(track_key.as_str())
                        .map_err(|error| error.to_string())?
                        .as_ptr(),
                );
            }
        }
        return Err("native P2P track did not return an identifier".to_string());
    }
    let track_id = unsafe { CStr::from_ptr(pointer) }
        .to_string_lossy()
        .into_owned();
    unsafe { ffi::lib_dspeak_media_free_string(pointer) };
    eprintln!("[dspeak:media] p2p track added source={source} kind={kind} id={track_id}");
    handles
        .p2p_tracks
        .insert((p2p_handle, track_key), (kind, track));
    Ok(serde_json::json!({ "trackId": track_id }))
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_remove_track(
    store: State<'_, NativeMediaStore>,
    p2p_handle: u64,
    source: String,
    track_key: Option<String>,
) -> Result<(), String> {
    let mut handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let handle = owned_p2p_handle(&handles, p2p_handle)?;
    let track_key = track_key.unwrap_or_else(|| source.clone());
    let (kind, track) = handles
        .p2p_tracks
        .get(&(p2p_handle, track_key.clone()))
        .cloned()
        .ok_or_else(|| "native P2P source is not attached".to_string())?;
    let result = unsafe {
        if kind == "video" {
            ffi::lib_dspeak_media_p2p_remove_video_track_with_key(
                handle,
                track,
                CString::new(track_key.as_str())
                    .map_err(|error| error.to_string())?
                    .as_ptr(),
            )
        } else {
            ffi::lib_dspeak_media_p2p_remove_audio_track_with_key(
                handle,
                track,
                CString::new(track_key.as_str())
                    .map_err(|error| error.to_string())?
                    .as_ptr(),
            )
        }
    };
    if result != 0 {
        return Err(format!("native P2P {kind} track removal failed"));
    }
    handles.p2p_tracks.remove(&(p2p_handle, track_key));
    Ok(())
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_replace_track(
    store: State<'_, NativeMediaStore>,
    p2p_handle: u64,
    source: String,
    kind: String,
    track_key: Option<String>,
) -> Result<Value, String> {
    let mut handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let handle = owned_p2p_handle(&handles, p2p_handle)?;
    let track_key = track_key.unwrap_or_else(|| source.clone());
    let (attached_kind, old_track) = handles
        .p2p_tracks
        .get(&(p2p_handle, track_key.clone()))
        .cloned()
        .ok_or_else(|| "native P2P source is not attached".to_string())?;
    if attached_kind != kind {
        return Err("native P2P replacement track kind does not match".to_string());
    }
    let c_source = CString::new(source.as_str()).map_err(|error| error.to_string())?;
    let new_track = unsafe {
        if kind == "video" {
            ffi::lib_dspeak_media_get_video_track(c_source.as_ptr())
        } else if kind == "audio" {
            ffi::lib_dspeak_media_get_audio_track(c_source.as_ptr())
        } else {
            std::ptr::null_mut()
        }
    };
    if new_track.is_null() {
        return Err(format!("native P2P {kind} capture track is unavailable"));
    }
    if new_track != old_track {
        if kind == "video" {
            native::p2p_replace_video_track_with_key(handle, old_track, new_track, &track_key)?;
        } else {
            native::p2p_replace_audio_track_with_key(handle, old_track, new_track, &track_key)?;
        }
    }
    let pointer = unsafe {
        if kind == "video" {
            ffi::lib_dspeak_media_video_track_get_id(new_track)
        } else {
            ffi::lib_dspeak_media_audio_track_get_id(new_track)
        }
    };
    if pointer.is_null() {
        return Err("native P2P replacement track did not return an identifier".to_string());
    }
    let track_id = unsafe { CStr::from_ptr(pointer) }
        .to_string_lossy()
        .into_owned();
    unsafe { ffi::lib_dspeak_media_free_string(pointer) };
    handles
        .p2p_tracks
        .insert((p2p_handle, track_key), (kind, new_track));
    Ok(serde_json::json!({ "trackId": track_id }))
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_set_track_parameters(
    store: State<'_, NativeMediaStore>,
    p2p_handle: u64,
    source: String,
    parameters: Value,
    track_key: Option<String>,
) -> Result<(), String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let handle = owned_p2p_handle(&handles, p2p_handle)?;
    let track_key = track_key.unwrap_or_else(|| source.clone());
    let (kind, track) = handles
        .p2p_tracks
        .get(&(p2p_handle, track_key.clone()))
        .map(|(kind, track)| (kind.as_str(), *track))
        .ok_or_else(|| "native P2P source is not attached".to_string())?;
    if track.is_null() {
        return Err(format!("native P2P {kind} track is invalid"));
    }
    native::p2p_set_track_parameters_with_key(handle, &track_key, &parameters.to_string())
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_set_audio_stereo(
    store: State<'_, NativeMediaStore>,
    p2p_handle: u64,
    stereo: bool,
) -> Result<(), String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let handle = owned_p2p_handle(&handles, p2p_handle)?;
    let result = unsafe { ffi::lib_dspeak_media_p2p_set_audio_stereo(handle, stereo) };
    if result == 0 {
        Ok(())
    } else {
        Err("native P2P audio profile update failed".to_string())
    }
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_set_receive_enabled(
    store: State<'_, NativeMediaStore>,
    p2p_handle: u64,
    track_id: String,
    enabled: bool,
) -> Result<(), String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let handle = owned_p2p_handle(&handles, p2p_handle)?;
    native::p2p_set_receive_enabled(handle, &track_id, enabled)
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_set_receive_volume(
    store: State<'_, NativeMediaStore>,
    p2p_handle: u64,
    track_id: String,
    volume: f64,
) -> Result<(), String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let handle = owned_p2p_handle(&handles, p2p_handle)?;
    native::p2p_set_receive_volume(handle, &track_id, volume)
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_get_stats(
    store: State<'_, NativeMediaStore>,
    p2p_handle: u64,
) -> Result<Value, String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let handle = owned_p2p_handle(&handles, p2p_handle)?;
    let stats = native::p2p_get_stats(handle)?;
    serde_json::from_str(&stats)
        .map_err(|error| format!("native P2P stats JSON is invalid: {error}"))
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_set_jitter_buffer(
    store: State<'_, NativeMediaStore>,
    p2p_handle: u64,
    track_id: String,
    min_delay_ms: i32,
    target_delay_ms: i32,
) -> Result<(), String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let handle = owned_p2p_handle(&handles, p2p_handle)?;
    native::p2p_set_jitter_buffer(handle, &track_id, min_delay_ms, target_delay_ms)
}

#[cfg(native_rtc)]
#[tauri::command]
pub async fn media_p2p_send_health(
    store: State<'_, NativeMediaStore>,
    p2p_handle: u64,
    message: String,
) -> Result<(), String> {
    let handles = store
        .handles
        .lock()
        .map_err(|_| "native media handle lock poisoned".to_string())?;
    let handle = owned_p2p_handle(&handles, p2p_handle)?;
    native::p2p_send_health(handle, &message)
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_create(
    _store: State<'_, NativeMediaStore>,
    _offerer: bool,
) -> Result<Value, String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_set_receive_volume(
    _store: State<'_, NativeMediaStore>,
    _p2p_handle: u64,
    _track_id: String,
    _volume: f64,
) -> Result<(), String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_get_stats(
    _store: State<'_, NativeMediaStore>,
    _p2p_handle: u64,
) -> Result<Value, String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_destroy(
    _store: State<'_, NativeMediaStore>,
    _p2p_handle: u64,
) -> Result<(), String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_create_offer(
    _store: State<'_, NativeMediaStore>,
    _p2p_handle: u64,
) -> Result<String, String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_create_answer(
    _store: State<'_, NativeMediaStore>,
    _p2p_handle: u64,
    _remote_sdp: String,
) -> Result<String, String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_set_remote_description(
    _store: State<'_, NativeMediaStore>,
    _p2p_handle: u64,
    _sdp: String,
    _sdp_type: String,
) -> Result<(), String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_rollback_local_description(
    _store: State<'_, NativeMediaStore>,
    _p2p_handle: u64,
) -> Result<(), String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_add_ice_candidate(
    _store: State<'_, NativeMediaStore>,
    _p2p_handle: u64,
    _candidate: String,
) -> Result<(), String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_ice_state(
    _store: State<'_, NativeMediaStore>,
    _p2p_handle: u64,
) -> Result<i32, String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_restart_ice(
    _store: State<'_, NativeMediaStore>,
    _p2p_handle: u64,
) -> Result<String, String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_add_track(
    _store: State<'_, NativeMediaStore>,
    _p2p_handle: u64,
    _source: String,
    _kind: String,
    _preferred_codec: Option<String>,
    _track_key: Option<String>,
) -> Result<Value, String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_remove_track(
    _store: State<'_, NativeMediaStore>,
    _p2p_handle: u64,
    _source: String,
    _track_key: Option<String>,
) -> Result<(), String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_replace_track(
    _store: State<'_, NativeMediaStore>,
    _p2p_handle: u64,
    _source: String,
    _kind: String,
    _track_key: Option<String>,
) -> Result<Value, String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_set_track_parameters(
    _store: State<'_, NativeMediaStore>,
    _p2p_handle: u64,
    _source: String,
    _parameters: Value,
    _track_key: Option<String>,
) -> Result<(), String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_set_audio_stereo(
    _store: State<'_, NativeMediaStore>,
    _p2p_handle: u64,
    _stereo: bool,
) -> Result<(), String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_set_receive_enabled(
    _store: State<'_, NativeMediaStore>,
    _p2p_handle: u64,
    _track_id: String,
    _enabled: bool,
) -> Result<(), String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_set_jitter_buffer(
    _store: State<'_, NativeMediaStore>,
    _p2p_handle: u64,
    _track_id: String,
    _min_delay_ms: i32,
    _target_delay_ms: i32,
) -> Result<(), String> {
    Err("native media backend not available".to_string())
}

#[cfg(not(native_rtc))]
#[tauri::command]
pub async fn media_p2p_send_health(
    _store: State<'_, NativeMediaStore>,
    _p2p_handle: u64,
    _message: String,
) -> Result<(), String> {
    Err("native media backend not available".to_string())
}
