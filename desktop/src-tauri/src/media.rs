//! Native media state, startup validation, and Tauri command façade.

mod command_capture;
mod command_consumers;
mod command_core;
mod command_p2p;
mod command_producers;
mod command_sfu;
mod command_signaling;
mod command_stats;
#[cfg(native_rtc)]
mod event_bridge;
#[cfg(native_rtc)]
mod ffi;
#[cfg(native_rtc)]
mod native;
mod startup;
mod state;
mod types;
mod video_surface;
mod worker_client;

pub const MEDIA_EVENT_STATE: &str = "media:state";
pub const MEDIA_EVENT_NATIVE_ACTION: &str = "media:native-action";
pub const MEDIA_EVENT_NATIVE_RECEIVE: &str = "media:native-receive-event";

pub use command_capture::*;
pub use command_consumers::*;
pub use command_core::*;
pub use command_p2p::*;
pub use command_producers::*;
pub use command_sfu::*;
pub use command_signaling::*;
pub use command_stats::*;
use serde_json::Value;
pub(crate) use state::{is_connected, NativeMediaStore};
use tauri::{AppHandle, Manager, State};
pub use video_surface::*;

pub(crate) fn clear_video_surfaces(app: &AppHandle) {
    let Some(store) = app.try_state::<NativeMediaStore>() else {
        return;
    };
    let worker = store.worker.clone();
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || worker.clear_surfaces(&app_handle));
}

#[tauri::command]
pub async fn media_worker_invoke(
    app: AppHandle,
    store: State<'_, NativeMediaStore>,
    command: String,
    payload: Value,
) -> Result<Value, Value> {
    worker_client::media_worker_invoke(app, store, command, payload).await
}
