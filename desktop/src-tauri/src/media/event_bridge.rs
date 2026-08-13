use super::ffi;
use super::state::NativeEventDispatcher;
use serde_json::Value;
use std::ffi::CStr;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};

pub const MEDIA_EVENT_NATIVE_ACTION: &str = "media:native-action";
pub const MEDIA_EVENT_NATIVE_RECEIVE: &str = "media:native-receive-event";

fn take_string(pointer: *mut std::ffi::c_char) -> Option<String> {
    if pointer.is_null() {
        return None;
    }
    let value = unsafe { CStr::from_ptr(pointer) }
        .to_string_lossy()
        .into_owned();
    unsafe { ffi::lib_dspeak_media_free_string(pointer) };
    Some(value)
}

fn borrow_string(pointer: *mut std::ffi::c_char) -> Option<String> {
    if pointer.is_null() {
        return None;
    }
    Some(
        unsafe { CStr::from_ptr(pointer) }
            .to_string_lossy()
            .into_owned(),
    )
}

fn drain_native_events(app: &AppHandle) {
    loop {
        let mut drained = false;
        loop {
            let action = unsafe { ffi::lib_dspeak_media_drain_action() };
            let params_json = take_string(action.params_json);
            let state = take_string(action.state);
            if action.kind == 0 && params_json.is_none() && state.is_none() {
                break;
            }
            drained = true;
            let _ = app.emit(
                MEDIA_EVENT_NATIVE_ACTION,
                serde_json::json!({
                    "kind": action.kind,
                    "transportPtr": action.transport_ptr as u64,
                    "actionId": action.action_id,
                    "paramsJson": params_json,
                    "state": state,
                }),
            );
        }

        loop {
            let mut receive = unsafe { ffi::lib_dspeak_media_drain_receive_event() };
            if receive.kind == 0 {
                break;
            }
            drained = true;
            let id = borrow_string(receive.id);
            let payload = borrow_string(receive.payload_json)
                .and_then(|value| serde_json::from_str::<Value>(&value).ok())
                .unwrap_or_else(|| serde_json::json!({}));
            let event = serde_json::json!({
                "kind": receive.kind,
                "eventId": receive.event_id,
                "id": id,
                "payload": payload,
            });
            unsafe { ffi::lib_dspeak_media_free_receive_event(&mut receive) };
            let _ = app.emit(MEDIA_EVENT_NATIVE_RECEIVE, event);
        }

        if !drained {
            break;
        }
    }
}

pub(crate) fn start(
    app: &AppHandle,
    dispatcher_slot: &Arc<Mutex<Option<NativeEventDispatcher>>>,
) -> Result<(), String> {
    let mut slot = dispatcher_slot
        .lock()
        .map_err(|_| "native event dispatcher lock poisoned".to_string())?;
    if slot.is_some() {
        return Ok(());
    }
    let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let thread_stop = stop.clone();
    let app_handle = app.clone();
    let thread = thread::Builder::new()
        .name("dspeak-native-events".to_string())
        .spawn(move || {
            while !thread_stop.load(Ordering::Acquire) {
                drain_native_events(&app_handle);
                if thread_stop.load(Ordering::Acquire) {
                    break;
                }
                unsafe { ffi::lib_dspeak_media_wait_for_event(1000) };
                if thread_stop.load(Ordering::Acquire) {
                    break;
                }
            }
            drain_native_events(&app_handle);
        })
        .map_err(|error| format!("native event dispatcher start failed: {error}"))?;
    *slot = Some(NativeEventDispatcher {
        stop,
        thread: Some(thread),
    });
    Ok(())
}

pub(crate) fn stop(
    dispatcher_slot: &Arc<Mutex<Option<NativeEventDispatcher>>>,
) -> Result<(), String> {
    let dispatcher = dispatcher_slot
        .lock()
        .map_err(|_| "native event dispatcher lock poisoned".to_string())?
        .take();
    let Some(mut dispatcher) = dispatcher else {
        return Ok(());
    };
    dispatcher.stop.store(true, Ordering::Release);
    unsafe { ffi::lib_dspeak_media_wake_event() };
    if let Some(thread) = dispatcher.thread.take() {
        thread
            .join()
            .map_err(|_| "native event dispatcher panicked".to_string())?;
    }
    Ok(())
}
