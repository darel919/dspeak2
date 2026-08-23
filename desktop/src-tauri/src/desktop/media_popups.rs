use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State, WindowBuilder, WindowEvent};

pub(crate) const MEDIA_POPUP_CLOSED_EVENT: &str = "desktop:media-popup-closed";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MediaPopupRequest {
    pub(crate) popup_id: String,
    pub(crate) participant_id: String,
    pub(crate) source: String,
    pub(crate) logical_stream_id: String,
    pub(crate) label: String,
    pub(crate) avatar: String,
    pub(crate) native: bool,
    pub(crate) event_id: Option<String>,
    pub(crate) online: bool,
    pub(crate) receiving: bool,
    pub(crate) volume: f64,
}

fn popup_window_label(popup_id: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    popup_id.hash(&mut hasher);
    format!("media-popup-{:016x}", hasher.finish())
}

fn popup_title(label: &str) -> String {
    let mut title = label.chars().take(96).collect::<String>();
    if title.is_empty() {
        title = "Participant".to_string();
    }
    format!("dSpeak · {title}")
}

struct PopupWindowHandle {
    frames: Arc<Mutex<super::popup_renderer::LatestFrameSlot>>,
    offline: Arc<Mutex<Option<super::popup_renderer::OfflineState>>>,
}

impl PopupWindowHandle {
    fn push_frame(&self, frame: super::popup_renderer::VideoFrame) -> bool {
        self.set_offline(None);
        match self.frames.lock() {
            Ok(mut slot) => {
                slot.push(frame);
                true
            }
            Err(_) => false,
        }
    }

    fn set_offline(&self, state: Option<super::popup_renderer::OfflineState>) -> bool {
        match self.offline.lock() {
            Ok(mut slot) => {
                if *slot == state {
                    return false;
                }
                *slot = state;
                true
            }
            Err(_) => false,
        }
    }
}

#[derive(Clone, Default)]
pub(crate) struct MediaPopupState {
    requests: Arc<Mutex<HashMap<String, MediaPopupRequest>>>,
    windows: Arc<Mutex<HashMap<String, Arc<PopupWindowHandle>>>>,
}

impl MediaPopupState {
    fn insert(&self, request: MediaPopupRequest) -> Result<(), String> {
        self.requests
            .lock()
            .map_err(|_| "media popup state lock poisoned".to_string())?
            .insert(request.popup_id.clone(), request.clone());
        Ok(())
    }

    fn get(&self, popup_id: &str) -> Result<Option<MediaPopupRequest>, String> {
        Ok(self
            .requests
            .lock()
            .map_err(|_| "media popup state lock poisoned".to_string())?
            .get(popup_id)
            .cloned())
    }

    fn remove(&self, popup_id: &str) -> Result<Option<MediaPopupRequest>, String> {
        if let Ok(mut windows) = self.windows.lock() {
            windows.remove(popup_id);
        }
        Ok(self
            .requests
            .lock()
            .map_err(|_| "media popup state lock poisoned".to_string())?
            .remove(popup_id))
    }
}

pub(crate) fn route_frame(state: &MediaPopupState, payload: &serde_json::Value) {
    let Some(data) = decode_frame_data(payload) else {
        return;
    };
    let width = payload
        .get("width")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or_default();
    let height = payload
        .get("height")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or_default();
    let Some(frame) = super::popup_renderer::VideoFrame::parse(
        &data,
        width,
        height,
        usize::try_from(width.max(0)).map(|w| w * 4).unwrap_or(0),
    ) else {
        return;
    };
    if let Ok(windows) = state.windows.lock() {
        for handle in windows.values() {
            handle.push_frame(frame.clone());
        }
    }
}

fn decode_frame_data(payload: &serde_json::Value) -> Option<Vec<u8>> {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    STANDARD.decode(payload.get("data")?.as_str()?).ok()
}

