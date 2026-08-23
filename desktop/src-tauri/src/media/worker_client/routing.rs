use super::{NativeMediaState, NativeMediaStore};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

pub(crate) async fn media_worker_invoke(
    app: AppHandle,
    store: State<'_, NativeMediaStore>,
    command: String,
    payload: Value,
) -> Result<Value, Value> {
    if !command.starts_with("media_") {
        return Err(json!("native media worker rejected a non-media command"));
    }
    let worker = store.worker.clone();
    let event_worker = worker.clone();
    let worker_state = store.state.clone();
    let worker_app = app.clone();
    let worker_command = command.clone();
    let worker_is_connected = store
        .state
        .lock()
        .map(|state| state.connected)
        .unwrap_or(false);
    let result = tauri::async_runtime::spawn_blocking(move || {
        if worker_command == "media_shutdown" {
            return worker
                .call_existing(&worker_app, &worker_command, payload)
                .unwrap_or(Ok(Value::Null));
        }
        let capture_start_command = matches!(
            worker_command.as_str(),
            "media_start_screen_share"
                | "media_replace_screen_share"
                | "media_start_system_audio"
                | "media_replace_system_audio"
        );
        let can_spawn = matches!(
            worker_command.as_str(),
            "media_initialize" | "media_prepare_devices" | "media_prepare_capture"
        );
        if can_spawn
            && worker_is_connected
            && matches!(
                worker_command.as_str(),
                "media_prepare_devices" | "media_prepare_capture"
            )
        {
            return worker
                .call_existing(&worker_app, &worker_command, payload)
                .unwrap_or_else(|| Err(worker.not_running_error()));
        }
        if worker_command == "media_join" || capture_start_command {
            return worker.call_with_initialize(
                &worker_app,
                &worker_state,
                &worker_command,
                payload,
            );
        }
        if can_spawn {
            return worker.call(&worker_app, &worker_state, &worker_command, payload);
        }
        worker
            .call_existing(&worker_app, &worker_command, payload)
            .unwrap_or_else(|| Err(worker.not_running_error()))
    })
    .await
    .map_err(|error| json!(format!("native media worker task failed: {error}")))?;
    if let Err(error) = &result {
        crate::desktop::activity_log::log_activity(
            &app,
            crate::desktop::activity_log::LogCategory::VoiceChannels,
            crate::desktop::activity_log::ActivityLevel::Warning,
            "media-command-failed",
            error.clone(),
        );
        if error.get("code").and_then(Value::as_str) == Some("MEDIA_WORKER_EXITED")
            && event_worker.claim_fatal_event()
        {
            let _ = app.emit("media:error", error.clone());
        }
    }
    if let Ok(value) = &result {
        sync_parent_state(&store, &command, value);
        if matches!(
            command.as_str(),
            "media_initialize" | "media_join" | "media_leave" | "media_shutdown"
        ) {
            let _ = app.emit(super::MEDIA_EVENT_STATE, value);
        }
    }
    result
}

fn sync_parent_state(store: &NativeMediaStore, command: &str, value: &Value) {
    let Ok(mut state) = store.state.lock() else {
        return;
    };
    match command {
        "media_initialize" | "media_join" | "media_leave" => {
            if let Ok(snapshot) = serde_json::from_value::<NativeMediaState>(value.clone()) {
                *state = snapshot;
            }
        }
        "media_shutdown" => *state = NativeMediaState::default(),
        "media_set_topology" => state.topology = value.get("topology").cloned(),
        "media_set_ice_servers" => {
            state.ice_servers = value
                .get("iceServers")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
        }
        _ => {}
    }
}
