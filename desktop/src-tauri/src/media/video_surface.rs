use super::state::NativeMediaStore;
use super::worker_client::media_worker_surface_invoke;
use serde_json::json;
use tauri::{AppHandle, State};

fn worker_error(value: serde_json::Value) -> String {
    value
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| value.to_string())
}

#[tauri::command]
pub async fn media_video_surface_set_bounds(
    app: AppHandle,
    store: State<'_, NativeMediaStore>,
    window: tauri::WebviewWindow,
    surface_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    visible: bool,
) -> Result<(), String> {
    let inner_position = window
        .inner_position()
        .map_err(|error| format!("native video surface window position failed: {error}"))?;
    let scale_factor = window
        .scale_factor()
        .map_err(|error| format!("native video surface scale factor failed: {error}"))?;
    let payload = json!({
        "surfaceId": surface_id,
        "x": inner_position.x.saturating_add((x * scale_factor).round() as i32),
        "y": inner_position.y.saturating_add((y * scale_factor).round() as i32),
        "width": (width * scale_factor).round().max(1.0) as i32,
        "height": (height * scale_factor).round().max(1.0) as i32,
        "visible": visible,
    });
    media_worker_surface_invoke(
        app,
        store,
        "media_video_surface_set_bounds".to_string(),
        payload,
    )
    .await
    .map(|_| ())
    .map_err(worker_error)
}

#[tauri::command]
pub async fn media_video_surface_destroy(
    app: AppHandle,
    store: State<'_, NativeMediaStore>,
    surface_id: String,
) -> Result<(), String> {
    media_worker_surface_invoke(
        app,
        store,
        "media_video_surface_destroy".to_string(),
        json!({ "surfaceId": surface_id }),
    )
    .await
    .map(|_| ())
    .map_err(worker_error)
}

#[tauri::command]
pub async fn media_video_surface_clear(
    app: AppHandle,
    store: State<'_, NativeMediaStore>,
) -> Result<(), String> {
    media_worker_surface_invoke(
        app,
        store,
        "media_video_surface_clear".to_string(),
        json!({}),
    )
    .await
    .map(|_| ())
    .map_err(worker_error)
}
