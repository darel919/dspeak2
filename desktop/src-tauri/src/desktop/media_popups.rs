use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WindowEvent};

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

#[derive(Clone, Default)]
pub(crate) struct MediaPopupState {
    requests: Arc<Mutex<HashMap<String, MediaPopupRequest>>>,
}

impl MediaPopupState {
    fn insert(&self, request: MediaPopupRequest) -> Result<(), String> {
        self.requests
            .lock()
            .map_err(|_| "media popup state lock poisoned".to_string())?
            .insert(request.popup_id.clone(), request);
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
        Ok(self
            .requests
            .lock()
            .map_err(|_| "media popup state lock poisoned".to_string())?
            .remove(popup_id))
    }

    fn take_all(&self) -> Result<Vec<MediaPopupRequest>, String> {
        Ok(std::mem::take(
            &mut *self
                .requests
                .lock()
                .map_err(|_| "media popup state lock poisoned".to_string())?,
        )
        .into_values()
        .collect())
    }
}

fn popup_window_label(popup_id: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    popup_id.hash(&mut hasher);
    format!("media-popup-{:016x}", hasher.finish())
}

fn encode_query_component(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push('%');
            encoded.push_str(&format!("{byte:02X}"));
        }
    }
    encoded
}

fn popup_title(label: &str) -> String {
    let mut title = label.chars().take(96).collect::<String>();
    if title.is_empty() {
        title = "Participant".to_string();
    }
    format!("dSpeak · {title}")
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
    state.insert(request.clone())?;

    if let Some(window) = app.get_webview_window(&window_label) {
        if let Err(error) = window.show().and_then(|_| window.set_focus()) {
            let _ = state.remove(&popup_id);
            return Err(error.to_string());
        }
        return Ok(());
    }

    let url = format!(
        "index.html?mediaPopupId={}",
        encode_query_component(&popup_id)
    );
    let event_app = app.clone();
    let event_state = state.inner().clone();
    let event_popup_id = popup_id.clone();
    let window = tauri::WebviewWindowBuilder::new(&app, &window_label, WebviewUrl::App(url.into()))
        .title(popup_title(&request.label))
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

    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            remove_popup_and_announce(&event_app, &event_state, &event_popup_id, "window-closed");
        }
    });

    if let Err(error) = window.show().and_then(|_| window.set_focus()) {
        let _ = state.remove(&popup_id);
        let _ = window.destroy();
        return Err(error.to_string());
    }
    Ok(())
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
        .get_webview_window(&window_label)
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
    if let Some(window) = app.get_webview_window(&window_label) {
        if let Err(error) = window.destroy() {
            state.insert(request)?;
            return Err(error.to_string());
        }
    }
    emit_popup_closed(&app, &popup_id, "popped-in");
    Ok(())
}

pub(crate) fn close_all(app: &AppHandle, state: &MediaPopupState) {
    let requests = state.take_all().unwrap_or_default();
    for request in requests {
        let window_label = popup_window_label(&request.popup_id);
        if let Some(window) = app.get_webview_window(&window_label) {
            let _ = window.destroy();
        }
        emit_popup_closed(app, &request.popup_id, "media-disconnected");
    }
}