fn validate_request(request: &MediaPopupRequest) -> Result<(), String> {
    if request.popup_id.is_empty()
        || request.participant_id.is_empty()
        || request.source.is_empty()
        || request.logical_stream_id.is_empty()
    {
        return Err("media popup identity is incomplete".to_string());
    }
    if !request.native {
        return Err("media popups require the native media path".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_open_media_popup(
    app: AppHandle,
    state: State<'_, MediaPopupState>,
    request: MediaPopupRequest,
) -> Result<(), String> {
    validate_request(&request)?;
    let popup_id = request.popup_id.clone();
    let window_label = popup_window_label(&popup_id);

    if let Some(window) = app.get_window(&window_label) {
        state.insert(request)?;
        window.show().map_err(|error| error.to_string())?;
        return window.set_focus().map_err(|error| error.to_string());
    }

    let title = popup_title(&request.label);
    state.insert(request)?;

    let frames: Arc<Mutex<super::popup_renderer::LatestFrameSlot>> =
        Arc::new(Mutex::new(Default::default()));
    let offline: Arc<Mutex<Option<super::popup_renderer::OfflineState>>> =
        Arc::new(Mutex::new(None));
    let window = WindowBuilder::new(&app, &window_label)
        .title(title)
        .inner_size(640.0, 360.0)
        .min_inner_size(320.0, 180.0)
        .resizable(true)
        .decorations(true)
        .visible(false)
        .build()
        .map_err(|error| {
            let _ = state.remove(&popup_id);
            error.to_string()
        })?;

    state
        .windows
        .lock()
        .map_err(|_| "media popup state lock poisoned".to_string())?
        .insert(
            popup_id.clone(),
            Arc::new(PopupWindowHandle {
                frames: frames.clone(),
                offline: offline.clone(),
            }),
        );

    let renderer = super::popup_renderer::spawn_renderer(window.clone(), frames, offline);
    if let Err(error) = renderer {
        let _ = state.remove(&popup_id);
        let _ = window.close();
        return Err(error);
    }

    let event_app = app.clone();
    let event_state = state.inner().clone();
    let event_popup_id = popup_id.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            remove_popup_and_announce(&event_app, &event_state, &event_popup_id, "window-closed");
        }
    });

    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

fn emit_popup_closed(app: &AppHandle, popup_id: &str, reason: &str) {
    let _ = app.emit(
        MEDIA_POPUP_CLOSED_EVENT,
        serde_json::json!({
            "popupId": popup_id,
            "reason": reason,
        }),
    );
}

fn remove_popup_and_announce(
    app: &AppHandle,
    state: &MediaPopupState,
    popup_id: &str,
    reason: &str,
) {
    if state.remove(popup_id).ok().flatten().is_some() {
        emit_popup_closed(app, popup_id, reason);
    }
}

#[tauri::command]
pub fn desktop_get_media_popup(
    state: State<'_, MediaPopupState>,
    popup_id: String,
) -> Result<Option<MediaPopupRequest>, String> {
    state.get(&popup_id)
}

#[tauri::command]
pub fn desktop_focus_media_popup(
    app: AppHandle,
    state: State<'_, MediaPopupState>,
    popup_id: String,
) -> Result<(), String> {
    if state.get(&popup_id)?.is_none() {
        return Err("media popup is not registered".to_string());
    }
    let window_label = popup_window_label(&popup_id);
    let window = app
        .get_window(&window_label)
        .ok_or_else(|| "media popup window is unavailable".to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn desktop_close_media_popup(
    app: AppHandle,
    state: State<'_, MediaPopupState>,
    popup_id: String,
) -> Result<(), String> {
    let Some(request) = state.remove(&popup_id)? else {
        return Ok(());
    };
    let window_label = popup_window_label(&popup_id);
    if let Some(window) = app.get_window(&window_label) {
        if let Err(error) = window.destroy() {
            state.insert(request)?;
            return Err(error.to_string());
        }
    }
    emit_popup_closed(&app, &popup_id, "popped-in");
    Ok(())
}

pub(crate) fn mark_all_offline(_app: &AppHandle, state: &MediaPopupState) {
    if let Ok(windows) = state.windows.lock() {
        for (popup_id, handle) in windows.iter() {
            let label = state
                .get(popup_id)
                .ok()
                .flatten()
                .map(|request| request.label)
                .unwrap_or_else(|| "Participant".to_string());
            if handle.set_offline(Some(super::popup_renderer::OfflineState::new(label))) {
                let _ = super::popup_renderer::wake_renderer();
            }
        }
    }
}

#[tauri::command]
pub fn desktop_set_media_popup_offline(
    state: State<'_, MediaPopupState>,
    popup_id: String,
    label: String,
) -> Result<(), String> {
    let Some(handle) = state
        .windows
        .lock()
        .map_err(|_| "media popup state lock poisoned".to_string())?
        .get(&popup_id)
        .cloned()
    else {
        return Ok(());
    };
    handle.set_offline(Some(super::popup_renderer::OfflineState::new(label)));
    let _ = super::popup_renderer::wake_renderer();
    Ok(())
}
